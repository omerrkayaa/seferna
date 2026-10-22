# 04 — Sistem Tasarımı

> Tarih: 2026-10-06 · Girdi: `03-sistem-analizi.md`
> ⚠️ Teknoloji yığını **öneridir**. Kodlamaya başlamadan önce kesinleştirilecek.

---

## 1. Mimari genel bakış

```
 ┌───────────────────┐   ┌──────────────────────────────┐
 │ Android uygulaması│   │ Web (Next.js)                │
 │ (React Native/Expo)│   │ • Landing + güzergâh sayfaları│
 │ şoför + yük sahibi│   │ • Yük sahibi paneli          │
 └─────────┬─────────┘   │ • Yönetici paneli            │
           │ HTTPS/JSON  └──────────────┬───────────────┘
           └──────────────┬─────────────┘
                          ▼
              ┌───────────────────────┐
              │ API (Node.js, NestJS) │──► SMS sağlayıcı (OTP, teyit)
              │ REST + OpenAPI        │──► FCM (push)
              └──────┬───────────┬────┘──► OSRM / mesafe servisi
                     │           │
          ┌──────────▼───┐  ┌────▼─────────────────┐
          │ PostgreSQL   │  │ İş kuyruğu (pg-boss) │
          │ + PostGIS    │  │ • teyit hatırlatma   │
          │              │  │ • eşleştirme         │
          └──────────────┘  │ • ilan düşürme       │
                            └──────────────────────┘
          ┌──────────────────────────┐
          │ Dosya deposu (S3 uyumlu) │  belgeler, imzalı URL
          └──────────────────────────┘
```

**Neden bu yapı:** Tek API hem Android hem web'e hizmet verir. Modüler monolit küçük ekip için en hızlı yoldur; mikroservise gerek yok. Kuyruk için Postgres tabanlı pg-boss kullanılır, böylece Redis'e ihtiyaç kalmaz (raporla uyumlu: "Redis başlangıç için gereksiz").

## 2. Teknoloji yığını (öneri)

| Katman | Seçim | Gerekçe | Alternatif |
|---|---|---|---|
| Dil | **TypeScript** (her yerde) | Tek dil, ortak tipler (API şemaları paylaşılır), öğrenci ekip için tek öğrenme eğrisi | — |
| Android | **React Native + Expo** | Android'e odak, hızlı geliştirme, OTA güncelleme, ileride iOS'a kapı açık | Flutter (Dart) · Kotlin + Compose (en performanslı ama web ile kod paylaşmaz) |
| Web | **Next.js (React)** | Landing ve güzergâh sayfalarında SEO için SSR, panel için React | Vite + React (SEO zayıf) |
| UI kitleri | Web: Tailwind + shadcn/ui · Mobil: React Native Paper ya da Tamagui | Hazır erişilebilir bileşenler | — |
| Backend | **NestJS** (Node.js) | Modüler yapı, DI, OpenAPI üretimi, katmanlı mimari | Fastify (daha hafif) · Python FastAPI |
| ORM / sorgu | **Drizzle ORM** + PostGIS için ham SQL | PostGIS sorgularını rahat yazmak | Prisma (PostGIS desteği zayıf) |
| Veritabanı | **PostgreSQL 16 + PostGIS** | Coğrafi sorgu (`ST_DWithin`), tek veritabanı | — |
| Kuyruk / zamanlayıcı | **pg-boss** | Postgres üstünde, ek altyapı yok | BullMQ + Redis |
| Mesafe ve rota | **OSRM** (OpenStreetMap, Türkiye haritası, Docker) | Ücretsiz, rota üstü hesap için polyline verir | Google Distance Matrix (ücretli) |
| Konum verisi | **İl/ilçe tablosu + merkez koordinatları** (statik veri seti) | Geocoding maliyeti yok, kullanıcı il/ilçe seçer | Nominatim |
| Harita gösterimi | Web: MapLibre GL + OSM döşemeleri · Android: react-native-maps | Ücretsiz | — |
| Push | **Firebase Cloud Messaging** | Android standardı | — |
| SMS | Yerli SMS sağlayıcı (ör. Netgsm, İleti Merkezi) [T, fiyat araştırılacak] | OTP ve teyit SMS'i | — |
| Kimlik doğrulama | Telefon OTP + JWT (erişim 15 dk, yenileme 30 gün) | — | — |
| Dosya deposu | S3 uyumlu (Cloudflare R2 / MinIO) | Belgeler özel, imzalı URL ile açılır | — |
| Barındırma | Tek VPS + Docker Compose (API, DB, OSRM, web) | Ucuz ve basit | Railway / Render |
| CI | GitHub Actions: lint, test, build, EAS build (APK) | — | — |
| İzleme | Sentry (hata) + basit metrik tablosu | — | — |

