// Simülasyonun TÜM varsayımları bu dosyadadır. Sistemin kuralları (BR-20/21 eşleştirme, BR-02…05 teyit, araç büyüklüğü,
// güven skoru, tarih sınırları) buraya kopyalanmaz: @nakliye/shared'dan içe aktarılır.
// [T] = tahmin: saha verisiyle doğrulanmamış varsayım. README'deki varsayım tablosu bu dosyayla birebir aynıdır.
import type { BodyType, CargoType, VehicleType } from "@nakliye/shared";

// ── Ortak ───────────────────────────────────────────────────────────

/** Deneylerin "bugün"ü (Pazartesi). Yalnız tarih hesaplarının sabit bir başlangıcı; mevsimsellik modellenmez. */
export const REFERANS_GUN = "2026-11-02";

/** Her yapılandırmada bağımsız tekrar (tohum) sayısı */
export const TOHUM_SAYISI = 30;

/** Kök tohum: tüm sonuçlar bundan türetilir (değiştirilirse bütün sayılar değişir, istatistiksel sonuç değişmemeli) */
export const KOK_TOHUM = 20261012;

// ── Coğrafya [T] ────────────────────────────────────────────────────
// İl ağırlıkları: kalkış ve varış ili bu ağırlıklarla seçilir, ilçe il içinde düzgün seçilir [T].

/** Başlangıç koridoru (pilot bölgesi) */
export const KORIDOR_ILLERI = ["Aydın", "İzmir", "Manisa", "İstanbul"] as const;
/** Büyük yük merkezleri */
export const MERKEZ_ILLERI = ["Ankara", "Bursa", "Kocaeli", "Konya", "Mersin"] as const;

export const IL_AGIRLIGI = {
  koridor: 20, // [T] 4 il × 20 = 80 / 146 ≈ %55
  merkez: 6, // [T] 5 il × 6 = 30 / 146 ≈ %21
  diger: 0.5, // [T] 72 il × 0,5 = 36 / 146 ≈ %25
};

/**
 * Araç tipine göre "il içi yük" oranı [T]: küçük araç isteyen yük çoğunlukla şehir içi/kısa mesafedir.
 * İl içi seçilirse varış, kalkışla aynı ildeki başka bir ilçedir (ilde tek ilçe varsa il dışı seçilir).
 */
export const IL_ICI_YUK_ORANI: Record<VehicleType, number> = {
  panelvan: 0.6,
  kamyonet: 0.5,
  kamyon: 0.25,
  kirkayak: 0.1,
  tir: 0.05,
};

// ── Araç ve yük [T] ─────────────────────────────────────────────────

/** Araç tipi karışımı (hem boş araç ilanlarında hem yükte istenen tipte) [T] */
export const ARAC_TIPI_KARISIMI: readonly (readonly [VehicleType, number])[] = [
  ["tir", 40],
  ["kirkayak", 10],
  ["kamyon", 25],
  ["kamyonet", 15],
  ["panelvan", 10],
];

/** Araç tipine göre kapasite aralığı (ton), düzgün dağılım [T]. Şema sınırı: 0 < kapasite ≤ 60. */
export const KAPASITE_ARALIGI: Record<VehicleType, readonly [number, number]> = {
  tir: [24, 27],
  kirkayak: [18, 22],
  kamyon: [10, 15],
  kamyonet: [3, 7.5],
  panelvan: [1, 1.5],
};

/** Yük ağırlığı = U(alt, üst) × istenen tipin kapasite üst sınırı [T] (0,1 t'ye yuvarlanır, en az 0,1 t) */
export const YUK_DOLULUK_ARALIGI: readonly [number, number] = [0.2, 1.0];

/** Araç tipine göre kasa dağılımı [T] */
export const KASA_DAGILIMI: Record<VehicleType, readonly (readonly [BodyType, number])[]> = {
  tir: [
    ["tenteli", 45],
    ["kayar_perde", 15],
    ["frigo", 12],
    ["acik", 10],
    ["damper", 8],
    ["lowbed", 5],
    ["kapali", 5],
  ],
  kirkayak: [
    ["tenteli", 35],
    ["acik", 25],
    ["damper", 25],
    ["kapali", 10],
    ["frigo", 5],
  ],
  kamyon: [
    ["acik", 30],
    ["tenteli", 20],
    ["kapali", 20],
    ["damper", 15],
    ["frigo", 10],
    ["lowbed", 5],
  ],
  kamyonet: [
    ["kapali", 45],
    ["acik", 40],
    ["frigo", 15],
  ],
  panelvan: [["kapali", 100]],
};

