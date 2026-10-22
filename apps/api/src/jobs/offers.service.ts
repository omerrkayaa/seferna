import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  isVerifiedBadge,
  maskPhone,
  vehicleFitError,
  VISIBLE_LOAD_STATUSES,
  type BodyType,
  type CreateOfferInput,
  type VehicleType,
} from "@nakliye/shared";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DB, type Db } from "../db/db.module.js";
import { capacityPosts, companies, districts, loadPosts, matches, offers, provinces, users, vehicles } from "../db/schema.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { TrustService } from "../ratings/trust.service.js";
import { vehicleBusy, vehicleBusyMessage } from "./vehicle-busy.js";

const PAGE_SIZE = 20;
const PG_UNIQUE_VIOLATION = "23505";
const tl = (n: number) => `${new Intl.NumberFormat("tr-TR").format(n)} ₺`;

const od = alias(districts, "od");
const op = alias(provinces, "op");
const dd = alias(districts, "dd");
const dp = alias(provinces, "dp");

/** Teklifler (FR-30, UC-08). Kabul iş oluşturduğu için JobsService'te. */
@Injectable()
export class OffersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly trust: TrustService,
  ) {}

  async create(userId: string, loadId: string, input: CreateOfferInput) {
    const [load] = await this.db.select().from(loadPosts).where(eq(loadPosts.id, loadId));
    if (!load || !VISIBLE_LOAD_STATUSES.includes(load.status)) throw new NotFoundException("İlan bulunamadı");
    if (load.shipperId === userId) throw new BadRequestException("Kendi ilanınıza teklif veremezsiniz");

    const [vehicle] = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, input.vehicleId), eq(vehicles.ownerUserId, userId), eq(vehicles.status, "aktif")));
    if (!vehicle) throw new NotFoundException("Araç bulunamadı");
    const misfit = vehicleFitError(
      { vehicleType: load.vehicleType as VehicleType, bodyType: load.bodyType as BodyType | null, weightTon: load.weightTon },
      { vehicleType: vehicle.vehicleType as VehicleType, bodyType: vehicle.bodyType as BodyType, capacityTon: vehicle.capacityTon },
    );
    if (misfit) throw new BadRequestException(misfit);
    const busy = await vehicleBusy(this.db, vehicle.id, load.loadFrom, load.loadTo);
    if (busy) throw new ConflictException(vehicleBusyMessage(busy));

    let offerId: string;
    try {
      const [row] = await this.db
        .insert(offers)
        .values({ loadPostId: loadId, carrierId: userId, vehicleId: vehicle.id, price: input.price, note: input.note ?? null })
        .returning({ id: offers.id });
      offerId = row!.id;
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      if ((err.cause?.code ?? err.code) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException("Bu ilana bekleyen teklifiniz var; değiştirmek için geri çekip yenisini verin");
      }
      throw e;
    }

    // Metrik "eşleşme isabeti": eşleşme teklife dönüştü
    await this.db
      .update(matches)
      .set({ outcome: "teklif" })
      .where(
        and(
          eq(matches.loadPostId, loadId),
          inArray(matches.capacityPostId, this.db.select({ id: capacityPosts.id }).from(capacityPosts).where(eq(capacityPosts.carrierId, userId))),
          or(isNull(matches.outcome), ne(matches.outcome, "teklif")),
        ),
      );

    await this.notifications.notify(load.shipperId, {
      type: "offer_new",
      title: `Yeni teklif: ${tl(input.price)}`,
      body: `${await this.route(loadId)} ilanınıza teklif geldi`,
      data: { type: "offer", loadId, offerId },
    });
    return this.one(offerId);
  }

  /** Yük sahibi: ilanına gelen teklifler (bekleyenler önce, ucuzdan pahalıya). */
  async forLoad(userId: string, loadId: string) {
    const [load] = await this.db
      .select({ id: loadPosts.id })
      .from(loadPosts)
      .where(and(eq(loadPosts.id, loadId), eq(loadPosts.shipperId, userId)));
    if (!load) throw new NotFoundException("İlan bulunamadı");
    const rows = await this.selectOffers()
      .where(eq(offers.loadPostId, loadId))
      .orderBy(sql`case when ${offers.status} = 'beklemede' then 0 else 1 end`, asc(offers.price), asc(offers.createdAt));
    // P5 karşılaştırma: puan ve tamamlanan iş (profildeki sayılarla aynı kaynak; bir ilanda teklif az olduğu için tek tek)
    const stats = new Map<string, Awaited<ReturnType<TrustService["stats"]>>>();
    for (const id of new Set(rows.map((r) => r.offer.carrierId))) stats.set(id, await this.trust.stats(this.db, id));
    return {
      items: rows.map((r) => ({
        id: r.offer.id,
        status: r.offer.status,
        price: r.offer.price,
        note: r.offer.note,
        createdAt: r.offer.createdAt,
        vehicle: r.vehicle,
        // Kabulden önce numara maskeli (BR-40); kabulle iş detayında açılır (FR-32)
        carrier: {
          id: r.offer.carrierId,
          displayName: r.companyTitle ?? r.carrier.name,
          verified: isVerifiedBadge(r.carrier.level),
          trustScore: Math.round(r.carrier.trust * 100) / 100,
          phoneMasked: maskPhone(r.carrier.phone),
          ...this.reputation(stats.get(r.offer.carrierId)!),
        },
      })),
    };
  }

  /** Nakliyeci: verdiği teklifler ve ilanların güncel durumu. */
  async mine(userId: string, page: number) {
    const rows = await this.db
      .select({
        offer: offers,
        load: { id: loadPosts.id, status: loadPosts.status, loadFrom: loadPosts.loadFrom, loadTo: loadPosts.loadTo, weightTon: loadPosts.weightTon },
        origin: { district: od.name, province: op.name },
        dest: { district: dd.name, province: dp.name },
      })
      .from(offers)
      .innerJoin(loadPosts, eq(loadPosts.id, offers.loadPostId))
      .innerJoin(od, eq(od.id, loadPosts.originDistrictId))
      .innerJoin(op, eq(op.id, od.provinceId))
      .innerJoin(dd, eq(dd.id, loadPosts.destDistrictId))
      .innerJoin(dp, eq(dp.id, dd.provinceId))
      .where(eq(offers.carrierId, userId))
      .orderBy(desc(offers.createdAt))
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE);
    return {
      items: rows.slice(0, PAGE_SIZE).map((r) => ({
        id: r.offer.id,
        status: r.offer.status,
        price: r.offer.price,
        note: r.offer.note,
        createdAt: r.offer.createdAt,
        load: { ...r.load, origin: r.origin, dest: r.dest },
      })),
      page,
      hasMore: rows.length > PAGE_SIZE,
    };
  }

  async withdraw(userId: string, offerId: string) {
    const [row] = await this.db
      .update(offers)
      .set({ status: "geri_cekildi" })
      .where(and(eq(offers.id, offerId), eq(offers.carrierId, userId), eq(offers.status, "beklemede")))
      .returning({ id: offers.id });
    if (!row) {
      const [o] = await this.db.select({ status: offers.status }).from(offers).where(and(eq(offers.id, offerId), eq(offers.carrierId, userId)));
      if (!o) throw new NotFoundException("Teklif bulunamadı");
      throw new ConflictException("Teklif artık beklemede değil");
    }
    return this.one(offerId);
  }

  /**
   * Kabulden sonra: aynı aracın tarihleri çakışan ilanlardaki bekleyen teklifleri geri çekilir (araç artık o günlerde
   * dolu; bırakılsa yük sahibi kabul etmeye çalışıp hata alırdı). Commit'ten sonra çağrılır; kabulün doğruluğu buna
   * bağlı değil (kabul aracı kilitleyip ayrıca kontrol eder).
   */
  async withdrawBusy(vehicleId: string, load: { id: string; loadFrom: string; loadTo: string }): Promise<number> {
    const rows = await this.db
      .update(offers)
      .set({ status: "geri_cekildi" })
      .where(
        and(
          eq(offers.vehicleId, vehicleId),
          eq(offers.status, "beklemede"),
          ne(offers.loadPostId, load.id),
          inArray(
            offers.loadPostId,
            this.db
              .select({ id: loadPosts.id })
              .from(loadPosts)
              .where(and(lte(loadPosts.loadFrom, load.loadTo), gte(loadPosts.loadTo, load.loadFrom))),
          ),
        ),
      )
      .returning({ carrierId: offers.carrierId, loadId: offers.loadPostId, id: offers.id });
    for (const r of rows) {
      await this.notifications.notify(r.carrierId, {
        type: "offer_result",
        refKey: `offer:${r.id}:sonuc`,
        title: "Teklifiniz geri çekildi",
        body: `${await this.route(r.loadId)}: aracınız bu tarihlerde başka bir işe atandı`,
        data: { type: "offer", loadId: r.loadId, offerId: r.id },
      });
    }
    return rows.length;
  }

  /**
   * Zamanlayıcı: ilanı yayından kalkmış (kapandı, iptal, süresi doldu…) bekleyen teklifler sonuçlanmadı sayılır.
   * Teklif kabulünde diğer teklifler zaten anında reddedilir; bu adım dışarıda kapatılan/süresi dolan ilanlar içindir.
   */
  async rejectStale(): Promise<number> {
    const rows = await this.db
      .update(offers)
      .set({ status: "ret" })
      .where(
        and(
          eq(offers.status, "beklemede"),
          inArray(
            offers.loadPostId,
            this.db.select({ id: loadPosts.id }).from(loadPosts).where(notInArray(loadPosts.status, [...VISIBLE_LOAD_STATUSES])),
          ),
        ),
      )
      .returning({ carrierId: offers.carrierId, loadId: offers.loadPostId, id: offers.id });
    for (const r of rows) {
      await this.notifications.notify(r.carrierId, {
        type: "offer_result",
        refKey: `offer:${r.id}:sonuc`,
        title: "Teklifiniz sonuçlanmadı",
        body: `${await this.route(r.loadId)} ilanı yayından kalktı`,
        data: { type: "offer", loadId: r.loadId, offerId: r.id },
      });
    }
    return rows.length;
  }

  // ── Yardımcılar ────────────────────────────────────────────────────

  /** Görünür puanların düz ortalaması (kör puanlama: açılmamış puan sayılmaz) ve tamamlanan iş. */
  private reputation(s: Awaited<ReturnType<TrustService["stats"]>>) {
    return {
      rating: s.avgStars === null ? null : Math.round(s.avgStars * 10) / 10,
      ratingCount: s.ratingCount,
      completedJobs: s.completedJobs,
    };
  }

  private selectOffers() {
    return this.db
      .select({
        offer: offers,
        vehicle: { vehicleType: vehicles.vehicleType, bodyType: vehicles.bodyType, capacityTon: vehicles.capacityTon },
        carrier: { name: users.name, level: users.verificationLevel, trust: users.trustScore, phone: users.phone },
        companyTitle: companies.title,
      })
      .from(offers)
      .innerJoin(vehicles, eq(vehicles.id, offers.vehicleId))
      .innerJoin(users, eq(users.id, offers.carrierId))
      .leftJoin(companies, eq(companies.ownerUserId, offers.carrierId))
      .$dynamic();
  }

  private async one(offerId: string) {
    const [r] = await this.selectOffers().where(eq(offers.id, offerId));
    return {
      id: r!.offer.id,
      loadId: r!.offer.loadPostId,
      status: r!.offer.status,
      price: r!.offer.price,
      note: r!.offer.note,
      createdAt: r!.offer.createdAt,
      vehicle: r!.vehicle,
    };
  }

  async route(loadId: string) {
    const [r] = await this.db
      .select({ o: op.name, od: od.name, d: dp.name, dd: dd.name })
      .from(loadPosts)
      .innerJoin(od, eq(od.id, loadPosts.originDistrictId))
      .innerJoin(op, eq(op.id, od.provinceId))
      .innerJoin(dd, eq(dd.id, loadPosts.destDistrictId))
      .innerJoin(dp, eq(dp.id, dd.provinceId))
      .where(eq(loadPosts.id, loadId));
    return r ? `${r.o}/${r.od} → ${r.d}/${r.dd}` : "Yük";
  }
}