### Monorepo yapısı (öneri)
```
nakliye/
├─ apps/
│  ├─ mobile/        # Expo (Android)
│  ├─ web/           # Next.js (landing + panel + admin)
│  └─ api/           # NestJS
├─ packages/
│  ├─ shared/        # tipler, zod şemaları, sabitler (araç tipleri, iller)
│  └─ ui-tokens/     # renk ve tipografi tokenları
├─ infra/            # docker-compose, osrm, migrations
└─ docs/             # bu analiz dokümanları
```

---

## 3. Veri modeli (ER)

```
users ─┬─< user_roles
       ├─< vehicles ─< documents
       ├── companies (0..1)
       ├─< load_posts ─< offers >── vehicles
       │        └─< load_confirmations
       ├─< capacity_posts (boş araç)
       ├─< route_alerts
       ├─< jobs (load_post 1─1 job, carrier, shipper)
       │        ├─< job_events
       │        └─< ratings (2 adet, karşılıklı)
       ├─< reports (şikayet)
       ├─< notifications
       └─< devices (FCM token)
matches (load_post × capacity_post, skor)
locations (il, ilçe, geom)  -- statik
price_params                 -- F7 formül katsayıları
```

### Ana tablolar (özet alanlar)
| Tablo | Alanlar |
|---|---|
| **users** | id, phone (unique), name, verification_level (0–2), trust_score, status (aktif/askıda), created_at |
| **user_roles** | user_id, role (`carrier`/`shipper`/`admin`) |
| **companies** | id, owner_user_id, title, tax_no, tax_office, address, verified_at |
| **vehicles** | id, owner_user_id, plate (unique), vehicle_type (`tir`/`kamyon`/`kamyonet`/`panelvan`), body_type (`tenteli`/`acik`/`kapali`/`frigo`/`damper`/`kayar_perde`), capacity_ton, volume_m3, status |
| **documents** | id, owner_user_id, vehicle_id?, type (`ruhsat`/`k_belgesi`/`src`/`sigorta`/`vergi_levhasi`), file_key, status (`bekliyor`/`onay`/`ret`), reviewed_by, reject_reason, expires_at |
| **load_posts** | id, shipper_id, origin_loc_id, origin_geom (Point), dest_loc_id, dest_geom, load_from, load_to (tarih aralığı), cargo_type, weight_ton, req_vehicle_type, req_body_type, price_type (`sabit`/`teklif`), price, currency, note, **status** (`taslak`/`moderasyonda`/`teyitli`/`teyit_bekliyor`/`suresi_doldu`/`kapandi`/`iptal`), **last_confirmed_at**, next_reminder_at, created_at |
| **load_confirmations** | id, load_post_id, asked_at, answered_at, answer (`gecerli`/`arac_bulundu`/`iptal`/`cevapsiz`), channel (`push`/`sms`) |
| **capacity_posts** | id, carrier_id, vehicle_id, origin_geom, available_from, available_to, dest_geom? (null = her yer), route_polyline?, status |
| **route_alerts** | id, user_id, origin_district_id, origin_radius_km, dest_district_id? (null = her yer), dest_radius_km, vehicle_type?, active |
| **matches** | id, load_post_id, capacity_post_id, score, notified_at, outcome (`goruldu`/`arandi`/`teklif`/`yok`) |
| **offers** | id, load_post_id, carrier_id, vehicle_id, price, note, status (`beklemede`/`kabul`/`ret`/`geri_cekildi`) |
| **jobs** | id, load_post_id (unique), offer_id, shipper_id, carrier_id, vehicle_id, agreed_price, **status**, delivery_code_hash, delivered_at, completed_at, cancel_reason, cancelled_by |
| **job_events** | id, job_id, type, actor_id, created_at, meta (json) |
| **ratings** | id, job_id, rater_id, ratee_id, stars, tags[], comment, revealed_at (kör puanlama: dolana kadar gizli), created_at — unique(job_id, rater_id) |
| **reports** | id, reporter_id, target_type (`load_post`/`user`), target_id, reason, status, resolution |
| **call_logs** | id, caller_id, load_post_id, created_at — BR-40 için |
| **devices** | id, user_id, fcm_token, platform, last_seen |
| **otp_codes** | phone, code_hash, expires_at, attempts |

