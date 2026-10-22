# 03 — Sistem Analizi

> Tarih: 2026-10-06 · Platformlar: Android + Web · Kapsam: MVP
> Kod: **FR** = fonksiyonel gereksinim, **NFR** = fonksiyonel olmayan gereksinim, **BR** = iş kuralı, **UC** = kullanım senaryosu

---

## 1. Sistemin amacı ve sınırları
**Amaç:** Seçilen koridorda (Aydın–İzmir–Manisa–İstanbul) yük sahipleri ile nakliyecileri **gerçek, güncel ve doğrulanmış** ilanlar üzerinden eşleştirmek.

**Kapsam içi:** üyelik ve doğrulama, araç ve belge yönetimi, yük ilanı, boş araç ilanı, canlı ilan teyidi, kural tabanlı eşleştirme ve bildirim, teklif, iş takibi, teslim kodu, puanlama, şikayet, yönetici paneli, koridor fiyat aralığı (formül).

**Kapsam dışı (MVP):** ödeme ve emanet, canlı GPS takibi, iOS, WhatsApp kazıma, yapay zekâ ile eşleştirme, e-irsaliye ve e-fatura, uluslararası taşıma.

## 2. Aktörler
| Aktör | Açıklama | Platform |
|---|---|---|
| **Nakliyeci** | Bireysel şoför ya da araç sahibi; aynı zamanda küçük filo sahibi olabilir | Android (öncelikli), Web |
| **Yük sahibi** | Bireysel ya da KOBİ, fabrika lojistik sorumlusu | Web (öncelikli), Android |
| **Yönetici** | Platform ekibi | Web |
| **Sistem (zamanlayıcı)** | Teyit hatırlatma, ilan düşürme, eşleştirme işleri | Backend |
| *Dış sistemler* | SMS sağlayıcısı, FCM (bildirim), harita ve mesafe servisi | — |

Bir kullanıcı hem nakliyeci hem yük sahibi rolüne sahip olabilir (ör. komisyoncu veya filo sahibi).

---

## 3. Fonksiyonel gereksinimler

### 3.1 Hesap ve doğrulama
| Kod | Gereksinim | Öncelik |
|---|---|---|
| FR-01 | Kullanıcı telefon numarası ve SMS OTP ile kayıt olur ve giriş yapar. | MVP |
| FR-02 | Kullanıcı rol seçer: nakliyeci ve/veya yük sahibi. | MVP |
| FR-03 | Yük sahibi firma bilgisi (unvan, vergi no, adres) girer ya da bireysel olarak devam eder. | MVP |
| FR-04 | Nakliyeci araç ekler: plaka, araç tipi, kasa tipi, tonaj ve hacim. | MVP |
| FR-05 | Nakliyeci belge yükler: ruhsat, K belgesi, SRC, sigorta. Yönetici onaylar ya da reddeder. | MVP |
| FR-06 | Doğrulama seviyesi hesaplanır ve rozet olarak gösterilir (bkz. BR-10). | MVP |
| FR-07 | Kullanıcı hesabını silebilir ve verilerini indirebilir (KVKK). | MVP |
| FR-08 | Kullanıcı hesabını dondurabilir (ara vermek için): ilanları kapanır, bildirim almaz, verileri silinmez; SMS koduyla giriş hesabı açar. Süren taşıması varken dondurulamaz. (2026-10-13 eklendi) | MVP |

### 3.2 İlanlar
| Kod | Gereksinim | Öncelik |
|---|---|---|
| FR-10 | Yük sahibi yük ilanı oluşturur: kalkış ve varış (il, ilçe, konum), yükleme tarih aralığı, yük tipi, ağırlık, istenen araç ve kasa tipi, fiyat (sabit / teklif usulü), not. | MVP |
| FR-11 | Yük sahibi web panelinden **Excel ile toplu ilan** yükler. | MVP (web) |
| FR-12 | Nakliyeci **boş araç ilanı** verir: bulunduğu yer, tarih, gitmek istediği yön ya da "her yer". | MVP |
| FR-13 | **Canlı ilan teyidi (F1):** sistem yük sahibine periyodik olarak "Hâlâ geçerli mi?" sorar. Tek dokunuşla teyit edilir; teyit edilmeyen ilan önce soluklaşır, sonra yayından kalkar (BR-01…04). | MVP |
| FR-14 | İlan kartında "son teyit zamanı" gösterilir. | MVP |
| FR-15 | Yük sahibi ilanı kapatır ya da "araç bulundu" diye işaretler. | MVP |
| FR-16 | İlan WhatsApp ve diğer uygulamalara tek dokunuşla paylaşılır (F8). Paylaşılan link web'de ilan sayfası açar. | MVP |
| FR-17 | Kullanıcı ilanı şikayet eder: "yük yok / gitmiş", "telefon açılmıyor", "sahte". | MVP |

