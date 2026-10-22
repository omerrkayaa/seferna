// Veri modeli — docs/04 §3
import {
  type AuditAction,
  type AuditTarget,
  BODY_TYPES,
  type CapacityStatus,
  type DocumentType,
  type NotificationType,
  type VehicleStatus,
  CARGO_TYPES,
  DOCUMENT_TYPES,
  JOB_STATUSES,
  LOAD_STATUSES,
  REPORT_REASONS,
  ROLES,
  VEHICLE_TYPES,
} from "@nakliye/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [string, ...string[]];

export const roleEnum = pgEnum("role", ROLES);
export const vehicleTypeEnum = pgEnum("vehicle_type", keys(VEHICLE_TYPES));
export const bodyTypeEnum = pgEnum("body_type", keys(BODY_TYPES));
export const cargoTypeEnum = pgEnum("cargo_type", keys(CARGO_TYPES));
export const documentTypeEnum = pgEnum("document_type", keys(DOCUMENT_TYPES));
export const reportReasonEnum = pgEnum("report_reason", keys(REPORT_REASONS));
export const loadStatusEnum = pgEnum("load_status", LOAD_STATUSES);
export const jobStatusEnum = pgEnum("job_status", JOB_STATUSES);
export const reviewStatusEnum = pgEnum("review_status", ["bekliyor", "onay", "ret"]);
export const priceTypeEnum = pgEnum("price_type", ["sabit", "teklif"]);
export const offerStatusEnum = pgEnum("offer_status", ["beklemede", "kabul", "ret", "geri_cekildi"]);
export const confirmAnswerEnum = pgEnum("confirm_answer", ["gecerli", "arac_bulundu", "iptal", "cevapsiz"]);

/**
 * WGS84 (SRID 4326) nokta. drizzle'ın kendi `geometry()` tipi `srid` ayarını yok sayıyor: sütunu
 * `geometry(point)` (SRID 0) oluşturuyor ve değeri SRID'siz yazıyor. SRID'ler karışırsa PostGIS
 * "mixed SRID" hatası verir; bu tip hem sütunu hem değeri 4326 ile tanımlar. x = boylam, y = enlem.
 */
const point = customType<{ data: { x: number; y: number }; driverData: string }>({
  dataType: () => "geometry(Point,4326)",
  toDriver: ({ x, y }) => `SRID=4326;POINT(${x} ${y})`,
  // PostGIS hex EWKB döndürür: bayt sırası(1) + tip(4) [+ SRID(4)] + x(8) + y(8)
  fromDriver: (hex) => {
    const buf = Buffer.from(hex, "hex");
    const le = buf[0] === 1;
    const type = le ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
    const offset = type & 0x20000000 ? 9 : 5;
    const read = (o: number) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
    return { x: read(offset), y: read(offset + 8) };
  },
});
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ── Konum (statik veri) ─────────────────────────────────────────────
export const provinces = pgTable("provinces", {
  id: smallint("id").primaryKey(), // plaka kodu
  name: varchar("name", { length: 40 }).notNull(),
  geom: point("geom").notNull(),
});

export const districts = pgTable(
  "districts",
  {
    id: integer("id").primaryKey(),
    provinceId: smallint("province_id").notNull().references(() => provinces.id),
    name: varchar("name", { length: 60 }).notNull(),
    geom: point("geom").notNull(),
  },
  (t) => [index("districts_province_idx").on(t.provinceId), index("districts_geom_idx").using("gist", t.geom)],
);

