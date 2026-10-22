// API yanıtlarının web'de kullanılan kısmı (apps/api servislerindeki view() çıktıları).
import type { AuditAction, AuditTarget, BodyType, SettingKey, CargoType, DocumentType, JobStatus, LoadStatus, NotificationType, RatingTag, ReportReason, ReportStatus, Role, UserStatus, VehicleType } from "@nakliye/shared";

export interface Place {
  district: string;
  province: string;
}

export interface Me {
  id: string;
  phone: string;
  name: string | null;
  roles: Role[];
  verified: boolean;
  company: { title: string; taxNo: string | null; taxOffice: string | null; address: string | null; verified: boolean } | null;
  /** Yönetim bölümü (NFR-04): "tamam" = oturum ikinci adımı geçti, "kurulum" = uygulama kurulmamış, "giris" = yeniden giriş gerekli */
  adminMfa: "tamam" | "kurulum" | "giris" | null;
}

/** GET /admin/audit — yönetici işlem kaydı (NFR-05) */
export interface AuditItem {
  id: string;
  action: AuditAction;
  targetType: AuditTarget;
  targetId: string;
  note: string | null;
  createdAt: string;
  admin: { id: string; name: string | null; phone: string | null };
  subject: { id: string; name: string | null; status: string } | null;
}

/** GET /admin/settings — FR-54 parametre yönetimi */
export interface AdminSettings {
  settings: Record<SettingKey, { label: string; value: unknown; defaults: unknown; isDefault: boolean; updatedAt: string | null; updatedBy: string | null }>;
  pricePreview: { vehicleType: VehicleType; min: number; max: number }[];
}

/** GET /me/totp */
export interface TotpStatus {
  enabled: boolean;
  enabledAt: string | null;
  pending: boolean;
  recoveryCodesLeft: number;
  lockedUntil: string | null;
}

export interface Province {
  id: number;
  name: string;
  districts: { id: number; name: string }[];
}

export interface LoadItem {
  id: string;
  /** Paylaşım sayfası kimliği (/ilan/<shareId>, F8) */
  shareId: string;
  status: LoadStatus;
  origin: Place;
  dest: Place;
  loadFrom: string;
  loadTo: string;
  cargoType: CargoType;
  weightTon: number;
  vehicleType: VehicleType;
  priceType: "sabit" | "teklif";
  price: number | null;
  lastConfirmedAt: string | null;
  createdAt: string;
  /** Yalnız sahibine: bekleyen teklif sayısı */
  pendingOffers: number;
}

/** Sahibin gördüğü ilan detayı (GET /loads/:id) */
export interface LoadDetail extends LoadItem {
  origin: Place & { districtId: number; provinceId: number };
  dest: Place & { districtId: number; provinceId: number };
  bodyType: BodyType | null;
  note: string | null;
  moderation: "bekliyor" | "onay" | "ret" | null;
}

/** Yük sahibinin ilanına gelen teklif (GET /loads/:id/offers) — P5 karşılaştırma */
export interface Offer {
  id: string;
  status: "beklemede" | "kabul" | "ret" | "geri_cekildi";
  price: number;
  note: string | null;
  createdAt: string;
  vehicle: { vehicleType: VehicleType; bodyType: BodyType; capacityTon: number };
  carrier: {
    id: string;
    displayName: string | null;
    verified: boolean;
    /** Görünür puanların ortalaması; puan yoksa null */
    rating: number | null;
    ratingCount: number;
    completedJobs: number;
  };
}

/** Taşıma (iş) — GET /jobs, GET /jobs/:id (yük sahibinin gördüğü) */
export interface Job {
  id: string;
  role: "shipper" | "carrier";
  status: JobStatus;
  agreedPrice: number | null;
  load: { id: string; loadFrom: string; loadTo: string; cargoType: CargoType; weightTon: number; note: string | null; origin: Place; dest: Place };
  vehicle: { plate: string; vehicleType: VehicleType; bodyType: BodyType; capacityTon: number };
  /** Kabulden sonra numaralar karşılıklı açık (FR-32) */
  /** Silinen hesapta (FR-07) numara yok, ad "Silinmiş kullanıcı" */
  counterpart: { displayName: string | null; phone: string | null; verified: boolean };
  deliveryCodeAttemptsLeft: number;
  createdAt: string;
  deliveredAt: string | null;
  completedAt: string | null;
  autoCompleteAt: string | null;
  cancelReason: string | null;
}