### 3.3 Arama, eşleştirme, bildirim
| Kod | Gereksinim | Öncelik |
|---|---|---|
| FR-20 | Nakliyeci yükleri nereden → nereye, tarih, araç ve kasa tipi, tonaj ile filtreler. | MVP |
| FR-21 | "Yakınımdakiler": kullanıcının izniyle bir kerelik konuma göre yarıçap araması. | MVP |
| FR-22 | **Rota alarmı:** nakliyeci güzergâh kaydeder, uyan yeni ilan çıkınca push bildirim alır. *(2026-10-08: güzergâh = kalkış ilçesi ± km → varış ilçesi ± km ya da her yer, isteğe bağlı araç tipi; varsayılan 50 / 80 km, 10–200 km; kullanıcı başına 10 aktif alarm. Yalnız teyitli ilan bildirilir; aynı yük için eşleşmeyle ortak tek bildirim ve BR-22 saatlik sınırı.)* | MVP |
| FR-23 | **Otomatik eşleştirme:** yeni yük ilanı uygun boş araç ilanlarıyla, yeni boş araç ilanı da uygun yüklerle eşleştirilir; iki taraf da bildirim alır (BR-20…23). | MVP |
| FR-24 | **Dönüş planı (F4):** nakliyecinin aktif işinin varış yeri ve tarihine göre dönüş ve rota üstü yük önerileri. | MVP+ (2. iterasyon) |
| FR-25 | **Koridor fiyat aralığı (F7):** mesafe, tonaj, araç tipi, yakıt ve otoyol parametreleriyle formüle dayalı tahmini aralık. | MVP+ |

### 3.4 Teklif ve iş akışı
| Kod | Gereksinim | Öncelik |
|---|---|---|
| FR-30 | Nakliyeci ilana teklif verir (fiyat, not, araç seçimi) ya da ilan sahibini arar. | MVP |
| FR-31 | Yük sahibi teklifleri karşılaştırır ve birini kabul eder; diğerleri bilgilendirilir. | MVP |
| FR-32 | Kabulle bir **İş (Taşıma)** kaydı oluşur; telefon numaraları bu aşamada karşılıklı tam görünür. | MVP |
| FR-33 | İş durumları: Anlaşıldı → Yüklendi → Yolda → Teslim edildi → Tamamlandı / İptal. | MVP |
| FR-34 | **Teslim kodu (F3):** yük sahibine (veya alıcıya) 6 haneli kod gider; nakliyeci teslimde kodu girer ve iş "Teslim edildi" olur. | MVP |
| FR-35 | Basit uygulama içi mesajlaşma (iş ve teklif bazlı). | MVP+ |

### 3.5 Güven ve puan
| Kod | Gereksinim | Öncelik |
|---|---|---|
| FR-40 | Sadece tamamlanmış işten sonra iki taraf birbirini 1–5 yıldız ve etiketlerle puanlar ("zamanında", "ödeme sorunsuz"…). | MVP |
| FR-41 | Profilde puan ortalaması, **tamamlanan iş sayısı**, iptal oranı ve üyelik süresi görünür. | MVP |
| FR-42 | Güven skoru hesaplanır (BR-30) ve sıralamada kullanılır. | MVP |

### 3.6 Yönetim
| Kod | Gereksinim | Öncelik |
|---|---|---|
| FR-50 | Belge onay kuyruğu. | MVP |
| FR-51 | Şikayet kuyruğu ve kullanıcı askıya alma. | MVP |
| FR-52 | Yeni hesapların ilk N ilanı moderasyondan geçer (BR-11). | MVP |
| FR-53 | Metrik paneli: aktif ilan, teyit oranı, eşleşme, kapanan yük (haftalık). | MVP |
| FR-54 | Parametre yönetimi: teyit aralığı, eşleştirme yarıçapları, fiyat formülü katsayıları. | MVP+ |