// ── Kullanıcı ───────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Silinen hesapta (FR-07) boşaltılır: numara yeni bir hesapla yeniden kullanılabilir
  phone: varchar("phone", { length: 16 }).unique(),
  name: varchar("name", { length: 80 }),
  verificationLevel: smallint("verification_level").notNull().default(0),
  trustScore: real("trust_score").notNull().default(0.25),
  status: varchar("status", { length: 16 }).notNull().default("aktif"),
  // FR-51: askıya alma kaydı (status = 'askida' iken dolu)
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendReason: varchar("suspend_reason", { length: 500 }),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // FR-07: silinen numaranın anahtarlı özeti; ACCOUNT_DELETION.restoreDays içinde aynı numarayla giriş hesabı geri açar
  phoneHmac: varchar("phone_hmac", { length: 64 }).unique(),
  // FR-07: açık şikayet yüzünden ertelenen silme isteğinin başladığı an (erteleme en çok ACCOUNT_DELETION.reportHoldDays)
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Bir kullanıcının tek firması olur (FR-03; API'de POST/PATCH /companies tekil)
  ownerUserId: uuid("owner_user_id").notNull().unique().references(() => users.id),
  title: varchar("title", { length: 160 }).notNull(),
  taxNo: varchar("tax_no", { length: 11 }),
  taxOffice: varchar("tax_office", { length: 80 }),
  address: text("address"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  // Herkese açık nakliyeci profili (/nakliyeci/<id>): nakliyeci kendisi açar (karar 2026-10-17, KVKK açık rıza)
  publicProfile: boolean("public_profile").notNull().default(false),
  createdAt: createdAt(),
});

// Amaç başına ayrı kod (giriş / hesap silme): biri istenince diğeri geçersiz olmaz, giriş kodu silmede geçmez
export const otpCodes = pgTable(
  "otp_codes",
  {
    phone: varchar("phone", { length: 16 }).notNull(),
    purpose: varchar("purpose", { length: 8 }).notNull().default("giris"),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: smallint("attempts").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.phone, t.purpose] })],
);

// NFR-04 (docs/04 §8): kod isteği kaydı — numara başına günlük, IP başına saatlik sınır (SMS maliyeti, kaba kuvvet,
// taciz). 2 günden eskiler zamanlayıcıda silinir. ip: istemci adresinin sınır anahtarı (IPv4 ya da IPv6 /64 ağı;
// AuthService.ipLimitKey; adres main.ts trust proxy ile çözülür).
export const otpRequests = pgTable(
  "otp_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: varchar("phone", { length: 16 }).notNull(),
    ip: varchar("ip", { length: 45 }),
    purpose: varchar("purpose", { length: 8 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("otp_requests_phone_idx").on(t.phone, t.createdAt), index("otp_requests_ip_idx").on(t.ip, t.createdAt)],
);

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  /** İkinci adımın geçildiği an (NFR-04); yenilemede taşınır, yönetici rolü bundan 12 saat sonra düşer */
  mfaAt: timestamp("mfa_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// NFR-04 yönetici iki adımlı doğrulaması (auth/mfa.service.ts). Anahtarlar AES-256-GCM ile şifreli (auth/totp.ts).
// pending_enc: kurulumda ya da cihaz değiştirirken onaylanmamış yeni anahtar. last_step: kullanılan son 30 sn'lik adım
// (aynı kod ikinci kez geçmez). failed_count/locked_until: ardışık 5 hatalı kod → 15 dk kilit.
export const userTotp = pgTable("user_totp", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  secretEnc: text("secret_enc"),
  pendingEnc: text("pending_enc"),
  /** Bekleyen anahtar 10 dk geçerli, 5 hatalı kodda atılır (güvenlik incelemesi 2026-10-15, bulgu 2) */
  pendingAt: timestamp("pending_at", { withTimezone: true }),
  pendingAttempts: integer("pending_attempts").notNull().default(0),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  lastStep: bigint("last_step", { mode: "number" }).notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Tek kullanımlık kurtarma kodları (anahtarlı özet; düz kod yalnız üretildiği yanıtta görünür) */
export const totpRecoveryCodes = pgTable(
  "totp_recovery_codes",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.codeHash] })],
);

/** SMS kodu doğrulanmış, ikinci adımı bekleyen giriş (5 dk; süresi dolanları zamanlayıcı siler) */
export const mfaChallenges = pgTable(
  "mfa_challenges",
  {
    tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("mfa_challenges_user_idx").on(t.userId)],
);

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fcmToken: text("fcm_token").notNull().unique(),
  platform: varchar("platform", { length: 16 }).notNull(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
});

