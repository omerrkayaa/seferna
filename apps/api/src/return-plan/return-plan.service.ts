import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ACTIVE_JOB_STATUSES,
  RETURN_PLAN_PARAMS as R,
  ROAD_FACTOR,
  VISIBLE_LOAD_STATUSES,
  estimatedArrivalDay,
  fitRejectReason,
  haversineKm,
  matchLoadWithCapacity,
  onRouteMatch,
  returnCapacity,
  returnWindow,
  trDay,
  typesCarriedBy,
  type BodyType,
  type LatLng,
  type LoadForMatch,
  type VehicleType,
} from "@nakliye/shared";
import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DB, type Db } from "../db/db.module.js";
import { SettingsService } from "../settings/settings.service.js";
import { districts, jobs, loadPosts, provinces, routeAlerts, users, vehicles } from "../db/schema.js";
import { LoadsService } from "../loads/loads.service.js";
import { RoutesService } from "../routes.service.js";

/** SQL ön süzgecinde yarıçaplara eklenen pay (PostGIS sferoid ile shared hesabı sınırda farklı ölçebilir; kesin karar shared'da) */
const MARGIN_KM = 2;
const MAX_CANDIDATES = 300;
/** Listede gösterilen en çok öneri (grup başına) */
const MAX_SUGGESTIONS = 20;

const od = alias(districts, "od");
const op = alias(provinces, "op");
const dd = alias(districts, "dd");
const dp = alias(provinces, "dp");

type Point = { x: number; y: number };
const latLng = (pt: Point): LatLng => ({ lat: pt.y, lng: pt.x });
const geog = (pt: Point) => sql`ST_SetSRID(ST_MakePoint(${pt.x}::float8, ${pt.y}::float8), 4326)::geography`;

/**
 * F4 dönüş planı (FR-24, BR-23). Nakliyecinin süren işi için iki öneri grubu:
 * - **Dönüş yükleri:** işin varışından kalkıp işin kalkış bölgesine giden yükler — BR-20 kuralı, sanal boş araç ilanıyla
 *   (varış noktasından eve, tahmini varış günü … +2, işteki araç).
 * - **Rota üstü ara yükler:** dönüş yolunun (OSRM çizgisi) üstünde, kalkışı ve varışı ≤ 30 km sapan, yönü doğru yükler.
 * Hesap shared'da (tez Deney 2 aynı kuralı kullanır); SQL yalnız aday ön süzgeci.
 */