export interface RatingView {
  stars: number;
  tags: RatingTag[];
  comment: string | null;
  at: string;
}

export interface JobDetail extends Job {
  rating: {
    deadline: string | null;
    canRate: boolean;
    given: RatingView | null;
    /** Kör puanlama: karşı taraf puanladıysa ama görünür değilse yalnız { revealed: false } */
    received: ({ revealed: true } & RatingView) | { revealed: false } | null;
  };
  events: { type: string; at: string; by: "shipper" | "carrier" | "system" | "admin"; meta: Record<string, unknown> | null }[];
}

export type DocumentStatus = "bekliyor" | "onay" | "ret";

/** GET /documents öğesi (FR-05) */
export interface MyDocument {
  id: string;
  type: DocumentType;
  vehicleId: string | null;
  plate: string | null;
  status: DocumentStatus;
  rejectReason: string | null;
  expiresAt: string | null;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  reviewedAt: string | null;
}

/** GET /admin/documents öğesi (Y1, FR-50) */
export interface AdminDocument {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  contentType: string;
  sizeBytes: number;
  rejectReason: string | null;
  expiresAt: string | null;
  createdAt: string;
  reviewedAt: string | null;
  owner: { id: string; name: string | null; phone: string | null; status: UserStatus };
  company: { title: string; taxNo: string | null; taxOffice: string | null; verifiedAt: string | null } | null;
  /** Vergi levhası yüklenirken firmanın kimliği; onay yalnız firma hâlâ bu kimlikteyse doğrular */
  uploadedAs: { title: string; taxNo: string | null } | null;
  companyChanged: boolean;
  vehicle: { id: string; plate: string; vehicleType: VehicleType } | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  hasMore: boolean;
}

/** SMS teyit linki (GET /public/confirm/:token) */
export interface PublicConfirm {
  origin: Place;
  dest: Place;
  loadFrom: string;
  loadTo: string;
  cargoType: CargoType;
  weightTon: number;
  vehicleType: VehicleType;
  priceType: "sabit" | "teklif";
  price: number | null;
  status: LoadStatus;
}

/** Yönetici: moderasyondaki ilan (GET /admin/loads) — tam numarayla */
export interface AdminLoad extends LoadDetail {
  shipper: { displayName: string | null; verified: boolean; phoneMasked: string };
  shipperPhone: string;
}

export interface AdminUser {
  id: string;
  name: string | null;
  /** Silinen hesapta null */
  phone: string | null;
  status: UserStatus;
  trustScore: number;
  suspendedAt: string | null;
  suspendReason: string | null;
}

/** Yönetici: şikayet (GET /admin/reports) */
export interface AdminReport {
  id: string;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  reporter: { id: string; name: string | null; phone: string | null };
  target: {
    type: "load_post" | "user";
    id: string;
    load: { status: LoadStatus; origin: Place; dest: Place } | null;
    owner: AdminUser | null;
  };
  openOnTarget: number;
}

/** P7: birlikte iş yapılan nakliyeci (GET /me/carriers) */
export interface CarrierRelation {
  id: string;
  displayName: string | null;
  /** Silinen hesapta null */
  phone: string | null;
  verified: boolean;
  favorite: boolean;
  /** FR-08: hesabını dondurmuş (bildirim almaz) */
  frozen: boolean;
  jobsWithYou: number;
  completedWithYou: number;
  lastJobAt: string;
  reputation: { rating: number | null; ratingCount: number; completedJobs: number };
}

/** Yük sahibinin gösterge özeti (GET /loads/mine/summary, P2) */
export interface ShipperSummary {
  loads: { visible: number; awaiting: number; moderation: number };
  awaitingConfirmation: { id: string; status: LoadStatus; origin: Place; dest: Place; loadFrom: string; loadTo: string; lastConfirmedAt: string | null }[];
  offers: { pending: number; loads: { id: string; origin: Place; dest: Place; loadFrom: string; loadTo: string; pendingOffers: number }[] };
  jobs: { active: number; completed: number; cancelled: number };
}

