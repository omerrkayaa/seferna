import { isIP } from "node:net";
import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { ACCOUNT_DELETION } from "@nakliye/shared";
import { JwtService } from "@nestjs/jwt";
import { and, asc, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import { trDateTime, trDuration } from "../common/format.js";
import { deletedPhoneHmac, randomToken, sha256, sixDigitCode } from "../common/hash.js";
import { SmsService } from "../common/sms.service.js";
import { DB, type Db, type Tx } from "../db/db.module.js";
import { mfaChallenges, otpCodes, otpRequests, refreshTokens, userRoles, users, userTotp } from "../db/schema.js";

// docs/04 §8: OTP 6 hane, 3 dk geçerli, 5 deneme
const OTP_TTL_MS = 3 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_MS = 60_000;
const REFRESH_TTL_MS = 30 * 24 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
const HOUR_MS = 3_600_000;
/** NFR-04: SMS kodundan sonra ikinci adım için süre; yönetici rolünün ikinci adımdan sonra geçerli kaldığı süre */
const MFA_CHALLENGE_MS = 5 * 60_000;
export const ADMIN_MFA_MS = 12 * HOUR_MS;
const mfaFresh = (mfaAt: Date | null, now = new Date()) => !!mfaAt && mfaAt <= now && now.getTime() - mfaAt.getTime() < ADMIN_MFA_MS;

/**
 * NFR-04 kod isteği sınırları (2026-10-14 kararı: numara başına günde ~5–10, IP başına saatte ~20 farklı
 * numara). Ortam değişkeniyle değişir; 0 = kapalı. Test sunucusunda IP sınırı kapalı çalışır (tüm takımlar tek
 * makineden yüzlerce numarayla girer); güvenlik takımı sınırları açık kendi sunucusunu başlatır.
 */
const limit = (key: string, fallback: number) => {
  const v = process.env[key];
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};
export const otpPhoneDailyLimit = () => limit("OTP_PHONE_DAILY_LIMIT", 10);
export const otpIpHourlyLimit = () => limit("OTP_IP_HOURLY_LIMIT", 20);

/**
 * IP sınırının anahtarı: IPv4 adresin kendisi (IPv4-eşlemeli IPv6 da); IPv6'da /64 ağı. Bir abone genelde koca bir /64
 * alır: adres başına saymak, her istekte başka adres kullananı hiç durdurmazdı. IP değilse null (sınır uygulanmaz).
 */
export function ipLimitKey(ip: string | null): string | null {
  if (!ip) return null;
  const v = isIP(ip);
  if (v === 4) return ip;
  if (v !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  // Sondaki gömülü IPv4 (a.b.c.d) iki 16 bitlik gruba çevrilir; "::" eksik sıfır gruplarıyla açılır
  const hex = ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) => `${((+a << 8) | +b).toString(16)}:${((+c << 8) | +d).toString(16)}`);
  const [head, tail] = hex.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(8 - h.length - t.length).fill("0"), ...t];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}
// Destek kanalı (W4 iletişim) gelince mesaja eklenmeli
export const SUSPENDED_MESSAGE = "Hesabınız askıya alındı.";
/** Silme başladı ama anonimleştirme bitmedi (zamanlayıcı tamamlar); numara o ana kadar yeni hesaba açılamaz */
const DELETING_MESSAGE = "Hesap silme işlemi sürüyor. Birkaç dakika sonra tekrar deneyin.";
const OTP_SMS = {
  giris: (code: string) => `Seferna giriş kodunuz: ${code}. Kimseyle paylaşmayın.`,
  // Türkçe karakterli SMS 70 karakterle sınırlı (UCS-2); bu metin 58 karakter
  silme: (code: string) => `Seferna hesap silme kodunuz: ${code}. Kimseyle paylaşmayın.`,
};
/** Kodun amacı (otp_codes.purpose): giriş kodu silmede, silme kodu girişte geçmez */
export type OtpPurpose = keyof typeof OTP_SMS;

/**
 * Demo hesabı (mobil uygulamayı telefonda denemek için): DEMO_PHONE'a her zaman DEMO_OTP gider.
 * Yalnız SMS konsola yazılırken (geliştirme) geçerli; gerçek sağlayıcı bağlanınca kendiliğinden kapanır.
 */
