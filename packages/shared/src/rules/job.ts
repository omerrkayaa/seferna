// İş (taşıma) kuralları — docs/03 FR-30…34, BR-31, BR-32, §6 iş durum diyagramı
import { vehicleCanCarry, type BodyType, type JobStatus, type VehicleType } from "../constants.js";

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  anlasildi: "Anlaşıldı",
  yuklendi: "Yüklendi",
  yolda: "Yolda",
  teslim_edildi: "Teslim edildi",
  tamamlandi: "Tamamlandı",
  itirazli: "İtirazlı",
  iptal: "İptal",
};

export const JOB_PARAMS = {
  /** BR-32: teslimden sonra itiraz yoksa otomatik tamamlanma (saat) */
  autoCompleteH: 48,
  /** Teslim kodu (6 hane) için yanlış deneme hakkı; dolunca yük sahibi yeni kod üretir */
  deliveryCodeMaxAttempts: 5,
};

/** Aktif (sürmekte olan) işler: araç bu işteyken silinemez. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["anlasildi", "yuklendi", "yolda", "teslim_edildi"];

/** Sonuçlanmamış işler (aktif + itirazlı): bunlardan biri varken hesap silinemez (FR-07; karşı tarafın işi yarım kalmasın). */
export const OPEN_JOB_STATUSES: readonly JobStatus[] = [...ACTIVE_JOB_STATUSES, "itirazli"];

/**
 * Aracı meşgul tutan işler (teslimden önce). Böyle bir işin yükleme tarihleriyle çakışan tarihlere araç başka teklif
 * veremez, kabul edilemez, boş araç ilanı açamaz. Teslimden sonra araç boştur (dönüş yükü bu yüzden alınabilir).
 */
export const VEHICLE_BUSY_JOB_STATUSES: readonly JobStatus[] = ["anlasildi", "yuklendi", "yolda"];

/**
 * İzin verilen geçişler ve kimin yapabileceği.
 * - Nakliyeci ileri taşır: anlaşıldı → yüklendi → yolda; teslim yalnız kodla (ara adımlar atlanabilir: şoför güncellemeyebilir).
 * - Yük sahibi elle tamamlayabilir (BR-31: kod girilemediyse) ve teslimden sonra 48 saat içinde itiraz edebilir.
 * - İptal: teslimden önce iki taraf da (sebep zorunlu, iptal oranına yazılır).
 * - Sistem: teslimden 48 saat sonra otomatik tamamlar (BR-32).
 * - Yönetici itirazı çözer: teslim geçerliyse tamamlandı, değilse iptal (iptal nakliyecinin hanesine yazılır).
 */
type Actor = "carrier" | "shipper" | "system" | "admin";
const T: Record<JobStatus, Partial<Record<JobStatus, readonly Actor[]>>> = {
  anlasildi: { yuklendi: ["carrier"], yolda: ["carrier"], teslim_edildi: ["carrier"], tamamlandi: ["shipper"], iptal: ["carrier", "shipper"] },
  yuklendi: { yolda: ["carrier"], teslim_edildi: ["carrier"], tamamlandi: ["shipper"], iptal: ["carrier", "shipper"] },
  yolda: { teslim_edildi: ["carrier"], tamamlandi: ["shipper"], iptal: ["carrier", "shipper"] },
  teslim_edildi: { tamamlandi: ["shipper", "system"], itirazli: ["shipper"] },
  tamamlandi: {},
  itirazli: { tamamlandi: ["admin"], iptal: ["admin"] },
  iptal: {},
};

export const canJobTransition = (from: JobStatus, to: JobStatus, by: Actor) => T[from][to]?.includes(by) ?? false;

/** Teklif edilen araç yükü taşıyabilir mi (BR-20'nin araç şartları)? Sorun yoksa null, varsa mesaj. */
export function vehicleFitError(
  load: { vehicleType: VehicleType; bodyType: BodyType | null; weightTon: number },
  vehicle: { vehicleType: VehicleType; bodyType: BodyType; capacityTon: number },
): string | null {
  if (!vehicleCanCarry(vehicle.vehicleType, load.vehicleType)) return "Araç tipi ilanda istenenden küçük";
  if (load.bodyType && vehicle.bodyType !== load.bodyType) return "Kasa tipi ilanda istenen kasayla uyuşmuyor";
  if (vehicle.capacityTon < load.weightTon) return "Aracın kapasitesi yük ağırlığından düşük";
  return null;
}

/** Teslim kodu SMS'i (ASCII, tek parça; bkz. sms.ts maliyet notu). */
export const deliveryCodeSmsText = (code: string) =>
  `Seferna teslim kodunuz: ${code}. Yuk teslim alininca bu kodu soforle paylasin; once paylasmayin.`;
