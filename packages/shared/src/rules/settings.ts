// FR-54 parametre yönetimi: yöneticinin değiştirebildiği kural parametreleri (teyit aralıkları BR-01…05, eşleştirme
// BR-20…21, koridor fiyat formülü F7). Değerler tam nesne olarak saklanır ve doğrulanır; geçersizse varsayılan kullanılır.
import { z } from "zod";
import { VEHICLE_TYPES, type VehicleType } from "../constants.js";
import { DEFAULT_CONFIRMATION_PARAMS, type ConfirmationParams } from "./confirmation.js";
import { DEFAULT_MATCH_PARAMS, type MatchParams } from "./matching.js";
import { DEFAULT_PRICE_PARAMS, type PriceParams } from "./price.js";

const num = (min: number, max: number, label: string) =>
  z.coerce.number({ message: `${label} sayı olmalı` }).min(min, `${label} en az ${min}`).max(max, `${label} en çok ${max}`);
const int = (min: number, max: number, label: string) => num(min, max, label).int(`${label} tam sayı olmalı`);

export const confirmationParamsSchema = z
  .object({
    reminderIntervalH: int(6, 168, "Teyit aralığı"),
    loadDayIntervalH: int(1, 24, "Yükleme günü aralığı"),
    answerWindowH: int(1, 48, "Cevap süresi"),
    pendingGraceH: int(1, 72, "Teyit bekliyor süresi"),
    smsFallbackMin: int(5, 240, "SMS yedeği süresi"),
    reportThreshold: int(1, 10, "Şikayet eşiği"),
  })
  .refine((p) => p.loadDayIntervalH <= p.reminderIntervalH, { path: ["loadDayIntervalH"], message: "Yükleme günü aralığı normal aralıktan uzun olamaz" })
  // SMS yedeği cevap süresi dolmadan gitmeli; yoksa kişi SMS'i aldığında ilan çoktan "teyit bekliyor"a düşmüş olur
  .refine((p) => p.smsFallbackMin < p.answerWindowH * 60, { path: ["smsFallbackMin"], message: "SMS yedeği cevap süresinden önce gitmeli" });

export const matchParamsSchema = z
  .object({
    originRadiusKm: int(5, 300, "Kalkış yarıçapı"),
    destRadiusKm: int(5, 500, "Varış yarıçapı"),
    dateToleranceDays: int(0, 7, "Tarih toleransı"),
    weights: z.object({
      originProximity: num(0, 1, "Kalkış yakınlığı ağırlığı"),
      destProximity: num(0, 1, "Varış yakınlığı ağırlığı"),
      dateFit: num(0, 1, "Tarih uyumu ağırlığı"),
      capacityFill: num(0, 1, "Kapasite doluluğu ağırlığı"),
      trust: num(0, 1, "Güven ağırlığı"),
    }),
  })
  // Skor 0–1 aralığında kalsın (eşleşme sıralaması ve simülasyon ölçütleri bu ölçeği varsayar)
  .refine((p) => Math.abs(Object.values(p.weights).reduce((a, b) => a + b, 0) - 1) <= 0.001, { path: ["weights"], message: "Ağırlıkların toplamı 1 olmalı" });

const vehicleCost = (label: string) =>
  z.object({
    fuelLitersPer100Km: num(1, 80, `${label} yakıt tüketimi`),
    wearPerKm: num(0, 100, `${label} aşınma maliyeti`),
    // Alt sınır, binlik ayırıcı ondalık sanılırsa (3.000 → 3) yanlış değerin kaydedilmesini de durdurur
    driverDaily: num(100, 100_000, `${label} şoför günlüğü`),
  });