---

## 4. İş kuralları (BR)

### Canlı ilan teyidi (F1)
- **BR-01:** Yeni ilan "Teyitli" doğar. `son_teyit = oluşturma zamanı`.
- **BR-02:** Son teyitten **24 saat** sonra (yükleme gününde **6 saat** sonra) yük sahibine push ve SMS ile "Hâlâ geçerli mi? [Evet] [Araç bulundu] [İptal]" gönderilir. *(Süreler parametrik ve kullanımda ölçülecek.)*
- **BR-03:** Hatırlatmadan sonra **4 saat** içinde cevap gelmezse ilan **"Teyit bekliyor"** olur: listede alta iner, sarı rozet alır.
- **BR-04:** "Teyit bekliyor" durumunda **12 saat** daha geçerse ya da yükleme tarih aralığı biterse ilan **"Süresi doldu"** olur ve listeden kalkar.
- **BR-05:** Bir ilan için **2 farklı doğrulanmış kullanıcı** "yük yok / gitmiş" bildirirse ilan hemen "Teyit bekliyor" olur ve sahibine anlık teyit isteği gider.
- **BR-06:** Teyitsiz düşen ilan sayısı, yük sahibinin güven skorunu düşürür.

### Doğrulama
- **BR-10:** Doğrulama seviyeleri:
  - **Seviye 0:** sadece telefon doğrulanmış.
  - **Seviye 1:** kimlik ve firma bilgileri girilmiş (yük sahibinde vergi no, nakliyecide ruhsat onaylı).
  - **Seviye 2:** nakliyecide K belgesi + SRC onaylı; yük sahibinde 3+ tamamlanmış iş.
  - "✅ Doğrulanmış" rozeti Seviye 1 ve üstünde verilir.
- **BR-11:** Seviye 0 yük sahibinin ilk **3 ilanı** yayından önce moderasyondan geçer.
- **BR-12:** Aynı telefon numarası tek hesaba bağlanır. İlan sahibinin numarası, ilanı veren hesaptan başkası olamaz (sahte ilan ve numara kötüye kullanımına karşı).

### Eşleştirme
- **BR-20:** Bir yük ile bir boş araç ilanı aşağıdaki şartların tamamı sağlanırsa **aday** sayılır:
  - Araç tipi ve kasa tipi uyumlu
  - Kapasite (ton) ≥ yük ağırlığı
  - Tarih aralıkları kesişiyor (±1 gün tolerans)
  - Kalkış noktaları arası mesafe ≤ **50 km**
  - Varış: aracın hedef yönü "her yer" değilse varış noktaları arası ≤ **80 km**
- **BR-21:** Adaylar skorla sıralanır:
  `skor = 0,35·yakınlık_kalkış + 0,20·yakınlık_varış + 0,15·tarih_uyumu + 0,10·kapasite_doluluk + 0,20·güven_skoru` (ağırlıklar parametrik)
- **BR-22:** Bir kullanıcıya aynı ilan için en fazla 1 bildirim, saatte en fazla **5** eşleşme bildirimi gönderilir (bildirim yorgunluğuna karşı).
- **BR-23:** Rota üstü eşleşme (MVP+): yükün kalkış ve varışının aracın rotasından sapması ≤ **30 km** ise ve sıra doğruysa aday sayılır.

### Güven skoru
- **BR-30:** `güven = 0,4·puan_norm + 0,25·log(tamamlanan_iş+1)_norm + 0,15·doğrulama_seviyesi_norm − 0,15·iptal_oranı − 0,05·şikayet_oranı` Sonuç pozitif ağırlık toplamına (0,8) bölünür, böylece kusursuz kullanıcı 1 alır. Ardından 0–1 aralığına kırpılır. Yeni üye 0,25 ile başlar (hiç puanı yoksa puan bileşeni nötr 0,5 sayılır).
  - *(2026-10-08)* `puan_norm` Bayes ortalamasıyla yumuşatılır: puanlara 3 adet nötr (3 yıldız) sanal puan eklenir, `ort = (toplam + 9) / (adet + 3)`. Düz ortalamada tek puan az puanlı kullanıcıyı sert oynatıyordu (yeni üye tek 1 yıldızla 0,25 → 0,06). Profilde gösterilen ortalama düz ortalamadır.
  - *(2026-10-08)* `iptal_oranı` = kullanıcının **kendi** iptal ettiği iş / taraf olduğu tüm işler (karşı tarafın iptali mağdura yazılmaz). `şikayet_oranı` = haklı bulunan şikayet (kullanıcıya ya da ilanına) / (ilan + iş); şikayeti yönetici sonuçlandırana kadar (FR-51) bu bileşen 0'dır.
  - *(2026-10-08)* BR-06'nın formülde terimi yok; uygulanmadı, karar bekliyor.