// ── Araç ve belge ──────────────────────────────────────────────────
export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
    plate: varchar("plate", { length: 12 }).notNull(),
    vehicleType: vehicleTypeEnum("vehicle_type").notNull(),
    bodyType: bodyTypeEnum("body_type").notNull(),
    capacityTon: numeric("capacity_ton", { precision: 5, scale: 2, mode: "number" }).notNull(),
    volumeM3: numeric("volume_m3", { precision: 6, scale: 2, mode: "number" }),
    status: varchar("status", { length: 16 }).$type<VehicleStatus>().notNull().default("aktif"),
    createdAt: createdAt(),
  },
  (t) => [
    // Plaka yalnız silinmemiş araçlar arasında tekil: silinen araç (geçmiş için saklanır) plakayı kilitlemesin
    uniqueIndex("vehicles_plate_active_uq").on(t.plate).where(sql`status <> 'silindi'`),
    index("vehicles_owner_idx").on(t.ownerUserId),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id),
    type: documentTypeEnum("type").$type<DocumentType>().notNull(),
    fileKey: text("file_key").notNull(),
    // FR-05: tür dosyanın ilk baytlarından (DOCUMENT_MIME_TYPES); dosya adı ve beyan edilen türe güvenilmez
    contentType: varchar("content_type", { length: 32 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: reviewStatusEnum("status").notNull().default("bekliyor"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    expiresAt: date("expires_at"),
    // Vergi levhası yüklenirken firmanın kimliği: onay yalnız firma hâlâ bu kimlikteyse doğrular (inceleme sırasında
    // unvan/vergi no değiştirilip başka firma doğrulatılamasın; güvenlik incelemesi 2026-10-14)
    companyTitle: varchar("company_title", { length: 160 }),
    companyTaxNo: varchar("company_tax_no", { length: 11 }),
    // Süresi geçen onaylı belge için seviye yenilendi ve sahibine bildirildi (zamanlayıcı bir kez yapar)
    expiryHandledAt: timestamp("expiry_handled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("documents_status_idx").on(t.status), index("documents_owner_idx").on(t.ownerUserId)],
);

// ── İlanlar ────────────────────────────────────────────────────────
export const loadPosts = pgTable(
  "load_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareId: varchar("share_id", { length: 12 }).notNull().unique(), // WhatsApp paylaşım linki (F8)
    shipperId: uuid("shipper_id").notNull().references(() => users.id),
    originDistrictId: integer("origin_district_id").notNull().references(() => districts.id),
    originGeom: point("origin_geom").notNull(),
    destDistrictId: integer("dest_district_id").notNull().references(() => districts.id),
    destGeom: point("dest_geom").notNull(),
    loadFrom: date("load_from").notNull(),
    loadTo: date("load_to").notNull(),
    cargoType: cargoTypeEnum("cargo_type").notNull(),
    weightTon: numeric("weight_ton", { precision: 5, scale: 2, mode: "number" }).notNull(),
    vehicleType: vehicleTypeEnum("vehicle_type").notNull(),
    bodyType: bodyTypeEnum("body_type"),
    priceType: priceTypeEnum("price_type").notNull(),
    price: numeric("price", { precision: 10, scale: 2, mode: "number" }),
    note: varchar("note", { length: 280 }),
    status: loadStatusEnum("status").notNull().default("teyitli"),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    nextReminderAt: timestamp("next_reminder_at", { withTimezone: true }).notNull(),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    // BR-11: null = moderasyon gerekmedi; bekliyor/onay/ret = moderasyon kararı. Onaylı ilan sayısı muafiyeti belirler.
    moderation: reviewStatusEnum("moderation"),
    // Eşleştirme (BR-20) bu ilan için en son ne zaman çalıştı; null = bekliyor (zamanlayıcı süpürür)
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("load_posts_origin_geom_idx").using("gist", t.originGeom),
    index("load_posts_dest_geom_idx").using("gist", t.destGeom),
    // Metre cinsinden sorgular (yakınımdakiler, eşleştirme, dönüş planı) sütunu ::geography'ye çevirir; geometry indeksi
    // o ifadeye uymaz. İfade indeksi hem kullanılır hem de PostgreSQL ifade için istatistik toplar (NFR-01).
    index("load_posts_origin_geog_idx").using("gist", sql`(${t.originGeom}::geography)`),
    index("load_posts_dest_geog_idx").using("gist", sql`(${t.destGeom}::geography)`),
    index("load_posts_status_date_idx").on(t.status, t.loadFrom),
    index("load_posts_shipper_idx").on(t.shipperId),
    index("load_posts_reminder_idx").on(t.nextReminderAt).where(sql`status = 'teyitli'`),
  ],
);

/**
 * Her "hâlâ geçerli mi?" sorusu bir satır (metrik: cevap süresi, kanal, cevapsız oranı).
 * Açık soru: answer IS NULL. Cevapsız düşen ilanda answer = 'cevapsiz', answered_at boş kalır.
 */
export const loadConfirmations = pgTable(
  "load_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loadPostId: uuid("load_post_id").notNull().references(() => loadPosts.id, { onDelete: "cascade" }),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
    pushOpenedAt: timestamp("push_opened_at", { withTimezone: true }),
    smsSentAt: timestamp("sms_sent_at", { withTimezone: true }),
    // SMS'teki tek kullanımlık teyit linkinin token'ı (sha256); token'ın kendisi saklanmaz
    smsTokenHash: varchar("sms_token_hash", { length: 64 }).unique(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    answer: confirmAnswerEnum("answer"),
    channel: varchar("channel", { length: 8 }), // app | sms | push
  },
  (t) => [index("load_confirmations_load_idx").on(t.loadPostId)],
);

export const capacityPosts = pgTable(
  "capacity_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    carrierId: uuid("carrier_id").notNull().references(() => users.id),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
    originDistrictId: integer("origin_district_id").notNull().references(() => districts.id),
    originGeom: point("origin_geom").notNull(),
    destDistrictId: integer("dest_district_id").references(() => districts.id), // null = her yer
    destGeom: point("dest_geom"),
    availableFrom: date("available_from").notNull(),
    availableTo: date("available_to").notNull(),
    status: varchar("status", { length: 16 }).$type<CapacityStatus>().notNull().default("aktif"),
    matchedAt: timestamp("matched_at", { withTimezone: true }), // bkz. load_posts.matched_at
    createdAt: createdAt(),
  },
  (t) => [
    index("capacity_origin_geom_idx").using("gist", t.originGeom),
    // Eşleştirmenin metre cinsinden ön süzgeci (::geography) için; bkz. load_posts_origin_geog_idx
    index("capacity_origin_geog_idx").using("gist", sql`(${t.originGeom}::geography)`),
    index("capacity_dest_geog_idx").using("gist", sql`(${t.destGeom}::geography)`),
    index("capacity_status_date_idx").on(t.status, t.availableFrom),
    index("capacity_vehicle_idx").on(t.vehicleId),
  ],
);

// Rota alarmı (FR-22): ilçe merkezi ± yarıçap; varış null = her yer, araç tipi null = hepsi
export const routeAlerts = pgTable(
  "route_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    originDistrictId: integer("origin_district_id").notNull().references(() => districts.id),
    originRadiusKm: smallint("origin_radius_km").notNull(),
    destDistrictId: integer("dest_district_id").references(() => districts.id),
    destRadiusKm: smallint("dest_radius_km").notNull(),
    vehicleType: vehicleTypeEnum("vehicle_type"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  // Alarm araması yarıçapla yapılır (ilçe merkezine mesafe); aktif alarmlar az olduğu için taranır, ilçe kimliği indeksi işe yaramaz
  (t) => [index("route_alerts_user_idx").on(t.userId)],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loadPostId: uuid("load_post_id").notNull().references(() => loadPosts.id, { onDelete: "cascade" }),
    capacityPostId: uuid("capacity_post_id").notNull().references(() => capacityPosts.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    outcome: varchar("outcome", { length: 16 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("matches_pair_uq").on(t.loadPostId, t.capacityPostId),
    index("matches_capacity_idx").on(t.capacityPostId),
  ],
);

/**
 * Uygulama içi bildirimler (A14) — push'un kaydı. ref_key tekilleştirir: BR-22 "aynı ilan için en fazla 1 bildirim"
 * (ör. "match:load:<id>"); (user_id, ref_key) tekil olduğu için eşzamanlı eşleştirmeler de çift bildirim üretemez.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 24 }).$type<NotificationType>().notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    body: varchar("body", { length: 500 }).notNull(),
    data: jsonb("data").$type<Record<string, string>>().notNull().default({}),
    refKey: varchar("ref_key", { length: 80 }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_ref_uq").on(t.userId, t.refKey),
    index("notifications_user_time_idx").on(t.userId, t.createdAt),
  ],
);

// ── Teklif ve iş ───────────────────────────────────────────────────
export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loadPostId: uuid("load_post_id").notNull().references(() => loadPosts.id, { onDelete: "cascade" }),
    carrierId: uuid("carrier_id").notNull().references(() => users.id),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
    price: numeric("price", { precision: 10, scale: 2, mode: "number" }).notNull(),
    note: varchar("note", { length: 280 }),
    status: offerStatusEnum("status").notNull().default("beklemede"),
    createdAt: createdAt(),
  },
  (t) => [
    index("offers_load_idx").on(t.loadPostId),
    index("offers_carrier_idx").on(t.carrierId),
    // Bir nakliyecinin aynı ilana tek bekleyen teklifi olur (değiştirmek için geri çekip yenisini verir)
    uniqueIndex("offers_one_pending_uq").on(t.loadPostId, t.carrierId).where(sql`status = 'beklemede'`),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loadPostId: uuid("load_post_id").notNull().unique().references(() => loadPosts.id),
    offerId: uuid("offer_id").references(() => offers.id),
    shipperId: uuid("shipper_id").notNull().references(() => users.id),
    carrierId: uuid("carrier_id").notNull().references(() => users.id),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
    agreedPrice: numeric("agreed_price", { precision: 10, scale: 2, mode: "number" }),
    status: jobStatusEnum("status").notNull().default("anlasildi"),
    deliveryCodeHash: varchar("delivery_code_hash", { length: 64 }).notNull(),
    // Yanlış teslim kodu denemeleri (6 hane kaba kuvvete açık); sınır dolunca yük sahibi yeni kod üretir
    deliveryCodeAttempts: smallint("delivery_code_attempts").notNull().default(0),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("jobs_shipper_idx").on(t.shipperId),
    index("jobs_carrier_idx").on(t.carrierId),
    index("jobs_vehicle_idx").on(t.vehicleId),
    index("jobs_delivered_idx").on(t.deliveredAt).where(sql`status = 'teslim_edildi'`),
  ],
);

// İşin zaman çizelgesi (durum değişiklikleri, kod denemeleri…); null actor = sistem
export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId)],
);

export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    raterId: uuid("rater_id").notNull().references(() => users.id),
    rateeId: uuid("ratee_id").notNull().references(() => users.id),
    stars: smallint("stars").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'`),
    comment: varchar("comment", { length: 500 }),
    // Kör puanlama: iki taraf da puanlayınca ya da puanlama süresi bitince dolar; dolmadan puan görünmez ve skora girmez
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ratings_job_rater_uq").on(t.jobId, t.raterId),
    index("ratings_ratee_idx").on(t.rateeId),
    index("ratings_unrevealed_idx").on(t.jobId).where(sql`revealed_at is null`),
  ],
);

// ── Güven ve moderasyon ────────────────────────────────────────────
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id").notNull().references(() => users.id),
    targetType: varchar("target_type", { length: 16 }).notNull(),
    targetId: uuid("target_id").notNull(),
    reason: reportReasonEnum("reason").notNull(),
    note: varchar("note", { length: 500 }),
    status: varchar("status", { length: 16 }).notNull().default("acik"),
    resolution: text("resolution"),
    // FR-51: yönetici kararı
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reports_once_uq").on(t.reporterId, t.targetType, t.targetId, t.reason),
    index("reports_target_idx").on(t.targetType, t.targetId),
    index("reports_reporter_time_idx").on(t.reporterId, t.createdAt),
  ],
);

// NFR-09 istek istatistiği (common/api-stats.service.ts): saat × yöntem × rota kalıbı başına sayılar ve süre dilimleri
// (ms: ≤50, ≤100, ≤200, ≤300, ≤500, ≤1000, ≤3000, >3000). İstek başına satır yok; 90 günden eskiler silinir.
export const apiRequestStats = pgTable(
  "api_request_stats",
  {
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    method: varchar("method", { length: 8 }).notNull(),
    route: varchar("route", { length: 160 }).notNull(),
    requests: integer("requests").notNull().default(0),
    status4xx: integer("status_4xx").notNull().default(0),
    status5xx: integer("status_5xx").notNull().default(0),
    totalMs: bigint("total_ms", { mode: "number" }).notNull().default(0),
    maxMs: integer("max_ms").notNull().default(0),
    b50: integer("b50").notNull().default(0),
    b100: integer("b100").notNull().default(0),
    b200: integer("b200").notNull().default(0),
    b300: integer("b300").notNull().default(0),
    b500: integer("b500").notNull().default(0),
    b1000: integer("b1000").notNull().default(0),
    b3000: integer("b3000").notNull().default(0),
    bInf: integer("b_inf").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.hour, t.method, t.route] })],
);

// FR-54 parametre yönetimi (settings/settings.service.ts): anahtar başına tam, doğrulanmış nesne; yoksa shared varsayılanı
export const settings = pgTable("settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 24 }).notNull().unique(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// NFR-05 yönetici işlem kaydı (audit/audit.service.ts): karar ve belge açma; kişi kendi dökümünde görür
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id").notNull().references(() => users.id),
    action: varchar("action", { length: 24 }).$type<AuditAction>().notNull(),
    targetType: varchar("target_type", { length: 12 }).$type<AuditTarget>().notNull(),
    targetId: uuid("target_id").notNull(),
    subjectUserId: uuid("subject_user_id").references(() => users.id),
    // Ret sebebi, askı gerekçesi, itiraz kararı gibi serbest metin; kişinin hesabı silinince boşaltılır
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("admin_audit_created_idx").on(t.createdAt), index("admin_audit_subject_idx").on(t.subjectUserId, t.createdAt)],
);

// BR-40: "Ara" ile numara açıldığında bir satır (kötüye kullanım ölçümü, BR-05 tanıklığı, eşleşme isabeti metriği)
export const callLogs = pgTable(
  "call_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callerId: uuid("caller_id").notNull().references(() => users.id),
    loadPostId: uuid("load_post_id").notNull().references(() => loadPosts.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("call_logs_caller_time_idx").on(t.callerId, t.createdAt),
    index("call_logs_load_idx").on(t.loadPostId),
  ],
);

export const appParams = pgTable("app_params", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// P7 "Nakliyecilerim": yük sahibinin favori nakliyecileri (yalnız birlikte iş yapılmış olanlar). Yeni ilanı yayına
// çıkınca onlara mesafe şartı olmadan haber verilir.
export const favoriteCarriers = pgTable(
  "favorite_carriers",
  {
    shipperId: uuid("shipper_id").notNull().references(() => users.id),
    carrierId: uuid("carrier_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.shipperId, t.carrierId] }), index("favorite_carriers_carrier_idx").on(t.carrierId)],
);

// F7: ilçe merkezleri arası karayolu mesafesi önbelleği (OSRM'den bir kez alınır; yön önemli: A→B ile B→A farklı olabilir)
export const districtRoutes = pgTable(
  "district_routes",
  {
    originDistrictId: integer("origin_district_id").notNull().references(() => districts.id),
    destDistrictId: integer("dest_district_id").notNull().references(() => districts.id),
    distanceM: integer("distance_m").notNull(),
    durationS: integer("duration_s").notNull(),
    // F4 rota üstü (BR-23): OSRM'nin sadeleştirilmiş çizgisi, [boylam, enlem] dizisi; mesafe için sorulan çiftte boş
    geometry: jsonb("geometry").$type<[number, number][]>(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.originDistrictId, t.destDistrictId] })],
);
