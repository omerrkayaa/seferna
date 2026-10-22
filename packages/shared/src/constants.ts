// Sektör sözlüğü: arayüzde ve API'de aynı değerler kullanılır.

export const ROLES = ["carrier", "shipper", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const VEHICLE_TYPES = {
  tir: "Tır",
  kirkayak: "Kırkayak",
  kamyon: "Kamyon",
  kamyonet: "Kamyonet",
  panelvan: "Panelvan",
} as const;
export type VehicleType = keyof typeof VEHICLE_TYPES;

/**
 * Araç büyüklük sırası, küçükten büyüğe (karar 2026-10-09): büyük araç, ilanda istenen daha küçük tipteki yükü
 * taşıyabilir (kapasite ve kasa şartı ayrıca aranır); küçük araç büyük tip isteyen ilana uymaz.
 */
export const VEHICLE_SIZE_ORDER: readonly VehicleType[] = ["panelvan", "kamyonet", "kamyon", "kirkayak", "tir"];
/** Araç, ilanda istenen tipteki yükü taşıyabilir mi (aynı ya da daha büyük tip)? */
export const vehicleCanCarry = (vehicle: VehicleType, requested: VehicleType) =>
  VEHICLE_SIZE_ORDER.indexOf(vehicle) >= VEHICLE_SIZE_ORDER.indexOf(requested);
/** Bu araç tipinin taşıyabileceği ilan tipleri (kendisi ve daha küçükler) */
export const typesCarriedBy = (vehicle: VehicleType) => VEHICLE_SIZE_ORDER.filter((t) => vehicleCanCarry(vehicle, t));
/** Bu ilan tipini taşıyabilecek araç tipleri (kendisi ve daha büyükler) */
export const typesThatCarry = (requested: VehicleType) => VEHICLE_SIZE_ORDER.filter((t) => vehicleCanCarry(t, requested));

export const BODY_TYPES = {
  tenteli: "Tenteli",
  acik: "Açık kasa",
  kapali: "Kapalı kasa",
  frigo: "Frigo",
  damper: "Damper",
  kayar_perde: "Kayar perde",
  lowbed: "Lowbed",
} as const;
export type BodyType = keyof typeof BODY_TYPES;

/** Araç tanıma görsellerinde kasa seçilmemişse gösterilen, o araçta en sık görülen kasa */
export const TYPICAL_BODY: Record<VehicleType, BodyType> = { tir: "tenteli", kirkayak: "damper", kamyon: "acik", kamyonet: "acik", panelvan: "kapali" };

/** Araç tanıma (web 3B görüntüleyici, rehber, mobil seçim): tek cümlelik açıklama. Kapasiteler yaklaşık; kesin değer ruhsatta. */
export const VEHICLE_TYPE_INFO: Record<VehicleType, string> = {
  tir: "Çekici ve yarı römorktan oluşur; şehirlerarası komple yüklerin aracı, yaklaşık 25 ton yük alır.",
  kirkayak: "Dört dingilli büyük kamyon; tırdan kısa olduğu için şehir içine ve dar yükleme alanlarına daha kolay girer.",
  kamyon: "Orta tonajlı yükler için; bölgesel dağıtımda ve kısa-orta mesafede yaygın.",
  kamyonet: "Azami yüklü ağırlığı 3,5 tonu geçmeyen hafif yük taşıtı; birkaç paletlik ya da parça yükler için.",
  panelvan: "Kapalı kasalı hafif ticari araç; koli, küçük eşya ve şehir içi dağıtım için.",
};
export const BODY_TYPE_INFO: Record<BodyType, string> = {
  tenteli: "Brandayla örtülü; yandan ve üstten yükleme yapılabilir, en yaygın kasa.",
  acik: "Uzun ya da hacimli yükler için; yük bağlanarak taşınır.",
  kapali: "Yağmur ve hırsızlığa karşı korumalı; arkadan yüklenir.",
  frigo: "Soğutmalı; gıda ve ilaç gibi sıcaklık hassas yükler için.",
  damper: "Kasası devrilerek boşaltılır; kum, çakıl, hafriyat gibi dökme yükler için.",
  kayar_perde: "Yan perdeleri kayarak açılır; yandan forkliftle hızlı yükleme için.",
  lowbed: "Alçak platformlu; iş makinesi gibi yüksek ve ağır yükler için.",
};

export const CARGO_TYPES = {
  genel: "Genel kargo",
  palet: "Palet",
  dokme: "Dökme",
  insaat: "İnşaat malzemesi",
  gida: "Gıda",
  soguk_zincir: "Soğuk zincir",
  makine: "Makine / ekipman",
  tarim: "Tarım ürünü",
  tehlikeli: "Tehlikeli madde (ADR)",
} as const;
export type CargoType = keyof typeof CARGO_TYPES;

// docs/03 §6 — yük ilanı durum diyagramı
export const LOAD_STATUSES = [
  "taslak",
  "moderasyonda",
  "teyitli",
  "teyit_bekliyor",
  "suresi_doldu",
  "kapandi",
  "iptal",
] as const;
export type LoadStatus = (typeof LOAD_STATUSES)[number];
/** Araç: silinen araç kaydı silinmez (ilan/iş geçmişi), "silindi" olur. */
export const VEHICLE_STATUSES = ["aktif", "silindi"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/** Boş araç ilanı (FR-12) */
export const CAPACITY_STATUSES = ["aktif", "kapandi", "iptal", "suresi_doldu"] as const;
export type CapacityStatus = (typeof CAPACITY_STATUSES)[number];
export const CAPACITY_STATUS_LABELS: Record<CapacityStatus, string> = {
  aktif: "Aktif",
  kapandi: "Doldu",
  iptal: "İptal",
  suresi_doldu: "Süresi doldu",
};

export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  taslak: "Taslak",
  moderasyonda: "Onay bekliyor",
  teyitli: "Teyitli",
  teyit_bekliyor: "Teyit bekliyor",
  suresi_doldu: "Süresi doldu",
  kapandi: "Kapandı",
  iptal: "İptal",
};

// docs/03 §6 — iş (taşıma) durum diyagramı
export const JOB_STATUSES = [
  "anlasildi",
  "yuklendi",
  "yolda",
  "teslim_edildi",
  "tamamlandi",
  "itirazli",
  "iptal",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const CONFIRMATION_ANSWERS = ["gecerli", "arac_bulundu", "iptal"] as const;
export type ConfirmationAnswer = (typeof CONFIRMATION_ANSWERS)[number];

export const REPORT_REASONS = {
  yuk_yok: "Yük yok / gitmiş",
  telefon_acilmiyor: "Telefon açılmıyor",
  sahte: "Sahte ilan",
  fiyat_farkli: "Fiyat ilandakinden farklı",
  diger: "Diğer",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** Şikayetin yönetici kararı (FR-51). Yalnız "haklı" güven skoruna girer (BR-30 şikayet terimi). */
export const REPORT_STATUS_LABELS = {
  acik: "Açık",
  hakli: "Haklı bulundu",
  haksiz: "Haksız bulundu",
} as const;
export type ReportStatus = keyof typeof REPORT_STATUS_LABELS;

/**
 * Hesap durumu: askıdaki kullanıcı giriş yapamaz, ilanları yayından kalkar (FR-51). Kullanıcı hesabını dondurabilir
 * (FR-08): ilanları kapanır, bildirim almaz, veriler kalır; girişle açılır. Silinen hesabın (FR-07) kişisel verileri
 * anonimleştirilir; kayıt, karşı tarafların iş ve puan geçmişi için kalır.
 */
export const USER_STATUS_LABELS = {
  aktif: "Aktif",
  askida: "Askıda",
  donduruldu: "Donduruldu",
  silindi: "Silindi",
} as const;
export type UserStatus = keyof typeof USER_STATUS_LABELS;
/** Silinen hesabın her yerde görünen adı (FR-07; telefonu ve firması silinir). */
export const DELETED_USER_NAME = "Silinmiş kullanıcı";
/**
 * Hesap silme süreleri (FR-07, 2026-10-13 kararı). Nitelikli açık şikayet silmeyi en çok
 * `reportHoldDays` erteler (ilk ertelenen istekten; KVKK başvuruyu en geç 30 günde sonuçlandırmayı ister).
 * `holdRequestValidDays`'ten eski istek yeni başvuru sayılır. Silinen numaranın anahtarlı özeti `restoreDays`
 * saklanır: bu sürede aynı numarayla giriş eski hesabı (puanlar, geçmiş) geri açar; ama silmeden sonraki
 * `reopenAfterDays` gün giriş kapalıdır (silme ciddi bir işlem olsun, sil-aç döngüsü karşı tarafa gürültü üretmesin; ara
 * vermek isteyen hesabını dondurur, FR-08).
 */
export const ACCOUNT_DELETION = { reportHoldDays: 14, holdRequestValidDays: 30, reopenAfterDays: 7, restoreDays: 60 } as const;

export const DOCUMENT_TYPES = {
  ruhsat: "Araç ruhsatı",
  k_belgesi: "K yetki belgesi",
  src: "SRC belgesi",
  sigorta: "Sigorta poliçesi",
  vergi_levhasi: "Vergi levhası",
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;

export const RATING_TAGS = {
  zamaninda: "Zamanında",
  iletisim_iyi: "İletişimi iyi",
  odeme_sorunsuz: "Ödeme sorunsuz",
  yuk_ozenli: "Yüke özenli",
  gec_kaldi: "Geç kaldı",
  fiyat_degisti: "Fiyat değişti",
} as const;
export type RatingTag = keyof typeof RATING_TAGS;

/** Uygulama içi bildirim tipleri (A14 Bildirimler ekranı; push ile birlikte kayda geçer). */
export const NOTIFICATION_TYPES = {
  load_confirm: "İlan teyidi",
  match_for_carrier: "Uygun yük",
  match_for_shipper: "Uygun araç",
  offer_new: "Yeni teklif",
  offer_result: "Teklif sonucu",
  job_update: "İş durumu",
  route_alert: "Rota alarmı",
  favorite_load: "Çalıştığınız yük sahibi",
  document_review: "Belge incelemesi",
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/** Yönetici işlem kaydı (NFR-05): işlem → panelde ve veri dökümünde görünen ad */
export const AUDIT_ACTIONS = {
  belge_goruntuleme: "Belgeyi açtı",
  belge_onay: "Belgeyi onayladı",
  belge_ret: "Belgeyi reddetti",
  ilan_onay: "İlanı onayladı",
  ilan_ret: "İlanı reddetti",
  sikayet_hakli: "Şikayeti haklı buldu",
  sikayet_haksiz: "Şikayeti haksız buldu",
  itiraz_tamamlandi: "İtirazda teslimi geçerli saydı",
  itiraz_iptal: "İtirazda işi iptal etti",
  askiya_alma: "Hesabı askıya aldı",
  askiyi_kaldirma: "Askıyı kaldırdı",
  ayar_degisikligi: "Ayarı değiştirdi",
  ayar_sifirlama: "Ayarı varsayılana döndürdü",
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;
export const AUDIT_TARGETS = { document: "Belge", load: "İlan", report: "Şikayet", job: "Taşıma", user: "Hesap", setting: "Ayar" } as const;
export type AuditTarget = keyof typeof AUDIT_TARGETS;

/** BR-22 saatlik sınırına giren tipler */
export const MATCH_NOTIFICATION_TYPES: readonly NotificationType[] = ["match_for_carrier", "match_for_shipper", "route_alert"];