export const priceParamsSchema = z
  .object({
    fuelPricePerLiter: num(1, 1000, "Yakıt fiyatı"),
    kmPerDay: int(100, 1500, "Günlük km"),
    marginMin: num(1, 3, "En düşük kâr çarpanı"),
    marginMax: num(1, 3, "En yüksek kâr çarpanı"),
    roundTo: z.coerce.number().refine((v) => [50, 100, 250, 500, 1000].includes(v), "Yuvarlama 50, 100, 250, 500 ya da 1000 olmalı"),
    vehicles: z.object(Object.fromEntries((Object.keys(VEHICLE_TYPES) as VehicleType[]).map((t) => [t, vehicleCost(VEHICLE_TYPES[t])])) as Record<VehicleType, ReturnType<typeof vehicleCost>>),
  })
  .refine((p) => p.marginMin <= p.marginMax, { path: ["marginMax"], message: "En yüksek kâr çarpanı en düşükten küçük olamaz" });

// Şema çıktıları kural parametreleriyle aynı biçimde olmalı (derleme zamanı denetimi)
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _shapes: [Same<z.output<typeof confirmationParamsSchema>, ConfirmationParams>, Same<z.output<typeof matchParamsSchema>, MatchParams>, Same<z.output<typeof priceParamsSchema>, PriceParams>] = [true, true, true];
void _shapes;

export const SETTINGS = {
  confirmation: { label: "İlan teyidi", schema: confirmationParamsSchema, defaults: DEFAULT_CONFIRMATION_PARAMS },
  matching: { label: "Eşleştirme", schema: matchParamsSchema, defaults: DEFAULT_MATCH_PARAMS },
  price: { label: "Fiyat aralığı", schema: priceParamsSchema, defaults: DEFAULT_PRICE_PARAMS },
} as const;
export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = { confirmation: ConfirmationParams; matching: MatchParams; price: PriceParams }[K];
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

const FIELD_LABELS: Record<string, string> = {
  reminderIntervalH: "Teyit aralığı (saat)",
  loadDayIntervalH: "Yükleme günü aralığı (saat)",
  answerWindowH: "Cevap süresi (saat)",
  pendingGraceH: "“Teyit bekliyor” süresi (saat)",
  smsFallbackMin: "SMS yedeği (dakika)",
  reportThreshold: "Anında teyit için şikayet (kişi)",
  originRadiusKm: "Kalkış yarıçapı (km)",
  destRadiusKm: "Varış yarıçapı (km)",
  dateToleranceDays: "Tarih toleransı (gün)",
  "weights.originProximity": "Ağırlık: kalkış yakınlığı",
  "weights.destProximity": "Ağırlık: varış yakınlığı",
  "weights.dateFit": "Ağırlık: tarih uyumu",
  "weights.capacityFill": "Ağırlık: kapasite doluluğu",
  "weights.trust": "Ağırlık: güven skoru",
  fuelPricePerLiter: "Motorin fiyatı (₺/L)",
  kmPerDay: "Günlük yol (km)",
  marginMin: "Kâr çarpanı (alt)",
  marginMax: "Kâr çarpanı (üst)",
  roundTo: "Yuvarlama (₺)",
};
const VEHICLE_FIELD_LABELS: Record<string, string> = { fuelLitersPer100Km: "yakıt (L/100 km)", wearPerKm: "aşınma, bakım (₺/km)", driverDaily: "şoför (₺/gün)" };

/** Ayar alanının okunur adı ("vehicles.tir.driverDaily" → "Tır şoför (₺/gün)") */
export function settingLabel(path: string): string {
  const v = /^vehicles\.(\w+)\.(\w+)$/.exec(path);
  if (v && v[1]! in VEHICLE_TYPES && v[2]! in VEHICLE_FIELD_LABELS) return `${VEHICLE_TYPES[v[1] as VehicleType]} ${VEHICLE_FIELD_LABELS[v[2]!]}`;
  return FIELD_LABELS[path] ?? path;
}

const shown = (v: unknown) => (typeof v === "number" ? v.toLocaleString("tr-TR", { maximumFractionDigits: 4 }) : String(v));

/** İki ayar nesnesinin farkı, "okunur ad: eski → yeni" satırları (işlem kaydına yazılır) */
export function settingsDiff(before: unknown, after: unknown, prefix = ""): string[] {
  if (typeof before === "object" && before !== null && typeof after === "object" && after !== null) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((k) => settingsDiff((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
  }
  return before === after ? [] : [`${settingLabel(prefix)}: ${shown(before)} → ${shown(after)}`];
}