- **BR-31:** Puan verilebilmesi için iş "Tamamlandı" olmalıdır, yani teslim kodu girilmiş olmalı ya da yük sahibi elle onaylamış olmalı.
  - *(2026-10-08)* Puan, tamamlanmadan sonraki **14 gün** içinde ve bir kez verilir (düzenlenemez). **Kör puanlama:** puan, iki taraf da puanlayınca ya da 14 gün dolunca görünür ve güven skoruna girer; o zamana kadar karşı taraf yalnız puanlandığını bilir (misillemeye karşı). Etiketler yöne göre: "ödeme sorunsuz" yalnız yük sahibine, "yüke özenli" yalnız nakliyeciye.
- **BR-32:** İş, teslimden sonra 48 saat içinde itiraz yoksa otomatik "Tamamlandı" olur.

### Gizlilik
- **BR-40:** Teklif kabul edilmeden önce telefon numarası kısmen maskeli gösterilir. "Ara" butonu numarayı açar ama bu arama loglanır ve kötüye kullanım için ölçülür. *(Not: tamamen gizlemek kullanıcıyı kaçırır, sektör telefonla çalışıyor. Bu yüzden maskeleme + loglama dengesi seçildi.)*

---

## 5. Kullanım senaryoları (Use Case)

| UC | Ad | Aktör | Ana akış (özet) |
|---|---|---|---|
| UC-01 | Kayıt ol / giriş yap | Herkes | Numara → OTP → rol seç → profil |
| UC-02 | Araç ve belge ekle | Nakliyeci | Plaka, tip, tonaj → fotoğraf çek → onaya gönder |
| UC-03 | Yük ilanı ver | Yük sahibi | Form (veya Excel) → önizle → yayınla → eşleşen nakliyecilere bildirim |
| UC-04 | İlanı teyit et | Yük sahibi | Bildirim → [Evet / Araç bulundu / İptal] |
| UC-05 | Yük ara | Nakliyeci | Rota ve filtre → liste → detay → Ara / Teklif ver |
| UC-06 | Rota alarmı kur | Nakliyeci | Nereden → Nereye + araç tipi → kaydet |
| UC-07 | Boş araç bildir | Nakliyeci | Konum, tarih, yön → yayınla → eşleşen yükler |
| UC-08 | Teklif ver | Nakliyeci | Fiyat + araç seç → gönder |
| UC-09 | Teklif kabul et | Yük sahibi | Karşılaştır → kabul → iş oluşur → numaralar açılır |
| UC-10 | Teslim et | Nakliyeci | Alıcıdan kodu al → gir → "Teslim edildi" |
| UC-11 | Puanla | İki taraf | Tamamlanmış iş → yıldız ve etiket |
| UC-12 | Dönüş planı gör | Nakliyeci | Aktif iş → öneri listesi → alarm kur |
| UC-13 | İlanı şikayet et | Herkes | Sebep seç → gönder → (BR-05) |
| UC-14 | Belge onayla | Yönetici | Kuyruk → görüntüle → onay / ret + sebep |
| UC-15 | Şikayet çöz | Yönetici | Kuyruk → incele → uyar / askıya al / kapat |
| UC-16 | Hesabı dondur / sil | Herkes | Hesap ve veriler → dondur (girişle açılır) ya da kodla sil |

### Örnek ayrıntılı senaryo — UC-04 İlanı teyit et
- **Ön koşul:** İlan "Teyitli" ve son teyitten 24 saat geçmiş.
- **Tetik:** Zamanlayıcı (BR-02).
- **Ana akış:**
  1. Sistem yük sahibine push bildirim, 30 dakika içinde açılmazsa SMS gönderir.
  2. Yük sahibi bildirimden [Evet, geçerli] seçer.
  3. Sistem `son_teyit` alanını günceller ve ilanı listede yukarı taşır.
