import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  confirmationSmsText,
  DEFAULT_CONFIRMATION_PARAMS,
  evaluateLoadStatus,
  type ConfirmationParams,
  trDay,
  trDayEnd,
  trDayStart,
  VISIBLE_LOAD_STATUSES,
} from "@nakliye/shared";
import { and, eq, inArray, isNotNull, isNull, lt, lte, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { randomToken, sha256 } from "../common/hash.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { SmsService } from "../common/sms.service.js";
import { DB, type Db } from "../db/db.module.js";
import { SettingsService } from "../settings/settings.service.js";
import { districts, loadConfirmations, loadPosts, provinces, users } from "../db/schema.js";

const BATCH = 500;
const HOUR = 3_600_000;
/** SMS linkindeki token: randomToken(12) → 16 karakter base64url (96 bit) */
const TOKEN_RE = /^[A-Za-z0-9_-]{16}$/;

const od = alias(districts, "od");
const op = alias(provinces, "op");
const dd = alias(districts, "dd");
const dp = alias(provinces, "dp");

export interface ConfirmationTickStats {
  /** teyitli → teyit bekliyor / süresi doldu geçişleri (BR-03, BR-04) */
  statusChanged: number;
  /** gönderilen "hâlâ geçerli mi?" soruları (BR-02) */
  reminded: number;
  /** push'a cevap gelmediği için giden SMS'ler (docs/04 §5 adım 3) */
  smsSent: number;
}

/**
 * Canlı ilan teyidi (F1) zamanlayıcı işleri + SMS linkiyle teyit.
 * Tur her 5 dakikada bir çalışır (PeriodicScheduler); her adım tekrar çalıştırılabilir (idempotent).
 */
@Injectable()
export class ConfirmationService {
  private readonly logger = new Logger(ConfirmationService.name);
  /** Geçerli teyit parametreleri (FR-54 ayarı); her turun başında okunur */
  private p: ConfirmationParams = DEFAULT_CONFIRMATION_PARAMS;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly sms: SmsService,
    private readonly settings: SettingsService,
  ) {}

  async tick(now = new Date()): Promise<ConfirmationTickStats> {
    // Tur boyunca aynı parametreler; aynı anda çalışan anında teyit de aynı değeri okur (ayar değişince en geç 15 sn)
    this.p = await this.settings.confirmation();
    // Sıra önemli: önce düşür (cevapsızlar), sonra yeni soruları sor, en son SMS yedeği
    const statusChanged = await this.updateStatuses(now);
    const reminded = await this.sendReminders(now);
    const smsSent = await this.sendSmsFallbacks(now);
    return { statusChanged, reminded, smsSent };
  }

  // ── 1. Durum düşürme (BR-03, BR-04) ────────────────────────────────

  /**
   * Kuralın kendisi shared `evaluateLoadStatus`'ta (tek doğruluk kaynağı, testli). Buradaki SQL yalnız
   * *değişmesi gereken* satırları seçer; böylece değişmeyecek satırlar her turda tekrar tekrar taranmaz
   * ve BATCH sınırı değişmesi gerekenleri aç bırakmaz.
   */
  private async updateStatuses(now: Date): Promise<number> {
    const answerDeadline = new Date(now.getTime() - this.p.answerWindowH * HOUR);
    const graceDeadline = new Date(now.getTime() - (this.p.answerWindowH + this.p.pendingGraceH) * HOUR);
    const due = or(
      lt(loadPosts.loadTo, trDay(now)),
      and(eq(loadPosts.status, "teyitli"), lte(loadPosts.reminderSentAt, answerDeadline)),
      and(eq(loadPosts.status, "teyit_bekliyor"), lte(loadPosts.reminderSentAt, graceDeadline)),
    ) as SQL;

    let changed = 0;
    // Güvenlik sınırı: seçilen her satır değişmeli; kural ileride değişip bu bozulursa döngü sonsuza gitmesin
    for (let round = 0; round < 20; round++) {
      const batch = await this.db.transaction(async (tx) => {
        // Satır kilidi: sahibi aynı anda teyit ediyorsa o satır bu turda atlanır, sonraki turda taze haliyle bakılır
        const rows = await tx
          .select()
          .from(loadPosts)
          .where(and(inArray(loadPosts.status, [...VISIBLE_LOAD_STATUSES]), due))
          .limit(BATCH)
          .for("update", { skipLocked: true });

        for (const l of rows) {
          const next = evaluateLoadStatus(
            {
              status: l.status,
              lastConfirmedAt: l.lastConfirmedAt,
              reminderSentAt: l.reminderSentAt,
              loadFromStart: trDayStart(l.loadFrom),
              loadToEnd: trDayEnd(l.loadTo),
            },
            now,
            this.p,
          );
          if (next === l.status) continue;
          await tx.update(loadPosts).set({ status: next }).where(eq(loadPosts.id, l.id));
          if (next === "suresi_doldu") {
            // Açık soru cevapsız kapanır: SMS linki geçersizleşir; BR-06 (güven skoru) ve metrikler bunu sayar
            await tx
              .update(loadConfirmations)
              .set({ answer: "cevapsiz" })
              .where(and(eq(loadConfirmations.loadPostId, l.id), isNull(loadConfirmations.answer)));
          }
          changed++;
        }
        return rows.length;
      });
      if (batch < BATCH) return changed;
    }
    this.logger.warn("Durum düşürme 20 turda bitmedi; kalanlar sonraki tura kaldı");
    return changed;
  }

  // ── 2. "Hâlâ geçerli mi?" sorusu (BR-02) ───────────────────────────

  private async sendReminders(now: Date): Promise<number> {
    const asked = await this.db.transaction(async (tx) => {
      // "Henüz sorulmamış ve zamanı gelmiş" koşulu UPDATE'in içinde: sahibi bu arada teyit ettiyse
      // next_reminder_at ileri gitmiştir ve ilan ikinci kez sorulmaz.
      const due = tx
        .select({ id: loadPosts.id })
        .from(loadPosts)
        .where(and(eq(loadPosts.status, "teyitli"), isNull(loadPosts.reminderSentAt), lte(loadPosts.nextReminderAt, now)))
        .limit(BATCH)
        .for("update", { skipLocked: true });
      const loads = await tx
        .update(loadPosts)
        .set({ reminderSentAt: now })
        .where(inArray(loadPosts.id, due))
        .returning({ id: loadPosts.id, shipperId: loadPosts.shipperId });
      if (loads.length === 0) return [];
      const questions = await tx
        .insert(loadConfirmations)
        .values(loads.map((l) => ({ loadPostId: l.id, askedAt: now })))
        .returning({ id: loadConfirmations.id, loadPostId: loadConfirmations.loadPostId });
      return questions.map((q) => ({ ...q, shipperId: loads.find((l) => l.id === q.loadPostId)!.shipperId }));
    });
    if (asked.length === 0) return 0;

    // Bildirimler transaction dışında: gönderilemese de soru açık kalır ve SMS yedeği devreye girer
    const routes = await this.routes(asked.map((a) => a.loadPostId));
    for (const a of asked) {
      const r = routes.get(a.loadPostId);
      // Bildirim hatası turu durdurmasın: soru açık kalır, SMS yedeği devreye girer
      await this.notifications
        .notify(a.shipperId, {
          type: "load_confirm",
          refKey: `confirm:${a.id}`,
          title: "İlanınız hâlâ geçerli mi?",
          body: r ? `${r.origin.province}/${r.origin.district} → ${r.dest.province}/${r.dest.district}` : "Yük ilanınız",
          data: { type: "load_confirm", loadId: a.loadPostId, confirmationId: a.id },
          actions: [
            { id: "gecerli", title: "Evet, geçerli" },
            { id: "arac_bulundu", title: "Araç bulundu" },
            { id: "iptal", title: "İptal" },
          ],
        })
        .catch((e: Error) => this.logger.warn(`Bildirim gönderilemedi (${a.loadPostId}): ${e.message}`));
    }
    return asked.length;
  }

  // ── 3. SMS yedeği (docs/04 §5 adım 3) ──────────────────────────────

  private async sendSmsFallbacks(now: Date): Promise<number> {
    const deadline = new Date(now.getTime() - this.p.smsFallbackMin * 60_000);
    const rows = await this.db
      .select({ id: loadConfirmations.id, loadPostId: loadConfirmations.loadPostId, phone: users.phone })
      .from(loadConfirmations)
      .innerJoin(loadPosts, eq(loadPosts.id, loadConfirmations.loadPostId))
      .innerJoin(users, eq(users.id, loadPosts.shipperId))
      .where(
        and(
          isNull(loadConfirmations.answer),
          isNull(loadConfirmations.pushOpenedAt),
          isNull(loadConfirmations.smsSentAt),
          lte(loadConfirmations.askedAt, deadline),
          inArray(loadPosts.status, [...VISIBLE_LOAD_STATUSES]),
          isNotNull(users.phone), // silinen hesabın numarası yok (ilanları da kapanmıştır)
        ),
      )
      .limit(BATCH);
    if (rows.length === 0) return 0;

    const routes = await this.routes(rows.map((r) => r.loadPostId));
    const webUrl = (process.env.WEB_URL ?? "http://localhost:3001").replace(/\/+$/, "");
    let sent = 0;
    for (const r of rows) {
      const route = routes.get(r.loadPostId);
      if (!route || !r.phone) continue;
      const token = randomToken(12);
      // Önce sahiplen (sms_sent_at), sonra gönder: iki tur aynı SMS'i iki kez atmasın
      const [claimed] = await this.db
        .update(loadConfirmations)
        .set({ smsSentAt: now, smsTokenHash: sha256(token) })
        .where(and(eq(loadConfirmations.id, r.id), isNull(loadConfirmations.smsSentAt)))
        .returning({ id: loadConfirmations.id });
      if (!claimed) continue;
      try {
        await this.sms.send(r.phone, confirmationSmsText(route.origin, route.dest, `${webUrl}/t/${token}`));
        sent++;
      } catch (e) {
        // Gönderilemedi: işareti geri al, sonraki turda yeni token'la tekrar denensin
        await this.db
          .update(loadConfirmations)
          .set({ smsSentAt: null, smsTokenHash: null })
          .where(eq(loadConfirmations.id, r.id));
        this.logger.warn(`Teyit SMS'i gönderilemedi (${r.loadPostId}): ${(e as Error).message}`);
      }
    }
    return sent;
  }

  // ── BR-05: şikayetle anında teyit ─────────────────────────────────

  /**
   * İlanı hemen "teyit bekliyor"a çeker ve sahibine anında soru gönderir. Yalnız "teyitli" ilanda çalışır;
   * zaten bekliyorsa ya da yayında değilse bir şey yapmaz (aynı anda iki çağrı gelse de tek soru açılır).
   * reminder_sent_at cevap penceresi kadar geriye yazılır: böylece evaluateLoadStatus'a göre BR-04'ün 12 saati
   * "teyit bekliyor"a girildiği an başlar (normal akışta da 4 saat cevapsızlıktan sonra başlıyor).
   */
  async forceReconfirm(loadId: string, now = new Date()): Promise<boolean> {
    this.p = await this.settings.confirmation();
    const asked = await this.db.transaction(async (tx) => {
      const [l] = await tx.select().from(loadPosts).where(eq(loadPosts.id, loadId)).for("update");
      if (!l || l.status !== "teyitli") return null;
      await tx
        .update(loadPosts)
        .set({ status: "teyit_bekliyor", reminderSentAt: new Date(now.getTime() - this.p.answerWindowH * HOUR) })
        .where(eq(loadPosts.id, loadId));
      // Açık soru varsa (ör. 1 saat önce sorulmuş) o kullanılır; yoksa yeni soru açılır (30 dk sonra SMS yedeği)
      const [open] = await tx
        .select({ id: loadConfirmations.id })
        .from(loadConfirmations)
        .where(and(eq(loadConfirmations.loadPostId, loadId), isNull(loadConfirmations.answer)));
      const question =
        open ??
        (await tx.insert(loadConfirmations).values({ loadPostId: loadId, askedAt: now }).returning({ id: loadConfirmations.id }))[0]!;
      return { shipperId: l.shipperId, confirmationId: question.id };
    });
    if (!asked) return false;

    this.logger.log(`BR-05: ilan ${loadId} şikayetler üzerine teyide düştü`);
    await this.notifications
      .notify(asked.shipperId, {
        type: "load_confirm",
        refKey: `confirm:${asked.confirmationId}:reports`,
        title: "Yükünüzün gittiği bildirildi",
        body: "Yük hâlâ duruyorsa tek dokunuşla teyit edin; cevap gelmezse ilan 12 saat içinde yayından kalkar.",
        data: { type: "load_confirm", loadId, confirmationId: asked.confirmationId, reason: "reports" },
        actions: [
          { id: "gecerli", title: "Hâlâ geçerli" },
          { id: "arac_bulundu", title: "Araç bulundu" },
          { id: "iptal", title: "İptal" },
        ],
      })
      .catch((e: Error) => this.logger.warn(`Bildirim gönderilemedi (${loadId}): ${e.message}`));
    return true;
  }

  // ── SMS linkiyle teyit (giriş gerektirmez) ─────────────────────────

  /**
   * Token → açık soru ve görünür ilan. Geçersiz, kullanılmış (soru cevaplanmış/cevapsız kapanmış) ya da
   * ilan artık görünür değilse null. Token tek kullanımlıktır: cevap verilince soru kapanır.
   */
  async findByToken(token: string) {
    if (!TOKEN_RE.test(token)) return null;
    const [row] = await this.db
      .select({
        load: loadPosts,
        askedAt: loadConfirmations.askedAt,
        origin: { district: od.name, province: op.name },
        dest: { district: dd.name, province: dp.name },
      })
      .from(loadConfirmations)
      .innerJoin(loadPosts, eq(loadPosts.id, loadConfirmations.loadPostId))
      .innerJoin(od, eq(od.id, loadPosts.originDistrictId))
      .innerJoin(op, eq(op.id, od.provinceId))
      .innerJoin(dd, eq(dd.id, loadPosts.destDistrictId))
      .innerJoin(dp, eq(dp.id, dd.provinceId))
      .where(and(eq(loadConfirmations.smsTokenHash, sha256(token)), isNull(loadConfirmations.answer)));
    if (!row || !VISIBLE_LOAD_STATUSES.includes(row.load.status)) return null;
    return row;
  }

  private async routes(loadIds: string[]) {
    const rows = await this.db
      .select({
        id: loadPosts.id,
        origin: { district: od.name, province: op.name },
        dest: { district: dd.name, province: dp.name },
      })
      .from(loadPosts)
      .innerJoin(od, eq(od.id, loadPosts.originDistrictId))
      .innerJoin(op, eq(op.id, od.provinceId))
      .innerJoin(dd, eq(dd.id, loadPosts.destDistrictId))
      .innerJoin(dp, eq(dp.id, dd.provinceId))
      .where(inArray(loadPosts.id, loadIds));
    return new Map(rows.map((r) => [r.id, r]));
  }
}
