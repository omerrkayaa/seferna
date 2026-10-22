// F4 dönüş planı — docs/03 FR-24, BR-23; docs/04 §4 "Rota üstü"
// API ve simülasyon (Deney 2) aynı kuralı kullanır; veritabanı yalnız aday ön süzgeci yapar.
import type { BodyType, VehicleType } from "../constants.js";
import { haversineKm, type LatLng } from "../geo.js";
import type { CapacityForMatch, IsoDay } from "./matching.js";

export const RETURN_PLAN_PARAMS = {
  /** Tahmini yol günü: günde bu kadar km (varış = yükleme günü + ⌈km / kmPerDay⌉) */
  kmPerDay: 600,
  /** Dönüş penceresi: tahmini varış günü … +windowDays */
  windowDays: 2,
  /** BR-23: yükün kalkışı ve varışı dönüş rotasından en çok bu kadar sapabilir */
  routeMaxDeviationKm: 30,
};
export type ReturnPlanParams = typeof RETURN_PLAN_PARAMS;

const DAY_MS = 86_400_000;
const dayIndex = (d: IsoDay) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
const fromIndex = (i: number): IsoDay => new Date(i * DAY_MS).toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Tahmini varış günü. Teslim edildiyse teslim günü (araç orada). Değilse yükleme günü + ⌈yol km / kmPerDay⌉; bu gün
 * geçtiyse (gecikme) bugün.
 */
export function estimatedArrivalDay(
  job: { loadFrom: IsoDay; roadKm: number; deliveredDay: IsoDay | null },
  today: IsoDay,
  p: ReturnPlanParams = RETURN_PLAN_PARAMS,
): IsoDay {
  if (job.deliveredDay) return job.deliveredDay;
  const arrival = dayIndex(job.loadFrom) + Math.ceil(Math.max(0, job.roadKm) / p.kmPerDay);
  return fromIndex(Math.max(arrival, dayIndex(today)));
}

export function returnWindow(arrival: IsoDay, p: ReturnPlanParams = RETURN_PLAN_PARAMS): { from: IsoDay; to: IsoDay } {
  return { from: arrival, to: fromIndex(dayIndex(arrival) + p.windowDays) };
}

/**
 * Dönüş için "sanal boş araç ilanı": işin varışından kalkışına, dönüş penceresinde, işteki araçla. BR-20 eşleştirme
 * kuralı (matchLoadWithCapacity) bununla dönüş yüklerini bulur: kalkış varış noktasına ≤ 50 km, varış eve ≤ 80 km.
 */
export function returnCapacity(
  job: { origin: LatLng; dest: LatLng; vehicle: { type: VehicleType; bodyType: BodyType; capacityTon: number } },
  window: { from: IsoDay; to: IsoDay },
): CapacityForMatch {
  return { origin: job.dest, dest: job.origin, availableFrom: window.from, availableTo: window.to, vehicle: job.vehicle };
}

/**
 * Noktanın çoklu çizgiye (rota) en kısa uzaklığı (km) ve en yakın noktanın çizgi üstündeki konumu (0 = baş, 1 = son;
 * uzunluğa göre). Her parça için noktanın enleminde düzlem yaklaşımı: 30 km ölçeğinde hata metreler düzeyinde.
 */
export function projectOnPolyline(point: LatLng, line: readonly LatLng[]): { distanceKm: number; position: number } {
  if (line.length === 0) throw new Error("Boş rota");
  if (line.length === 1) return { distanceKm: haversineKm(point, line[0]!), position: 0 };
  const kx = 111.32 * Math.cos((point.lat * Math.PI) / 180);
  const ky = 110.574;
  const xy = (q: LatLng) => [(q.lng - point.lng) * kx, (q.lat - point.lat) * ky] as const;
  const segKm: number[] = [];
  for (let i = 0; i + 1 < line.length; i++) segKm.push(haversineKm(line[i]!, line[i + 1]!));
  const total = segKm.reduce((a, b) => a + b, 0);
  let best = { distanceKm: Infinity, along: 0 };
  let before = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = xy(line[i]!);
    const [bx, by] = xy(line[i + 1]!);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Nokta düzlemde (0, 0): parça üstündeki en yakın noktanın parametresi
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.distanceKm) best = { distanceKm: d, along: before + t * segKm[i]! };
    before += segKm[i]!;
  }
  return { distanceKm: best.distanceKm, position: total === 0 ? 0 : best.along / total };
}

export type OnRouteResult =
  | { candidate: false; reason: "kalkis_rotadan_uzak" | "varis_rotadan_uzak" | "ters_yon" }
  | { candidate: true; originDevKm: number; destDevKm: number; fromPosition: number; toPosition: number; coverage: number; score: number };

/**
 * BR-23 rota üstü: yükün kalkışı ve varışı rotadan ≤ routeMaxDeviationKm ve sıra doğru (kalkış rotada varıştan önce).
 * `coverage`: yükün rotanın ne kadarını doldurduğu (0–1). Skor: kapsama (0,6) + sapma azlığı (0,4) — boş dönüş yolunun
 * çoğunu dolduran, az sapan yük önce.
 */
export function onRouteMatch(
  load: { origin: LatLng; dest: LatLng },
  route: readonly LatLng[],
  p: ReturnPlanParams = RETURN_PLAN_PARAMS,
): OnRouteResult {
  const o = projectOnPolyline(load.origin, route);
  if (o.distanceKm > p.routeMaxDeviationKm) return { candidate: false, reason: "kalkis_rotadan_uzak" };
  const d = projectOnPolyline(load.dest, route);
  if (d.distanceKm > p.routeMaxDeviationKm) return { candidate: false, reason: "varis_rotadan_uzak" };
  if (d.position <= o.position) return { candidate: false, reason: "ters_yon" };
  const coverage = d.position - o.position;
  const deviation = Math.max(o.distanceKm, d.distanceKm) / p.routeMaxDeviationKm;
  return {
    candidate: true,
    originDevKm: round1(o.distanceKm),
    destDevKm: round1(d.distanceKm),
    fromPosition: round3(o.position),
    toPosition: round3(d.position),
    coverage: round3(coverage),
    score: round3(0.6 * coverage + 0.4 * (1 - deviation)),
  };
}
