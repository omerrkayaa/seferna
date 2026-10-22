// Kural tabanlı eşleştirme — docs/03 BR-20, BR-21; docs/04 §4
// Veritabanında aday bulma PostGIS ile yapılır; bu modül aynı kuralın referans uygulamasıdır
// (skor hesabı, testler ve simülasyon bunu kullanır).
import { vehicleCanCarry, type BodyType, type VehicleType } from "../constants.js";
import { haversineKm, type LatLng } from "../geo.js";

export interface MatchParams {
  originRadiusKm: number;
  destRadiusKm: number;
  dateToleranceDays: number;
  weights: {
    originProximity: number;
    destProximity: number;
    dateFit: number;
    capacityFill: number;
    trust: number;
  };
}

export const DEFAULT_MATCH_PARAMS: MatchParams = {
  originRadiusKm: 50,
  destRadiusKm: 80,
  dateToleranceDays: 1,
  weights: { originProximity: 0.35, destProximity: 0.2, dateFit: 0.15, capacityFill: 0.1, trust: 0.2 },
};

/** "YYYY-MM-DD" biçiminde gün */
export type IsoDay = string;

export interface LoadForMatch {
  origin: LatLng;
  dest: LatLng;
  loadFrom: IsoDay;
  loadTo: IsoDay;
  weightTon: number;
  vehicleType: VehicleType;
  bodyType: BodyType | null;
}

export interface CapacityForMatch {
  origin: LatLng;
  /** null = "her yere giderim" */
  dest: LatLng | null;
  availableFrom: IsoDay;
  availableTo: IsoDay;
  vehicle: { type: VehicleType; bodyType: BodyType; capacityTon: number };
}

export type RejectReason = "arac_tipi" | "kasa_tipi" | "kapasite" | "tarih" | "kalkis_uzak" | "varis_uzak";

export type MatchResult =
  | { candidate: false; reason: RejectReason }
  | { candidate: true; score: number; originKm: number; destKm: number | null };

const dayIndex = (d: IsoDay) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

function rangesOverlap(aFrom: number, aTo: number, bFrom: number, bTo: number) {
  return aFrom <= bTo && bFrom <= aTo;
}

/**
 * Konumdan bağımsız uyum: araç tipi, kasa, kapasite ve tarih (± tolerans). Uymuyorsa sebep, uyuyorsa null.
 * Eşleştirme (BR-20) ve rota üstü dönüş yükü (BR-23) ortak kullanır.
 */
export function fitRejectReason(
  load: Pick<LoadForMatch, "loadFrom" | "loadTo" | "weightTon" | "vehicleType" | "bodyType">,
  cap: Pick<CapacityForMatch, "availableFrom" | "availableTo" | "vehicle">,
  p: Pick<MatchParams, "dateToleranceDays"> = DEFAULT_MATCH_PARAMS,
): RejectReason | null {
  // Büyük araç küçük tip isteyen yükü taşıyabilir (kapasite ayrıca aranır; doluluk puanı doğru boyutu öne alır)
  if (!vehicleCanCarry(cap.vehicle.type, load.vehicleType)) return "arac_tipi";
  if (load.bodyType && cap.vehicle.bodyType !== load.bodyType) return "kasa_tipi";
  if (cap.vehicle.capacityTon < load.weightTon) return "kapasite";
  const tol = p.dateToleranceDays;
  if (!rangesOverlap(dayIndex(load.loadFrom), dayIndex(load.loadTo), dayIndex(cap.availableFrom) - tol, dayIndex(cap.availableTo) + tol)) return "tarih";
  return null;
}

/**
 * Bir yük ile bir boş araç ilanını karşılaştırır.
 * @param trust araç sahibinin (yük tarafından bakılırken) ya da yük sahibinin güven skoru, 0–1
 */
export function matchLoadWithCapacity(
  load: LoadForMatch,
  cap: CapacityForMatch,
  trust: number,
  p: MatchParams = DEFAULT_MATCH_PARAMS,
): MatchResult {
  const reject = fitRejectReason(load, cap, p);
  if (reject) return { candidate: false, reason: reject };

  const lf = dayIndex(load.loadFrom);
  const lt = dayIndex(load.loadTo);
  const cf = dayIndex(cap.availableFrom);
  const ct = dayIndex(cap.availableTo);

  const originKm = haversineKm(load.origin, cap.origin);
  if (originKm > p.originRadiusKm) return { candidate: false, reason: "kalkis_uzak" };

  const destKm = cap.dest ? haversineKm(load.dest, cap.dest) : null;
  if (destKm !== null && destKm > p.destRadiusKm) return { candidate: false, reason: "varis_uzak" };

  const w = p.weights;
  const originProximity = 1 - originKm / p.originRadiusKm;
  // "Her yer" diyen araç için varış yakınlığı nötr kabul edilir.
  const destProximity = destKm === null ? 0.5 : 1 - destKm / p.destRadiusKm;
  const dateFit = rangesOverlap(lf, lt, cf, ct) ? 1 : 0.5;
  const capacityFill = load.weightTon / cap.vehicle.capacityTon;
  const t = Math.min(1, Math.max(0, trust));

  const score =
    w.originProximity * originProximity +
    w.destProximity * destProximity +
    w.dateFit * dateFit +
    w.capacityFill * capacityFill +
    w.trust * t;

  return { candidate: true, score: round3(score), originKm: round1(originKm), destKm: destKm === null ? null : round1(destKm) };
}

/** BR-22: kullanıcı başına saatlik bildirim sınırı (rota alarmı bildirimleri de bu sınıra girer) */
export const MAX_MATCH_NOTIFICATIONS_PER_HOUR = 5;

/** Rota alarmı (FR-22, UC-06): ilçe + yarıçap. Varsayılan yarıçaplar eşleştirmeninkiyle aynı (BR-20). */
export const ROUTE_ALERT_PARAMS = {
  /** Kullanıcı başına aktif alarm sınırı (bildirim yorgunluğu, BR-22) */
  maxActive: 10,
  minRadiusKm: 10,
  maxRadiusKm: 200,
  defaultOriginRadiusKm: DEFAULT_MATCH_PARAMS.originRadiusKm,
  defaultDestRadiusKm: DEFAULT_MATCH_PARAMS.destRadiusKm,
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
