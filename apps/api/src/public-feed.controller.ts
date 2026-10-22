import { Controller, Get, Inject } from "@nestjs/common";
import { trDay, VISIBLE_LOAD_STATUSES } from "@nakliye/shared";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DB, type Db } from "./db/db.module.js";
import { districts, loadPosts, provinces } from "./db/schema.js";

const od = alias(districts, "od");
const dd = alias(districts, "dd");
const op = alias(provinces, "op");
const dp = alias(provinces, "dp");

/** Tanıtımdaki akışta gösterilen ilan sayısı */
const FEED_SIZE = 6;

/**
 * Tanıtım sayfasındaki canlı yük akışı (karar 2026-10-16); girişsiz. Süzgeç yük akışı ve
 * güzergâh sayfasıyla aynı (teyitli/teyit bekliyor, yükleme günü geçmemiş); en son teyit edilenler önde.
 * Anonim: numara, ad, ilan kimliği, paylaşım kimliği, fiyat ve not dönmez (ilan sahibi tanıtımda yayımlanmayı seçmedi).
 */
@Controller("public/feed")
export class PublicFeedController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async feed() {
    const visible = and(inArray(loadPosts.status, [...VISIBLE_LOAD_STATUSES]), gte(loadPosts.loadTo, trDay(new Date())));
    const [{ n }] = (await this.db.select({ n: count() }).from(loadPosts).where(visible)) as [{ n: number }];
    const rows = await this.db
      .select({
        originDistrict: od.name,
        originProvince: op.name,
        destDistrict: dd.name,
        destProvince: dp.name,
        loadFrom: loadPosts.loadFrom,
        loadTo: loadPosts.loadTo,
        cargoType: loadPosts.cargoType,
        weightTon: loadPosts.weightTon,
        vehicleType: loadPosts.vehicleType,
        status: loadPosts.status,
        lastConfirmedAt: loadPosts.lastConfirmedAt,
      })
      .from(loadPosts)
      .innerJoin(od, eq(od.id, loadPosts.originDistrictId))
      .innerJoin(op, eq(op.id, od.provinceId))
      .innerJoin(dd, eq(dd.id, loadPosts.destDistrictId))
      .innerJoin(dp, eq(dp.id, dd.provinceId))
      .where(visible)
      .orderBy(desc(loadPosts.lastConfirmedAt))
      .limit(FEED_SIZE);
    return {
      activeLoads: n,
      loads: rows.map(({ originDistrict, originProvince, destDistrict, destProvince, ...l }) => ({
        origin: { district: originDistrict, province: originProvince },
        dest: { district: destDistrict, province: destProvince },
        ...l,
      })),
    };
  }
}