/** Yük cinsi karışımı [T] */
export const YUK_CINSI_KARISIMI: readonly (readonly [CargoType, number])[] = [
  ["genel", 25],
  ["palet", 20],
  ["dokme", 8],
  ["insaat", 10],
  ["gida", 12],
  ["soguk_zincir", 6],
  ["makine", 6],
  ["tarim", 10],
  ["tehlikeli", 3],
];

/**
 * Yük cinsine göre istenen kasa [T]; null = "fark etmez". İstenen kasa, istenen araç tipinin kasa dağılımında
 * yoksa (ör. panelvan + damper) yük cinsi yeniden çekilir (en çok 50 deneme; olmazsa kasa "fark etmez").
 */
export const KASA_ISTEGI: Record<CargoType, readonly (readonly [BodyType | null, number])[]> = {
  genel: [
    [null, 60],
    ["tenteli", 25],
    ["kapali", 15],
  ],
  palet: [
    [null, 40],
    ["tenteli", 35],
    ["kayar_perde", 15],
    ["kapali", 10],
  ],
  dokme: [
    ["damper", 80],
    [null, 20],
  ],
  insaat: [
    ["acik", 50],
    ["damper", 20],
    [null, 30],
  ],
  gida: [
    [null, 30],
    ["kapali", 35],
    ["tenteli", 20],
    ["frigo", 15],
  ],
  soguk_zincir: [["frigo", 100]],
  makine: [
    ["lowbed", 40],
    ["acik", 40],
    [null, 20],
  ],
  tarim: [
    [null, 40],
    ["acik", 30],
    ["tenteli", 20],
    ["frigo", 10],
  ],
  tehlikeli: [
    ["tenteli", 50],
    ["kapali", 30],
    [null, 20],
  ],
};

// ── Tarihler (Deney 1 anlık görüntüsü) [T] ──────────────────────────
// Şema sınırları (shared LOAD_DATE_LIMITS): en çok 60 gün sonrası, aralık en çok 30 gün. Aşağıdakiler bunun çok içinde.

/** Yükleme başlangıcı: referans günden kaç gün sonra [T] */
export const YUKLEME_OFSET_GUN: readonly (readonly [number, number])[] = [
  [0, 20],
  [1, 30],
  [2, 20],
  [3, 15],
  [4, 5],
  [5, 4],
  [6, 3],
  [7, 3],
];
/** Yükleme aralığının uzunluğu (bitiş − başlangıç, gün) [T] */
export const YUKLEME_ARALIK_GUN: readonly (readonly [number, number])[] = [
  [0, 50],
  [1, 25],
  [2, 15],
  [3, 10],
];
/** Boş araç müsaitlik başlangıcı: referans günden kaç gün sonra [T] */
export const MUSAITLIK_OFSET_GUN: readonly (readonly [number, number])[] = [
  [0, 35],
  [1, 30],
  [2, 15],
  [3, 10],
  [4, 5],
  [5, 5],
];
/** Müsaitlik aralığının uzunluğu (gün) [T] */
export const MUSAITLIK_ARALIK_GUN: readonly (readonly [number, number])[] = [
  [0, 40],
  [1, 30],
  [2, 20],
  [3, 10],
];

/** Boş araç ilanlarında hedef "her yer" oranı [T] */
export const HER_YER_ORANI = 0.35;

// ── Güven skoru girdileri [T] (skorun kendisi shared trustScore ile hesaplanır) ──

export const GUVEN_GIRDILERI = {
  /** Hiç işi olmayan yeni üye oranı (skor 0,25 olur) [T] */
  yeniUyeOrani: 0.2,
  /** Tamamlanan iş sayısı: log-normal medyan ve σ [T] */
  isMedyan: 15,
  isSigma: 1.0,
  /** Puanlanan iş oranı [T] */
  puanlanmaOrani: 0.6,
  /** Ortalama yıldız, düzgün [T] */
  yildizAraligi: [3.5, 5.0] as const,
  /** Doğrulama seviyesi dağılımı (0/1/2) [T] */
  dogrulama: [
    [0, 10],
    [1, 50],
    [2, 40],
  ] as const,
  /** İptal oranı ve haklı şikayet oranı üst sınırları, düzgün [T] */
  iptalOraniUst: 0.1,
  sikayetOraniUst: 0.02,
};

// ── Deney 1 ─────────────────────────────────────────────────────────

export const DENEY1 = {
  yukSayilari: [25, 50, 100, 200, 400, 800],
  aracYukOranlari: [0.5, 1, 2],
};