function demoCode(phone: string): string | null {
  const { DEMO_PHONE, DEMO_OTP, SMS_PROVIDER = "console" } = process.env;
  if (SMS_PROVIDER !== "console" || !DEMO_PHONE || !/^\d{6}$/.test(DEMO_OTP ?? "")) return null;
  return phone === DEMO_PHONE ? DEMO_OTP! : null;
}

/** Girişte hesap bu arada aktiflikten çıktıysa (askı, silme, dondurma ile yarış) */
export const loginDenied = (status: string | undefined) =>
  status === "askida" ? new ForbiddenException(SUSPENDED_MESSAGE) : status === "silindi" ? new ForbiddenException(DELETING_MESSAGE) : new UnauthorizedException("Giriş yapılamadı; tekrar deneyin");
/** Askıya alınan hesabın belirteçleri askıya alırken iptal edilir; bu ikinci kilit (yarışta açık kalanlar için) */
const refreshDenied = (status: string | undefined) => new UnauthorizedException(status === "askida" ? SUSPENDED_MESSAGE : "Oturum süresi doldu");

export interface AccessPayload {
  sub: string;
  roles: string[];
  /** İkinci adımın geçildiği an (epoch ms); yalnız yönetici rolü belirtece girdiyse */
  mfa?: number;
  /** Belirteci basan oturum: refresh_tokens.id (güvenlik incelemesi 2026-10-15; bkz. assertLiveSession) */
  sid?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
  ) {}

  private otpHash(phone: string, code: string) {
    return sha256(`${phone}:${code}:${process.env.OTP_PEPPER ?? ""}`);
  }

  private otpKey(phone: string, purpose: OtpPurpose) {
    return and(eq(otpCodes.phone, phone), eq(otpCodes.purpose, purpose));
  }

  /**
   * Kod gönderir. Sınırlar (NFR-04): aynı amaçla 60 sn'de bir; numara başına 24 saatte OTP_PHONE_DAILY_LIMIT kod (giriş +
   * silme birlikte); IP başına saatte OTP_IP_HOURLY_LIMIT farklı numara (aynı numarayı yeniden istemek sayılmaz). Sınırı
   * aşan istek 429 ve ne zaman tekrar denenebileceği. Denetim ve kayıt numara (ve IP) kilidi altında: paralel istekler
   * sınırı aşamaz. Kilit sırası her zaman numara → IP (kilitlenme olmasın). Demo numarası (yalnız geliştirme) sınırsız.
   * @param rawIp istemci adresi (Express trust proxy ile çözülmüş); yoksa ya da IP değilse IP sınırı uygulanmaz (güvenilen
   *   vekil zincirinin sonundaki değer istemcinin yazdığı bir metin olabilir). Kayda ipLimitKey yazılır.
   */
  async requestOtp(phone: string, purpose: OtpPurpose = "giris", rawIp: string | null = null, now = new Date()): Promise<void> {
    const ip = ipLimitKey(rawIp);
    const demo = demoCode(phone);
    const code = demo ?? sixDigitCode();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`otp:${phone}`}))`);
      const [existing] = await tx.select().from(otpCodes).where(this.otpKey(phone, purpose));
      if (existing && existing.expiresAt.getTime() - OTP_TTL_MS + OTP_RESEND_MS > now.getTime()) {
        throw new HttpException("Yeni kod için biraz bekleyin", HttpStatus.TOO_MANY_REQUESTS);
      }
      if (!demo) await this.checkRequestLimits(tx, phone, ip, now);
      await tx.insert(otpRequests).values({ phone, ip, purpose, createdAt: now });
      const row = { phone, purpose, codeHash: this.otpHash(phone, code), expiresAt: new Date(now.getTime() + OTP_TTL_MS), attempts: 0 };
      await tx.insert(otpCodes).values(row).onConflictDoUpdate({ target: [otpCodes.phone, otpCodes.purpose], set: row });
    });
    await this.sms.send(phone, OTP_SMS[purpose](code));
  }

  private async checkRequestLimits(tx: Tx, phone: string, ip: string | null, now: Date) {
    const daily = otpPhoneDailyLimit();
    if (daily > 0) {
      const recent = await tx
        .select({ at: otpRequests.createdAt })
        .from(otpRequests)
        .where(and(eq(otpRequests.phone, phone), gt(otpRequests.createdAt, new Date(now.getTime() - DAY_MS))))
        .orderBy(asc(otpRequests.createdAt))
        .limit(daily);
      if (recent.length >= daily) {
        // En eski istek 24 saati doldurunca bir hak açılır
        const wait = recent[0]!.at.getTime() + DAY_MS - now.getTime();
        throw new HttpException(`Bu numara için çok fazla kod istendi. ${trDuration(wait)} sonra tekrar deneyin.`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    const hourly = otpIpHourlyLimit();
    if (ip && hourly > 0) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`otp-ip:${ip}`}))`);
      // Bu IP'den son bir saatte kod istenen başka numaralar; her numaranın son isteği (o çıkınca sayı düşer)
      const others = await tx
        .select({ last: sql<string>`max(${otpRequests.createdAt})` })
        .from(otpRequests)
        .where(and(eq(otpRequests.ip, ip), gt(otpRequests.createdAt, new Date(now.getTime() - HOUR_MS)), ne(otpRequests.phone, phone)))
        .groupBy(otpRequests.phone)
        .orderBy(sql`max(${otpRequests.createdAt})`);
      if (others.length >= hourly) {
        const wait = new Date(others[0]!.last).getTime() + HOUR_MS - now.getTime();
        throw new HttpException(`Çok fazla deneme yaptınız. ${trDuration(wait)} sonra tekrar deneyin.`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }

  /** Zamanlayıcı: 2 günden eski kod isteği kayıtları (sınırlar en çok 24 saate bakar) */
  async purgeOtpRequests(now = new Date()): Promise<number> {
    const r = await this.db.delete(otpRequests).where(lt(otpRequests.createdAt, new Date(now.getTime() - 2 * DAY_MS))).returning({ id: otpRequests.id });
    return r.length;
  }

  /** Kodu doğrular ve harcar (tek kullanımlık); her deneme hakkından düşer. Giriş ve hesap silme kullanır. */
  async consumeOtp(phone: string, code: string, purpose: OtpPurpose = "giris"): Promise<void> {
    const key = this.otpKey(phone, purpose);
    const expired = () => new UnauthorizedException("Kodun süresi doldu, yeni kod isteyin");
    // Deneme hakkı karşılaştırmadan önce atomik ayrılır: aynı anda gelen denemelerden (doğrusu dahil) en çok
    // OTP_MAX_ATTEMPTS tanesi karşılaştırılır. Önce okuyup sonra artırmak paralel tahminlerin hepsini değerlendirirdi.
    const [otp] = await this.db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(and(key, lt(otpCodes.attempts, OTP_MAX_ATTEMPTS), gt(otpCodes.expiresAt, new Date())))
      .returning({ codeHash: otpCodes.codeHash });
    if (!otp) throw expired();
    if (otp.codeHash !== this.otpHash(phone, code)) throw new UnauthorizedException("Kod hatalı");
    // Aynı doğru kodla gelen paralel isteklerden yalnız satırı silen geçer (kod tek kullanımlık)
    const used = await this.db.delete(otpCodes).where(and(key, eq(otpCodes.codeHash, otp.codeHash))).returning({ phone: otpCodes.phone });
    if (used.length === 0) throw expired();
  }

  async verifyOtp(phone: string, code: string) {
    await this.consumeOtp(phone, code);

    // BR-12: bir telefon numarası = tek hesap. Silinen hesabın numarası boşaltılır; süresi içinde dönülürse eski hesap
    // geri açılır, yoksa yeni hesap
    let [user] = await this.db.select().from(users).where(eq(users.phone, phone));
    /** İstemci notu: dondurulan hesap girişle açıldı ya da silinen hesap süresi içinde geri açıldı */
    let reopened: "dondurma" | "silme" | null = null;
    if (!user) {
      [user] = await this.restoreDeleted(phone);
      if (user) reopened = "silme";
    }
    const isNew = !user;
    if (!user) [user] = await this.db.insert(users).values({ phone }).returning();
    if (user!.status === "donduruldu") {
      // FR-08: SMS koduyla kimliğini doğrulayan sahibi hesabı açar
      const [opened] = await this.db.update(users).set({ status: "aktif" }).where(and(eq(users.id, user!.id), eq(users.status, "donduruldu"))).returning();
      if (opened) reopened = "dondurma";
      else [user] = await this.db.select().from(users).where(eq(users.id, user!.id)); // bu arada askıya alındı
    }
    if (user!.status === "askida") throw new ForbiddenException(SUSPENDED_MESSAGE);
    if (user!.status === "silindi") throw new ForbiddenException(DELETING_MESSAGE);

    // NFR-04: ikinci adımı kurulu hesap (yönetici) SMS koduyla tek başına oturum almaz: 5 dk geçerli challenge döner,
    // doğrulama uygulamasındaki kod POST /auth/totp ile (MfaService.login)
    if (await this.totpEnabled(user!.id)) {
      const challenge = randomToken();
      await this.db.insert(mfaChallenges).values({ tokenHash: sha256(challenge), userId: user!.id, expiresAt: new Date(Date.now() + MFA_CHALLENGE_MS) });
      return { isNew, ...(reopened ? { reopened } : {}), mfaRequired: true as const, challenge };
    }
    const tokens = await this.db.transaction((tx) => this.issueTokens(tx, user!.id, loginDenied));
    return { isNew, ...(reopened ? { reopened } : {}), ...tokens };
  }

  /**
   * FR-07: ACCOUNT_DELETION.restoreDays içinde silinen hesap aynı numarayla geri açılır — aldığı puanlar, güven skoru,
   * iş geçmişi ve hakkındaki açık şikayetler geri gelir; ad, firma, rol ve araçlar silinmişti, yeniden girilir. Silmeden
   * sonraki ACCOUNT_DELETION.reopenAfterDays gün giriş kapalı (403, açılış anıyla). Engel kod doğrulandıktan sonra:
   * kod istenirken söylenseydi numarayı yazan herkes "yakın zamanda silinmiş" bilgisini öğrenirdi. Yalnız
   * anonimleştirmesi bitmiş (numarası boşalmış) hesap; bitmemişse giriş "silme sürüyor" der.
   */
  private async restoreDeleted(phone: string, now = new Date()) {
    const [old] = await this.db
      .select({ id: users.id, deletedAt: users.deletedAt })
      .from(users)
      .where(
        and(
          eq(users.phoneHmac, deletedPhoneHmac(phone)),
          eq(users.status, "silindi"),
          isNull(users.phone),
          gt(users.deletedAt, new Date(now.getTime() - ACCOUNT_DELETION.restoreDays * DAY_MS)),
        ),
      );
    if (!old) return [];
    const opensAt = new Date(old.deletedAt!.getTime() + ACCOUNT_DELETION.reopenAfterDays * DAY_MS);
    if (opensAt > now) throw new ForbiddenException(`Hesabınız yakın zamanda silindi. Aynı numarayla ${trDateTime(opensAt)} itibarıyla yeniden giriş yapabilirsiniz.`);
    return this.db
      .update(users)
      .set({ phone, phoneHmac: null, status: "aktif", deletedAt: null, name: null })
      .where(and(eq(users.id, old.id), eq(users.status, "silindi"), isNull(users.phone)))
      .returning();
  }

  /**
   * Yenileme belirteci tek kullanımlıktır (rotation). Kullanma atomik: aynı belirteçle gelen paralel isteklerden yalnız
   * biri satırı iptal edip yeni çift alır (önce okuyup sonra koşulsuz yazmak ikisine de verirdi). Hesap aktif değilse
   * belirteç kullanılmamış kalır (askı kalkınca yine çalışır).
   */
  async refresh(refreshToken: string) {
    const hash = sha256(refreshToken);
    return this.db.transaction(async (tx) => {
      const [found] = await tx.select({ userId: refreshTokens.userId, mfaAt: refreshTokens.mfaAt }).from(refreshTokens).where(eq(refreshTokens.tokenHash, hash));
      if (!found) throw new UnauthorizedException("Oturum süresi doldu");
      // Kilit sırası dondurma ve silmeyle aynı (önce kullanıcı satırı, sonra belirteç): ters sıra kilitlenme (deadlock) üretirdi
      const [owner] = await tx.select({ status: users.status }).from(users).where(eq(users.id, found.userId)).for("share");
      if (owner?.status !== "aktif") throw refreshDenied(owner?.status);
      const now = new Date();
      // Yönetici (ikinci adımı kurulu) oturumu ikinci adımdan en çok 12 saat sonra kapanır: SMS + uygulama koduyla yeniden giriş
      if (!mfaFresh(found.mfaAt, now) && (await this.totpEnabled(found.userId, tx))) throw new UnauthorizedException("Yönetici oturumunun süresi doldu; yeniden giriş yapın.");
      const [row] = await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, now)))
        .returning({ userId: refreshTokens.userId });
      if (!row) throw new UnauthorizedException("Oturum süresi doldu");
      return this.issueTokens(tx, row.userId, refreshDenied, found.mfaAt);
    });
  }

  async logout(refreshToken: string) {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, sha256(refreshToken)));
  }

  /**
   * Güncel rollerle erişim belirteci üretir. Roller belirtecin içinde taşındığı için rol değişince
   * (POST /me/roles) yeni belirteç verilir; yoksa kullanıcı belirteç süresi dolana kadar eski rollerle kalır.
   * Yönetici rolü yalnız ikinci adımı son 12 saatte geçmiş oturuma girer (NFR-04): kurulumsuz yöneticinin belirtecinde
   * rol yoktur, böylece tüm yönetici denetimleri (Roles guard, "yönetici her belgeyi görür") ikinci adım ister.
   * @param mfaAt oturumun ikinci adım anı (refresh_tokens.mfa_at; belirteçte `mfa`)
   * @param sid belirteci basan oturumun yenileme satırı: her erişim belirteci açık bir oturuma bağlı (assertLiveSession)
   */
  async accessTokenFor(userId: string, mfaAt: Date | null, db: Db | Tx, sid: string): Promise<string> {
    const rows = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId));
    const mfa = mfaFresh(mfaAt) && (await this.totpEnabled(userId, db));
    const roles = rows.map((r) => r.role).filter((r) => mfa || r !== "admin");
    const payload: AccessPayload = { sub: userId, roles, sid, ...(mfa ? { mfa: mfaAt!.getTime() } : {}) };
    return this.jwt.signAsync(payload);
  }

  /**
   * Yenileme belirteci olmadan yeni erişim belirteci basan uçlar (POST /me/roles) için: belirteci basan oturum hâlâ açık
   * olmalı. Yoksa çıkış, cihaz değiştirme ya da yenilemeyle kapanan oturumun erişim belirteci kendini her 15 dakikada
   * yenileyip sonsuza (yöneticide 12 saate) kadar yaşardı (güvenlik incelemesi 2026-10-15, bulgu 1). Yenilemede eski
   * satır iptal edildiği için eski erişim belirteci de buradan geçemez.
   */
  async assertLiveSession(user: AccessPayload, now = new Date()): Promise<void> {
    const [row] = user.sid
      ? await this.db
          .select({ id: refreshTokens.id })
          .from(refreshTokens)
          .where(and(eq(refreshTokens.id, user.sid), eq(refreshTokens.userId, user.sub), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, now)))
      : [];
    if (!row) throw new UnauthorizedException("Oturum süresi doldu");
  }

  /** İkinci adım (TOTP) kurulu ve etkin mi */
  async totpEnabled(userId: string, db: Db | Tx = this.db): Promise<boolean> {
    const [t] = await db.select({ on: userTotp.enabledAt }).from(userTotp).where(eq(userTotp.userId, userId));
    return !!t?.on;
  }

  /**
   * Yeni belirteç çifti, kullanıcı satırı paylaşımlı kilitliyken ve hesap hâlâ aktifse yazılır. Dondurma, silme ve askıya
   * alma satırı güncelleyip (satır kilidi) belirteçleri iptal eder: bu sıra sayesinde onlarla yarışan bir giriş ya da
   * yenileme, iptal edilmemiş (hesap açılınca yeniden geçerli olacak) bir belirteç bırakamaz.
   * @param mfaAt ikinci adım anı (MfaService girişte/kurulumda verir, yenileme taşır)
   */
  async issueTokens(tx: Tx, userId: string, denied: (status: string | undefined) => Error, mfaAt: Date | null = null) {
    const [u] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId)).for("share");
    if (u?.status !== "aktif") throw denied(u?.status);
    const refreshToken = randomToken();
    const [session] = await tx
      .insert(refreshTokens)
      .values({ userId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TTL_MS), mfaAt })
      .returning({ id: refreshTokens.id });
    const accessToken = await this.accessTokenFor(userId, mfaAt, tx, session!.id);
    return { accessToken, refreshToken };
  }
}