/** Yönetici: platform metrikleri (GET /admin/metrics, Y5) */
/** NFR-09 istek istatistiği özeti (GET /admin/metrics → api) */
export interface ApiHealth {
  hours: number;
  requests: number;
  status4xx: number;
  status5xx: number;
  errorRate: number | null;
  clientErrorRate: number | null;
  meanMs: number | null;
  /** Süre dilimlerinden yaklaşık (dilimin üst sınırı); null: istek yok ya da > 3000 ms */
  p95Ms: number | null;
  maxMs: number;
  topErrors: ({ method: string; route: string } & Omit<ApiHealth, "hours" | "topErrors" | "slowest">)[];
  slowest: ({ method: string; route: string } & Omit<ApiHealth, "hours" | "topErrors" | "slowest">)[];
}

export interface AdminMetrics {
  api: { last24h: ApiHealth; last7d: ApiHealth };
  notifications: { windowDays: number; created: number; read: number; readRate: number | null };
  weeklyClosed: { week: string; closed: number }[];
  dailyLoads: { day: string; loads: number }[];
  live: { visible: number; fresh: number; freshness: number | null };
  confirmations: { windowDays: number; asked: number; answered: number; unanswered: number; open: number; answerRate: number | null; medianMinutes: number | null };
  matches: { windowDays: number; created: number; notified: number; converted: number; hitRate: number | null };
}

/** Yönetici: itirazlı taşıma (GET /admin/disputes) */
export interface AdminDispute {
  id: string;
  status: JobStatus;
  agreedPrice: number | null;
  load: { id: string; loadFrom: string; loadTo: string; cargoType: CargoType; weightTon: number; origin: Place; dest: Place };
  vehicle: { plate: string };
  shipper: { id: string; displayName: string | null; phone: string };
  carrier: { id: string; displayName: string | null; phone: string };
  deliveredAt: string | null;
  dispute: { reason: string | null; at: string } | null;
  decision: { outcome: "tamamlandi" | "iptal"; note: string | null; at: string } | null;
}

/** Bildirim kutusu (GET /notifications) — mobil lib/types.ts ile aynı */
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: { type?: string; loadId?: string; jobId?: string; capacityId?: string; offerId?: string; alertId?: string; confirmationId?: string };
  createdAt: string;
  readAt: string | null;
}

/** Paylaşım sayfası (GET /public/loads/:shareId). Yayından kalkmışsa yalnız güzergâh ve durum. */
export type SharedLoad =
  | {
      shareId: string;
      status: "teyitli" | "teyit_bekliyor";
      origin: Place;
      dest: Place;
      loadFrom: string;
      loadTo: string;
      cargoType: CargoType;
      weightTon: number;
      vehicleType: VehicleType;
      bodyType: BodyType | null;
      priceType: "sabit" | "teklif";
      price: number | null;
      note: string | null;
      lastConfirmedAt: string | null;
      shipper: { displayName: string | null; verified: boolean };
    }
  | { shareId: string; status: Exclude<LoadStatus, "teyitli" | "teyit_bekliyor">; origin: Place; dest: Place };

/** W2 güzergâh özeti (GET /public/routes/:from/:to, girişsiz). activeLoads = yük akışında görünen ilanlar. */
export interface RouteSummary {
  from: { id: number; name: string };
  to: { id: number; name: string };
  activeLoads: number;
  distanceKm: number;
  source: "karayolu" | "kus_ucusu";
  /** Büyükten küçüğe araç tipi */
  estimates: { vehicleType: VehicleType; min: number; max: number }[];
}

/** Tanıtımdaki canlı yük akışı (GET /public/feed): anonim; numara, ad, kimlik, fiyat ve not yok */
export interface PublicFeed {
  activeLoads: number;
  loads: { origin: Place; dest: Place; loadFrom: string; loadTo: string; cargoType: CargoType; weightTon: number; vehicleType: VehicleType; status: LoadStatus; lastConfirmedAt: string }[];
}

/** Herkese açık nakliyeci profili (GET /public/carriers/:id): telefon, kişi adı, plaka, vergi no yok */
export interface PublicCarrier {
  id: string;
  title: string;
  verificationLevel: 0 | 1 | 2;
  companyVerified: boolean;
  memberSince: string;
  rating: number | null;
  ratingCount: number;
  completedJobs: number;
  /** Büyükten küçüğe araç tipi */
  vehicles: { vehicleType: VehicleType; count: number; bodyTypes: BodyType[] }[];
}