- **Alternatif akışlar:**
  - 2a. [Araç bulundu] → ilan "Kapandı", teklif verenlere bilgi gider.
  - 2b. [İptal] → ilan "İptal".
  - 2c. Cevap yok → BR-03, ardından BR-04.
- **Son koşul:** İlan durumu güncel, kartta yeni "son teyit" zamanı.

---

## 6. Durum diyagramları

### Yük ilanı
```
            yayınla              24s / hatırlatma
[Taslak] ─────────► [Teyitli] ◄──────────────┐
   │ (Seviye0 ilk 3)    │  │ teyit "Evet"     │
   ▼                    │  └──────────────────┘
[Moderasyonda] ─onay───►│
                        │ 4s cevap yok / 2 şikayet
                        ▼
                 [Teyit bekliyor] ──"Evet"──► [Teyitli]
                        │ 12s / tarih bitti
                        ▼
                  [Süresi doldu]
[Teyitli] ── teklif kabul / "araç bulundu" ──► [Kapandı]
[Teyitli] ── iptal ──► [İptal]
```

### İş (taşıma)
```
[Anlaşıldı] → [Yüklendi] → [Yolda] → [Teslim edildi] → [Tamamlandı]
     │             │           │            │ 48s itiraz → [İtirazlı] → yönetici
     └──── iptal (sebep zorunlu, iptal oranına yazılır) ────► [İptal]
```

---

## 7. Fonksiyonel olmayan gereksinimler (NFR)
| Kod | Gereksinim |
|---|---|
| NFR-01 | **Performans:** yük listesi API'si p95 < 300 ms (10.000 aktif ilanda); eşleşme bildirimi ilan yayınından itibaren < 60 sn. |
| NFR-02 | **Android:** Android 8.0+ (API 26), APK < 25 MB, arka planda GPS yok, zayıf ağda son liste önbellekten. |
| NFR-03 | **Web:** son iki sürüm Chrome, Edge ve Firefox; panel masaüstü öncelikli ama mobilde de çalışır; landing sayfası SEO uyumlu. |
| NFR-04 | **Güvenlik:** HTTPS; OTP denemelerine hız sınırı; JWT erişim ve yenileme belirteçleri; belgeler özel depolamada, imzalı URL ile açılır; yönetici için 2FA. |
| NFR-05 | **KVKK:** aydınlatma metni ve açık rıza; konum ve belge verisi için amaç sınırlaması; hesap silmede veri imhası ya da anonimleştirme; erişim logları. |
| NFR-06 | **Erişilebilirlik:** dokunma alanı ≥ 48 dp, WCAG AA kontrast. |
| NFR-07 | **Kullanılabilirlik:** ilk ilanı vermek < 90 sn; yük aramaktan aramaya < 3 dokunuş. |
| NFR-08 | **Güvenilirlik:** zamanlayıcı işleri idempotent, tekrar çalıştırılabilir; günlük veritabanı yedeği. |
| NFR-09 | **Gözlemlenebilirlik:** API hata oranı, bildirim teslim oranı ve teyit cevap oranı izlenir. |
| NFR-10 | **Dil:** Türkçe arayüz; metinler i18n dosyasında. |

---

## 8. Ölçülecek başarı metrikleri
| Metrik | Tanım | İlgili özellik |
|---|---|---|
| **Haftalık kapanan yük** | "Tamamlandı" durumuna geçen iş sayısı | Ana başarı ölçütü |
| İlan tazeliği | Listede gösterilen ilanların % kaçı son 24 saatte teyitli | F1 |
| Bayat ilan şikayet oranı | "yük yok" şikayeti / gösterilen ilan | F1, F2 |
| Teyit cevap oranı ve süresi | Hatırlatmaya cevap verenlerin oranı ve medyan cevap süresi | F1 |
| Eşleşme isabeti | Bildirilen eşleşmelerden teklif ya da aramaya dönüşen oran | BR-20/21 |
| Boş km azalması (simülasyon) | Dönüş planı ile ve onsuz senaryo karşılaştırması (sonuç: `arastirma/simulasyon/README.md` §7, Deney 2) | F4 |