// ── Deney 2: dönüş planı (F4) ───────────────────────────────────────
// Kurallar (tahmini varış, dönüş penceresi, BR-20 dönüş yükü, BR-23 rota üstü) shared'dan; burada yalnız örnek ve
// davranış varsayımları.

export const DENEY2 = {
  /** Gidiş işi sayısı (her iş bir araç; ev = işin kalkış ilçesi, API'deki dönüş planıyla aynı) */
  isSayilari: [50, 100, 200, 400],
  /** İş başına pazardaki yük ilanı (dönüşte alınabilecek) [T] */
  pazarOranlari: [1, 2, 4],
  /** Gidiş işi il dışıdır [T]: il içi kısa işte dönüş planı anlamsız (boş dönüş zaten kısa) */
  gidisIlDisi: true,
  /** Duyarlılık analizinin yapılandırması (iş sayısı, pazar oranı) */
  duyarlilik: { is: 200, pazar: 2 },
  /** Duyarlılık: dönüş penceresi, gün (sistem: RETURN_PLAN_PARAMS.windowDays = 2) */
  pencereGunleri: [1, 2, 4],
  /** Duyarlılık: rota üstü sapma sınırı, km (sistem: BR-23 30) */
  sapmaKmleri: [15, 30, 50],
  /** Duyarlılık: dönüş yükü yarıçapları [kalkış, varış] km (sistem: BR-20 50 / 80) */
  yaricaplar: [
    [25, 40],
    [50, 80],
    [100, 160],
  ] as readonly (readonly [number, number])[],
};

// ── Deney 3: teyit davranışı [T] ────────────────────────────────────

export const DENEY3 = {
  /** Simülasyon penceresi: ilanlar bu kadar gün boyunca gelir; her ilan yayından kalkana kadar izlenir */
  gunSayisi: 14,
  /** Günlük yeni yük ilanı [T] */
  gunlukIlan: 100,
  /** İlanın verildiği saat (TR, 0–23) ağırlıkları [T]: mesai saatleri yoğun */
  ilanSaatiAgirligi: [
    0.2, 0.1, 0.1, 0.1, 0.1, 0.2, 0.5, 1.0, 2.5, 3.5, 3.5, 3.5, 3.0, 3.0, 3.5, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0, 0.8, 0.5, 0.3,
  ],
  /** Yükleme başlangıcı: ilan gününden kaç gün sonra [T] */
  yuklemeOfsetGun: YUKLEME_OFSET_GUN,
  /** Yükleme aralığı uzunluğu [T] */
  yuklemeAralikGun: YUKLEME_ARALIK_GUN,
  /** Yükün "gittiği" (araç bulduğu ya da vazgeçildiği) an: ilan anından log-normal gecikme (saat) [T] */
  gitmeMedyanSaat: 18,
  gitmeSigma: 1.0,
  /** Yük gidince sahibin sorulmadan ilanı kapatma olasılığı q [T] ve gecikmesi (log-normal, saat) [T] */
  kendiligindenKapamaQ: 0.5,
  kapamaMedyanSaat: 2,
  kapamaSigma: 1.0,
  /** Teyit sorusuna (push + SMS yedeği) cevap verme olasılığı p, her soru için bağımsız [T] */
  cevapP: 0.7,
  /** Cevap gecikmesi: log-normal (dakika) [T] */
  cevapMedyanDk: 30,
  cevapSigma: 1.2,
  /** Uyku saatleri (TR): bu aralığa düşen cevap/kapama, uyanınca + U(0, uyanmaGecikmesiDk) yapılır [T] */
  uykuBaslangicSaat: 23,
  uykuBitisSaat: 7,
  uyanmaGecikmesiDk: 90,
  /** BR-05 varyantı: listede görünür bayat ilana saatte gelen "yük yok" şikayeti (her biri farklı, sayılan kullanıcı) [T] */
  bayatSikayetOraniSaatte: 0.03,
  /** Geçerli ilana saatte gelen yersiz "yük yok" şikayeti [T] */
  yersizSikayetOraniSaatte: 0.002,
  /** BR-05 "yoğun trafik" varyantı: iki şikayet oranı da bu katsayıyla çarpılır [T] */
  br05YogunCarpan: 10,
  /** Duyarlılık ızgarası */
  pDegerleri: [0.5, 0.7, 0.9],
  soruAraligiDegerleri: [12, 24, 48],
  bekliyorSuresiDegerleri: [6, 12, 24],
  /** Senaryo A için q duyarlılığı */
  qDegerleri: [0.3, 0.5, 0.7],
  /** docs/03 §8 "ilan tazeliği" penceresi (saat): soru aralığından bağımsız sabit tanım */
  tazelikPenceresiSaat: 24,
};