### Önemli indeksler
- `load_posts`: GIST(origin_geom), GIST(dest_geom), (status, load_from), (shipper_id)
- `capacity_posts`: GIST(origin_geom), (status, available_from)
- `route_alerts`: (user_id). Alarm araması yarıçapla (ilçe merkezine `ST_DWithin` mesafe) yapıldığı için ilçe kimliği indeksi işe yaramaz; aktif alarmlar taranır (MVP ölçeğinde yeterli).

---

## 4. Eşleştirme tasarımı (BR-20…23)

### Aday bulma (SQL taslağı)
```sql
SELECT c.id, c.carrier_id,
       ST_Distance(l.origin_geom::geography, c.origin_geom::geography)/1000 AS d_origin_km,
       CASE WHEN c.dest_geom IS NULL THEN 0
            ELSE ST_Distance(l.dest_geom::geography, c.dest_geom::geography)/1000 END AS d_dest_km
FROM load_posts l
JOIN capacity_posts c ON c.status = 'aktif'
JOIN vehicles v ON v.id = c.vehicle_id
WHERE l.id = $1
  AND v.vehicle_type = l.req_vehicle_type
  AND (l.req_body_type IS NULL OR v.body_type = l.req_body_type)
  AND v.capacity_ton >= l.weight_ton
  AND daterange(c.available_from - 1, c.available_to + 1) && daterange(l.load_from, l.load_to)
  AND ST_DWithin(l.origin_geom::geography, c.origin_geom::geography, 50000)
  AND (c.dest_geom IS NULL OR ST_DWithin(l.dest_geom::geography, c.dest_geom::geography, 80000));
```
Skor hesabı (BR-21) uygulama katmanında yapılır, ağırlıklar `price_params` benzeri bir parametre tablosundan okunur.

### Tetikleyiciler
| Olay | İş |
|---|---|
| Yük ilanı yayınlandı | `match.load` işi → aday araçlar + rota alarmı sahipleri → bildirim (BR-22 limitleriyle) |
| Boş araç ilanı yayınlandı | `match.capacity` işi → aday yükler → nakliyeciye bildirim |
| İş kabul edildi | `return.plan` işi (F4) → varış noktası çevresindeki yükler önbelleğe alınır |

### Rota üstü (MVP+, BR-23)
OSRM'den aracın rotası polyline olarak alınır ve `route_polyline` alanına kaydedilir. Bir yük aday sayılırsa şu şartlar aranır: `ST_DWithin(route, l.origin_geom, 30km)`, `ST_DWithin(route, l.dest_geom, 30km)` ve `ST_LineLocatePoint(route, origin) < ST_LineLocatePoint(route, dest)` (yön doğru).

### Özgün katkı
Kural tabanlı skorlama ile **atama problemi (Macar algoritması)** tabanlı küresel eşleştirme, sentetik veri üzerinde karşılaştırılabilir. Ölçütler: toplam boş km, eşleşme oranı, çalışma süresi.

---

## 5. Canlı ilan teyidi tasarımı (F1)

Teyit akışı:

1. Zamanlayıcı her 5 dakikada bir `load_posts WHERE status='teyitli' AND next_reminder_at <= now()` sorgusunu çalıştırır.
2. Bulunan ilanlar için bir `load_confirmations` satırı (`asked_at`) oluşturulur ve push gönderilir. Bildirimde [Evet] [Araç bulundu] [İptal] eylem butonları bulunur.
3. 30 dakika içinde cevap gelmezse yük sahibine SMS gider. SMS'teki kısa link web'de tek dokunuşla teyit sayfasını açar (giriş gerektirmeyen imzalı token ile).
4. Cevaba göre ilan durumu değişir:
   - Cevap "Evet" ise: `last_confirmed_at = now()` olur ve `next_reminder_at` yeniden hesaplanır.
   - 4 saat içinde cevap yoksa: ilan `teyit_bekliyor` olur.
   - Bundan sonra 12 saat daha cevap yoksa ya da yükleme tarihi geçtiyse: ilan `suresi_doldu` olur.

Listeleme sıralaması: `teyitli` ilanlar önce gelir. Kendi içlerinde `last_confirmed_at` azalan, sonra eşleşme skoru sırasıyla dizilir.

---

## 6. API taslağı (REST, `/api/v1`)

| Grup | Uç noktalar |
|---|---|
| Auth | `POST /auth/otp/request` · `POST /auth/otp/verify` · `POST /auth/refresh` · `POST /auth/logout` |
| Me | `GET/PATCH /me` · `POST /me/roles` · `DELETE /me` (KVKK) · `GET /me/export` |
| Company | `POST/PATCH /companies` |
| Vehicles | `GET/POST /vehicles` · `PATCH/DELETE /vehicles/:id` |
| Documents | `POST /documents/upload-url` · `POST /documents` · `GET /documents` |
| Loads | `GET /loads?from=&to=&date=&vtype=&near=lat,lng` · `GET /loads/:id` · `POST /loads` · `POST /loads/bulk` (Excel) · `PATCH /loads/:id` · `POST /loads/:id/confirm` · `POST /loads/:id/close` |
| Public | `GET /public/loads/:shareId` (WhatsApp paylaşım sayfası) · `GET /public/corridors/:slug` (F7) · `POST /public/confirm/:token` (SMS teyidi) |
| Capacity | `GET/POST /capacity` · `PATCH /capacity/:id` |
| Alerts | `GET/POST /alerts` · `PATCH/DELETE /alerts/:id` |
| Matches | `GET /matches` · `GET /return-plan/:jobId` (F4) |
| Offers | `POST /loads/:id/offers` · `GET /loads/:id/offers` · `POST /offers/:id/accept` · `POST /offers/:id/withdraw` |
| Jobs | `GET /jobs` · `GET /jobs/:id` · `POST /jobs/:id/status` · `POST /jobs/:id/deliver` (kod) · `POST /jobs/:id/cancel` |
| Ratings | `POST /jobs/:id/rating` · `GET /users/:id/reputation` |
| Reports | `POST /reports` |
| Calls | `POST /loads/:id/call` (numarayı döndürür ve loglar) |
| Price | `GET /price-estimate?from=&to=&ton=&vtype=` (F7) |
| Devices | `POST /devices` (FCM token) |
| Admin | `GET /admin/documents?status=bekliyor` · `POST /admin/documents/:id/review` · `GET /admin/reports` · `POST /admin/users/:id/suspend` · `GET /admin/metrics` · `GET/PATCH /admin/params` |

Sözleşme `packages/shared` içinde zod şemalarıyla tanımlanır. OpenAPI otomatik üretilir.

---

## 7. Fiyat aralığı formülü (F7, ilk sürüm)
```
maliyet = mesafe_km × (yakıt_l/100km × yakıt_₺/l) / 100
        + otoyol_köprü_₺(rota)
        + şoför_günlük × gün
        + amortisman_km × mesafe_km
tahmini_aralık = maliyet × [1,15 … 1,35]   (kâr marjı bandı, parametrik)
```
Parametreler (`price_params`) araç tipine göre tutulur ve yönetici panelinden güncellenir. Gerçek kapanan iş fiyatları biriktikçe (jobs.agreed_price) **regresyon modeli** eğitilir.

---