@Injectable()
export class ReturnPlanService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly loads: LoadsService,
    private readonly routes: RoutesService,
    private readonly settings: SettingsService,
  ) {}

  async plan(carrierId: string, jobId: string, now = new Date()) {
    const [row] = await this.db
      .select({
        job: { id: jobs.id, status: jobs.status, carrierId: jobs.carrierId, deliveredAt: jobs.deliveredAt },
        load: {
          loadFrom: loadPosts.loadFrom,
          loadTo: loadPosts.loadTo,
          originDistrictId: loadPosts.originDistrictId,
          destDistrictId: loadPosts.destDistrictId,
          originGeom: loadPosts.originGeom,
          destGeom: loadPosts.destGeom,
        },
        origin: { districtId: od.id, district: od.name, provinceId: op.id, province: op.name },
        dest: { districtId: dd.id, district: dd.name, provinceId: dp.id, province: dp.name },
        vehicle: { plate: vehicles.plate, vehicleType: vehicles.vehicleType, bodyType: vehicles.bodyType, capacityTon: vehicles.capacityTon },
      })
      .from(jobs)
      .innerJoin(loadPosts, eq(loadPosts.id, jobs.loadPostId))
      .innerJoin(vehicles, eq(vehicles.id, jobs.vehicleId))
      .innerJoin(od, eq(od.id, loadPosts.originDistrictId))
      .innerJoin(op, eq(op.id, od.provinceId))
      .innerJoin(dd, eq(dd.id, loadPosts.destDistrictId))
      .innerJoin(dp, eq(dp.id, dd.provinceId))
      .where(eq(jobs.id, jobId));
    // Başkasının işinin varlığı sızmasın: yük sahibi ya da üçüncü kişi için de 404
    if (!row || row.job.carrierId !== carrierId) throw new NotFoundException("İş bulunamadı");
    if (!ACTIVE_JOB_STATUSES.includes(row.job.status)) throw new ConflictException("Dönüş planı yalnız süren işlerde gösterilir");

    const today = trDay(now);
    const home = row.load.originGeom;
    const there = row.load.destGeom;
    const outboundKm = (await this.routes.roadKm(row.load.originDistrictId, row.load.destDistrictId)) ?? haversineKm(latLng(home), latLng(there)) * ROAD_FACTOR;
    const arrivalDay = estimatedArrivalDay(
      { loadFrom: row.load.loadFrom, roadKm: outboundKm, deliveredDay: row.job.deliveredAt ? trDay(row.job.deliveredAt) : null },
      today,
    );
    const window = returnWindow(arrivalDay);
    const back = await this.routes.routeLine(row.load.destDistrictId, row.load.originDistrictId);
    const vehicle = { type: row.vehicle.vehicleType as VehicleType, bodyType: row.vehicle.bodyType as BodyType, capacityTon: row.vehicle.capacityTon };
    const cap = returnCapacity({ origin: latLng(home), dest: latLng(there), vehicle }, window);

    // Eşleştirmeyle aynı ayar (FR-54): SQL ön süzgeci ve kural aynı yarıçapı kullansın
    const P = await this.settings.matching();
    const line = sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({ type: "LineString", coordinates: back.line.map((p) => [p.lng, p.lat]) })}), 4326)::geography`;
    const within = (col: unknown, target: unknown, km: number) => sql`ST_DWithin((${col})::geography, ${target}, ${km * 1000})`;
    const candidates = await this.db
      .select({ load: loadPosts, trust: users.trustScore })
      .from(loadPosts)
      .innerJoin(users, eq(users.id, loadPosts.shipperId))
      .where(
        and(
          inArray(loadPosts.status, [...VISIBLE_LOAD_STATUSES]),
          gte(loadPosts.loadTo, today),
          ne(loadPosts.shipperId, carrierId),
          inArray(loadPosts.vehicleType, typesCarriedBy(vehicle.type)),
          or(isNull(loadPosts.bodyType), eq(loadPosts.bodyType, vehicle.bodyType)),
          lte(loadPosts.weightTon, vehicle.capacityTon),
          // Tarih: dönüş penceresi ± eşleştirme toleransı (iki uç dahil)
          sql`daterange(${window.from}::date - ${P.dateToleranceDays}::int, ${window.to}::date + ${P.dateToleranceDays}::int, '[]') && daterange(${loadPosts.loadFrom}, ${loadPosts.loadTo}, '[]')`,
          or(
            and(within(loadPosts.originGeom, geog(there), P.originRadiusKm + MARGIN_KM), within(loadPosts.destGeom, geog(home), P.destRadiusKm + MARGIN_KM)),
            and(within(loadPosts.originGeom, line, R.routeMaxDeviationKm + MARGIN_KM), within(loadPosts.destGeom, line, R.routeMaxDeviationKm + MARGIN_KM)),
          ),
        ),
      )
      .limit(MAX_CANDIDATES);

    const returnIds: { id: string; at: number; match: { score: number; originKm: number; destKm: number | null } }[] = [];
    const routeIds: { id: string; at: number; score: number; route: { originDevKm: number; destDevKm: number; coverage: number } }[] = [];
    for (const c of candidates) {
      const load = this.loadForMatch(c.load);
      const m = matchLoadWithCapacity(load, cap, c.trust, P);
      if (m.candidate) {
        returnIds.push({ id: c.load.id, at: c.load.lastConfirmedAt.getTime(), match: { score: m.score, originKm: m.originKm, destKm: m.destKm } });
        continue;
      }
      // Dönüş yükü değilse (ör. kalkışı varış noktasından uzak) rota üstü mü: araç ve tarih yine uymalı
      if (fitRejectReason(load, cap)) continue;
      const r = onRouteMatch(load, back.line);
      if (r.candidate) routeIds.push({ id: c.load.id, at: c.load.lastConfirmedAt.getTime(), score: r.score, route: { originDevKm: r.originDevKm, destDevKm: r.destDevKm, coverage: r.coverage } });
    }
    // Eşit puanda en yeni teyit önce, sonra kimlik: ilk 20 kesilirken sıra tarama sırasına (indekse) bağlı kalmasın
    const tie = (a: { at: number; id: string }, b: { at: number; id: string }) => b.at - a.at || a.id.localeCompare(b.id);
    returnIds.sort((a, b) => b.match.score - a.match.score || tie(a, b));
    routeIds.sort((a, b) => b.score - a.score || tie(a, b));
    const ret = returnIds.slice(0, MAX_SUGGESTIONS);
    const onRoute = routeIds.slice(0, MAX_SUGGESTIONS);
    const cards = new Map((await this.loads.cards([...ret, ...onRoute].map((x) => x.id))).map((c) => [c.id, c]));

    const [alert] = await this.db
      .select({ id: routeAlerts.id })
      .from(routeAlerts)
      .where(
        and(
          eq(routeAlerts.userId, carrierId),
          eq(routeAlerts.active, true),
          eq(routeAlerts.originDistrictId, row.load.destDistrictId),
          eq(routeAlerts.destDistrictId, row.load.originDistrictId),
        ),
      )
      .limit(1);

    return {
      job: {
        id: row.job.id,
        status: row.job.status,
        origin: row.origin,
        dest: row.dest,
        loadFrom: row.load.loadFrom,
        loadTo: row.load.loadTo,
        deliveredAt: row.job.deliveredAt,
        vehicle: row.vehicle,
        arrivalDay,
        window,
        outboundKm: Math.round(outboundKm),
        returnKm: Math.round(back.km),
        // "kus_ucusu": OSRM'ye ulaşılamadı, rota üstü doğru çizgiyle hesaplandı (daha kaba)
        routeSource: back.source,
      },
      returnLoads: ret.flatMap((x) => (cards.has(x.id) ? [{ ...cards.get(x.id)!, match: x.match }] : [])),
      onRouteLoads: onRoute.flatMap((x) => (cards.has(x.id) ? [{ ...cards.get(x.id)!, route: x.route }] : [])),
      // UC-12 "Bu rotada yük çıkınca haber ver": varış noktasından eve, işteki araç tipiyle (varsayılan 50/80 km)
      alert: { originDistrictId: row.dest.districtId, destDistrictId: row.origin.districtId, vehicleType: row.vehicle.vehicleType, exists: !!alert },
    };
  }

  private loadForMatch(l: typeof loadPosts.$inferSelect): LoadForMatch {
    return {
      origin: latLng(l.originGeom),
      dest: latLng(l.destGeom),
      loadFrom: l.loadFrom,
      loadTo: l.loadTo,
      weightTon: l.weightTon,
      vehicleType: l.vehicleType as VehicleType,
      bodyType: l.bodyType as BodyType | null,
    };
  }
}