## 8. Güvenlik ve KVKK tasarımı
- OTP: 6 hane, 3 dk geçerli, kod başına 5 deneme; aynı amaçla 60 sn'de bir kod; numara başına 24 saatte en çok 10 kod (giriş ve silme kodu birlikte); IP başına saatte en çok 20 farklı numara (IPv6'da /64 ağı sayılır). Aşılınca 429 ve kalan süre ("… 3 saat 20 dakika sonra tekrar deneyin"). İstemci IP'si `X-Forwarded-For`'dan yalnız güvenilen vekil (`TRUST_PROXY`) aracılığıyla alınır; yayında web'in önünde gerçek adresi yazan ters vekil gerekir. Kaba kuvvet üst sınırı: numara başına günde 10 × 5 = 50 tahmin → 50 / 10⁶ = %0,005.
- Yönetici iki adımlı doğrulama (TOTP, RFC 6238: SHA-1, 6 hane, 30 sn; Google/Microsoft Authenticator): kurulumu tamamlamış yönetici SMS koduyla tek başına oturum alamaz (SMS → 5 dk geçerli challenge → uygulama kodu). Yönetici rolü belirtece yalnız ikinci adımı son 12 saatte geçmiş oturumda girer; kurulumsuz yöneticinin belirtecinde rol yoktur (yönetim bölümü kurulum ister). Anahtar AES-256-GCM ile şifreli (anahtar `TOTP_KEY`, yoksa `OTP_PEPPER`'dan HKDF; kullanıcı kimliğine bağlı). ±30 sn saat kayması kabul, kullanılmış adım yeniden geçmez; 10 tek kullanımlık kurtarma kodu (anahtarlı özet); ardışık 5 hatalı kodda 15 dk kilit; telefon değiştirme mevcut koddan sonra, etkinleşince diğer oturumlar kapanır; bekleyen kurulum 10 dk geçerli, 5 hatalı kodda atılır.
- Erişim belirteci (15 dk) onu basan oturuma bağlı (`sid`): yenileme belirteci olmadan yeni erişim belirteci veren uç (rol ekleme) oturum kapanmışsa reddeder; kapanan oturum kendini yenileyemez.
- Belgeler: özel bucket, 5 dk geçerli imzalı URL, sadece sahibi ve yönetici görür.
- Yönetici işlem kaydı (NFR-05): belge açma ve tüm yönetici kararları (belge, ilan, şikayet, itiraz, askı) `admin_audit_log`'a kararla aynı işlemde yazılır — yönetici, işlem, hedef, etkilenen kişi, gerekçe. Kişi kendi veri dökümünde hakkındakileri görür (yönetici kimliği olmadan); hesap silinince kayıt kalır, gerekçe metni silinir. Çıkar çatışması: yönetici kendi belgesine, ilanına, taraf olduğu şikayet ve itiraza karar veremez.
- Telefon numarası: listede maskeli (0532 *** ** 12), "Ara" ile açılır ve loglanır (BR-40).
- Teslim kodu veritabanında hash olarak saklanır.
- Rol tabanlı yetki: `carrier`, `shipper`, `admin` guard'ları.
- Konum: sadece istek anında kullanılır, kullanıcı konumu saklanmaz. İlanlarda yalnızca ilçe merkezi koordinatı tutulur.
- Hesap silme: kişisel alanlar anonimleştirilir; tamamlanmış işler istatistik için anonim olarak kalır.
- Yasal metinler: aydınlatma metni, açık rıza (pazarlama SMS'i ayrı), kullanım şartları. Platform "taşımaya taraf olmayan teknoloji sağlayıcı" olarak konumlanır (avukat görüşüne tabi).

## 9. Test stratejisi
- **Birim:** eşleştirme skoru, teyit durum makinesi, fiyat formülü, güven skoru.
- **Entegrasyon:** PostGIS sorguları (Testcontainers ile gerçek Postgres).
- **E2E:** Web için Playwright (ilan ver → teklif → kabul); Android için Maestro (giriş → yük ara → ara).
- **Simülasyon (`arastirma/simulasyon`):** sentetik ilan üreticisi ile eşleştirme ve dönüş planı karşılaştırmaları.
