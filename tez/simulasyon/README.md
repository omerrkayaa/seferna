# Tez simülasyonları

Bu klasör, tezin Faz 6 deneylerinin simülasyon kodunu, testlerini ve sonuçlarını içerir.

- **Deney 1:** Kural tabanlı eşleştirme (sistemin kendisi) ile Macar algoritması tabanlı küresel eşleştirmenin karşılaştırılması (docs/04 §4 "Tez katkısı").
- **Deney 3:** Canlı ilan teyidinin (F1, BR-01…05) ilan tazeliğine etkisi ve teyit sürelerinin duyarlılık analizi.
- **Deney 2:** Dönüş planının (F4: dönüş yükleri + rota üstü ara yükler) boş km'ye etkisi (§7).

Bütün veriler **sentetiktir**. Sonuçlar yöntemlerin ve kuralların davranışını karşılaştırmak içindir; platformun gerçek eşleşme oranını ya da gerçek ilan tazeliğini ölçmez. Saha (pilot) verisi gelince aynı ölçütler gerçek veriyle hesaplanmalıdır.

---

## 1. Çalıştırma

Kökten (`C:\Users\omerk\Desktop\nakliye`). PowerShell'de `npx` yerine `npx.cmd` yazın.

```bash
# Testler (Node'un kendi test koşucusu; 32 test, ~3 sn)
npx tsx --test tez/simulasyon/test/*.test.ts

# Bütün deneyler (30 tohum; bu makinede ~7 dk: Deney 1 ~170 sn, Deney 2 ~190 sn, Deney 3 ~10 sn)
npx tsx tez/simulasyon/calistir.ts

# Seçenekler
npx tsx tez/simulasyon/calistir.ts --deney=1      # ya da --deney=2, --deney=3
npx tsx tez/simulasyon/calistir.ts --tohum=5      # hızlı deneme → sonuclar/deneme-5/
npx tsx tez/simulasyon/calistir.ts --haversine    # OSRM'i hiç deneme (Deney 2'de rota: doğru çizgi) → sonuclar/deneme-30-haversine/

# Tip denetimi
npx tsc -p tez/simulasyon/tsconfig.json
```

Bağımlılık eklenmedi; kökteki `node_modules` kullanılır (`tsx`, `typescript`, `@nakliye/shared` workspace bağlantısı). `@nakliye/shared` derlenmiş `dist`'ten okunur: shared değişirse önce `npm run build -w @nakliye/shared`. `tez/simulasyon/package.json` yalnız `"type": "module"` bildirimidir (workspace değildir).

**Mesafe kaynağı:** `veri/osrm-ilce-matrisi.bin` varsa o kullanılır. Yoksa ve `http://localhost:5000` (ya da `OSRM_URL`) üzerinde OSRM çalışıyorsa 973 × 973 ilçe matrisi bir kez alınıp oraya yazılır (~25 sn, 400 GET isteği, yalnız okuma). İkisi de yoksa kuş uçuşu × 1,3'e düşülür ve bu, sonuç dosyalarına yazılır. **Bu çalıştırmada OSRM kullanıldı** (rota bulunamayan çift: 0).

**Dönüş yolu geometrisi (Deney 2, rota üstü):** `veri/osrm-rotalar.json.gz` (ilçe çifti → kodlanmış çoklu çizgi, Google polyline 1e-5; 11 120 çift, 0,9 MB). Eksik çiftler OSRM çalışıyorsa `route` servisinden alınır (API'deki dönüş planıyla aynı istek: `overview=simplified&geometries=geojson`; 30 tohumda ~10 000 çift, ~30 sn, yalnız okuma). OSRM yoksa eksik çift kuş uçuşu doğru çizgiye düşer (API'deki yedekle aynı) ve sayısı raporlanır. **Bu çalıştırmada bütün rotalar OSRM'den** (doğru çizgiye düşülen: 0).

Çıktılar `sonuclar/` altındadır:

| Dosya | İçerik |
|---|---|
| `deney1.md`, `deney2.md`, `deney3.md` | Tezde kullanılabilecek tablolar (virgül ondalık) |
| `deney1_ham.csv`, `deney2_ham.csv`, `deney3_ham.csv` | Her tohum × yapılandırma × yöntem için ham ölçüler (nokta ondalık) |
| `deney1_ozet.csv`, `deney2_ozet.csv`, `deney3_ozet.csv` | n, ortalama, standart sapma, %95 GA |
| `deney1_farklar.csv`, `deney2_farklar.csv`, `deney3_farklar.csv` | Eşleştirilmiş farklar: GA, t, p, Wilcoxon W ve p, Holm düzeltmeli p |
| `calisma_bilgisi.json`, `calisma_bilgisi_deney2.json` | Tarih, Node sürümü, tohum, mesafe ve rota kaynağı, süreler (Deney 2 ayrı çalıştırıldı: `--deney=2`) |

Tüm sayılar `KOK_TOHUM` (parametreler.ts) ile belirlenir; aynı makinede aynı komut aynı sonuçları verir (süre ölçümleri hariç).

### Dosya yapısı

```
tez/simulasyon/
├─ calistir.ts          tek giriş noktası
├─ parametreler.ts      TÜM varsayımlar ([T]) — tek dosya
├─ deney1.ts            Deney 1 + rapor
├─ deney2.ts            Deney 2 + rapor
├─ deney3.ts            Deney 3 + rapor
├─ lib/
│  ├─ prng.ts           mulberry32 + tohum karıştırma + dağılımlar
│  ├─ konum.ts          il/ilçe koordinatları (apps/api/src/db/seed/locations.json, yalnız okunur)
│  ├─ uretici.ts        sentetik yük ve boş araç ilanları (Deney 1 ve 2)
│  ├─ mesafe.ts         OSRM matrisi / haversine × 1,3 (boş km; Deney 1 ve 2)
│  ├─ rota.ts           Deney 2 dönüş yolu geometrisi: OSRM route önbelleği / doğru çizgi
│  ├─ donus.ts          Deney 2 örnek, adaylar (shared F4 kuralları), yöntemler A–C-Macar, ölçütler
│  ├─ eslestirme.ts     aday matrisi (shared) + yöntemler (a)–(e)
│  ├─ macar.ts          Macar algoritması (Kuhn–Munkres, potansiyelli kısa yol, O(r²c))
│  ├─ akis.ts           tam k eşleşmeli en az maliyetli atama (ardışık en kısa yollar)
│  ├─ teyit-sim.ts      Deney 3 ayrık olay simülasyonu
│  ├─ istatistik.ts     t, eşleştirilmiş t, Wilcoxon, Holm
│  └─ tablo.ts          CSV / Markdown
├─ test/                32 test (aşağıda)
├─ veri/                OSRM matris ve rota önbellekleri (OSM türevi, ODbL)
└─ sonuclar/            çıktılar
```

---

## 2. Sistemle bağ: kurallar kopyalanmadı

Simülasyon sistemin kurallarını `@nakliye/shared`'dan içe aktarır; kendi kopyasını yazmaz:

| Kural | shared | Nerede |
|---|---|---|
| BR-20 uygunluk + BR-21 skoru + araç büyüklüğü kuralı (`vehicleCanCarry`) | `matchLoadWithCapacity`, `DEFAULT_MATCH_PARAMS` | `lib/eslestirme.ts` |
| BR-30 güven skoru (sentetik araç sahipleri için) | `trustScore` | `lib/uretici.ts` |
| Yük/boş araç şemaları ve tarih sınırları | `createLoadSchema`, `createCapacitySchema`, `createVehicleSchema`, `loadDateError`, `dateRangeError` | `test/uretici.test.ts` |
| BR-02 soru zamanı (yükleme günü 6 saat dahil) | `nextReminderAt` | `lib/teyit-sim.ts` |
| BR-03/04 durum düşürme | `evaluateLoadStatus` | `lib/teyit-sim.ts` |
| Cevabın duruma çevrilmesi | `applyConfirmationAnswer` | `lib/teyit-sim.ts` |
| SMS yedeği (30 dk) | `shouldSendSmsFallback` | `lib/teyit-sim.ts` |
| BR-05 eşiği | `shouldForceReconfirm` | `lib/teyit-sim.ts` |
| TR günü başı/sonu | `trDayStart`, `trDayEnd`, `trDay` | `lib/teyit-sim.ts` |
| F4 tahmini varış ve dönüş penceresi | `estimatedArrivalDay`, `returnWindow`, `RETURN_PLAN_PARAMS` | `lib/donus.ts` |
| F4 dönüş yükü: sanal boş araç ilanı + BR-20 | `returnCapacity`, `matchLoadWithCapacity` | `lib/donus.ts` |
| F4 rota üstü (BR-23) ve konumdan bağımsız uyum | `onRouteMatch` (`projectOnPolyline`), `fitRejectReason` | `lib/donus.ts` |

Teyit fonksiyonları zaten bir `ConfirmationParams` parametresi aldığı için parametreli bir kopya **gerekmedi**: Deney 3'ün duyarlılık analizi shared fonksiyonlarını farklı parametrelerle çağırır. Varsayılan yapılandırma `DEFAULT_CONFIRMATION_PARAMS`'ın kendisidir; testler bunu ve el ile hesaplanmış geçiş zamanlarını sınar.

Zamanlayıcının davranışı `apps/api/src/loads/confirmation.service.ts`'ten alınmıştır: tur 5 dakikada bir; turda sıra durum düşürme → yeni sorular → SMS yedeği; BR-05'te `reminderSentAt = şimdi − 4 saat` ve açık soru yoksa yeni soru.

---

## 3. Sentetik veri ve mesafe

### 3.1 Üretici

Tohumlu, deterministik (mulberry32; alt akışlar `tohumBirlestir` ile türetilir). Yükler ve araçlar ayrı akışlardan üretilir: aynı tohumda araç sayısı değişince yükler değişmez, araçlar iç içedir (oran 1'in araçları oran 2'nin ilk yarısı). Bu, araç/yük oranları arasında karşılaştırmayı daha az gürültülü yapar.

- **Coğrafya:** il, ağırlıkla seçilir; ilçe il içinde düzgün. Koridor (Aydın, İzmir, Manisa, İstanbul) 20, büyük merkezler (Ankara, Bursa, Kocaeli, Konya, Mersin) 5 il × 6, diğer 72 il 0,5 → kalkışların ≈ %55'i koridorda, %21'i merkezlerde, %25'i diğer illerde **[T]**. Konum = ilçe merkezi (OSM).
- **Yük:** istenen araç tipi (karışım [T]) → kalkış ilçesi → varış (tipe göre "il içi" olasılığı [T], ör. panelvan %60, tır %5) → yükleme başlangıcı (referans günden 0–7 gün [T]) ve aralık (0–3 gün [T]) → yük cinsi ve istenen kasa (yük cinsine göre [T]; istenen kasa, istenen tipin kasa dağılımında yoksa yük cinsi yeniden çekilir) → ağırlık = U(0,2; 1,0) × istenen tipin kapasite üst sınırı [T].
- **Boş araç:** araç tipi (karışım [T]) → kasa (tipe göre [T]) → kapasite (tipe göre düzgün aralık [T]) → bulunduğu ilçe → hedef: %35 "her yer", değilse ağırlıklı rastgele ilçe [T] → müsaitlik başlangıcı (0–5 gün [T]) ve aralığı (0–3 gün [T]) → sahibinin güven skoru (shared `trustScore`; girdileri [T], %20 yeni üye = 0,25).
- Üretilen her ilan shared zod şemalarından ve tarih kurallarından geçer (testle doğrulanır).

Tüm sayısal varsayımlar `parametreler.ts`'tedir; tam liste §8'de.

### 3.2 Mesafe

- **Boş km için karayolu:** yerel OSRM (`osrm-routed`, Türkiye Geofabrik verisi, `infra/osrm.md`) `table` servisinden 973 × 973 ilçe merkezi matrisi; varsayılan tablo sınırı 100 koordinat olduğundan 50 kaynak + 50 hedeflik 400 parça. Yönlüdür (A→B ≠ B→A olabilir). 100 m'ye yuvarlanıp `veri/osrm-ilce-matrisi.bin`'e (Uint16, 1,9 MB) yazılır.
- **Doğrulama:** Nazilli → Esenyurt 633,0 km (API'nin OSRM'li fiyat tahminindeki 633 km ile aynı). 20 km'den uzak ~20 000 rastgele ilçe çiftinde yol / kuş uçuşu oranı: medyan 1,34, ortalama 1,38, %5'lik 1,19, %95'lik 1,72. OSRM yokken kullanılan 1,3 katsayısı medyana yakın ama uzun kuyruğu (dağlık, kıyı, körfez geçişleri) yakalamaz.
- **Uygunluk mesafesi değişmedi:** BR-20 yarıçapları (kalkış ≤ 50 km, varış ≤ 80 km) sistemdeki gibi shared `matchLoadWithCapacity`'nin kuş uçuşu (haversine) ölçüsüyle verilir. Karayolu yalnız boş km ölçüsüdür.
- **Lisans:** matris OpenStreetMap verisinden türetilmiştir (© OpenStreetMap katkıcıları, ODbL). Tezde kaynak gösterilmeli.

---

## 4. Deney 1 — kural tabanlı ve Macar algoritması eşleştirmesi

### 4.1 Yöntem

Her örnek, belli bir anda yayında olan *n* yük ve *m* boş araç ilanının anlık görüntüsüdür. Uygunluk ve skor **bütün yöntemlerde aynıdır**: her yük–araç çifti için shared `matchLoadWithCapacity` (BR-20 + araç büyüklüğü kuralı + BR-21 skoru, güven = araç sahibinin skoru). Yöntemler yalnız uygun çiftler arasından kimin kime atanacağını seçer; her araç en fazla bir yük alır.

| Kod | Yöntem | Amaç |
|---|---|---|
| (a) | **Kural tabanlı (sistem).** Yükler ilan sırasıyla gelir; her yük, henüz kimseye verilmemiş uygun araçlar arasından BR-21 skoru en yüksek olana atanır (eşitlikte küçük araç kimliği). | Varsayım: bildirim en iyi skorlu adaya gider ve o aday yükü alır. Kabul oranı, gecikme, pazarlık, BR-22 bildirim sınırı modellenmez. |
| (b) | **Macar, boş km en az.** Küresel atama. | Önce eşleşme sayısı en çok, sonra toplam boş km en az. |
| (c) | **Macar, skor en çok.** | Önce eşleşme sayısı en çok, sonra BR-21 skor toplamı en çok (maliyet = 1 − skor). |
| (d) | *Karşılaştırma ölçütü:* (a)'nın eşleştirdiği **aynı yüklere**, hepsi eşleşecek biçimde, boş km'si en az araç ataması (alt matriste Macar). | (b)−(a) farkı "daha çok yük eşleşti" etkisiyle karışır; (d)−(a) yalnız "aynı yüke hangi araç" kararının kazancıdır. |
| (e) | *Karşılaştırma ölçütü:* (a) ile **aynı sayıda** eşleşme, hangi yüklerin eşleşeceği serbest, boş km en az (en az maliyetli akış). | Aynı hizmet düzeyinde ulaşılabilecek alt sınır. |

**Boş km** = aracın bulunduğu ilçeden yükün kalkışına karayolu km + (araç belli bir yöne gidiyorsa) yükün varışından aracın hedefine karayolu km; "her yer"de ikinci terim 0. Yüklü km dahil değildir (her yöntemde aynı yük için aynıdır).

**Macar algoritması** (`lib/macar.ts`) yeni paket eklemeden yazıldı: potansiyelli kısa yol artırmalı Kuhn–Munkres (Jonker–Volgenant tarzı), O(r²·c), r ≤ c (gerekirse matris devrilir). Uygunsuz çift = ∞. Dengesiz matris, her satıra ortak *r* sahte "eşleşmeme" sütunuyla (maliyet M) kareye yaklaştırılır. M > r · (en büyük maliyet) seçildiği için bir eşleşme fazlası her zaman maliyet farkından ağır basar: sonuç sözlüksel olarak (en çok eşleşme, sonra en az maliyet) optimumdur. **Tam k eşleşme** (`lib/akis.ts`): kaynak → yükler → uygun araçlar → hedef ağında Dijkstra + Johnson potansiyelleriyle ardışık en kısa yollar; k adım sonunda akış, k birimlik akışlar arasında en ucuzudur.

**Tasarım:** yük sayısı n ∈ {25, 50, 100, 200, 400, 800}, araç/yük oranı ∈ {0,5; 1; 2}, her yapılandırmada 30 tohum (18 × 30 = 540 örnek, her örnekte 5 yöntem). Yöntemler aynı örnek üzerinde çalıştığından karşılaştırmalar **eşleştirilmiştir**: tohum başına fark, farkın ortalaması ve %95 GA'sı (t), eşleştirilmiş t testi ve Wilcoxon işaretli sıralar testi (normal yaklaşım, bağ ve süreklilik düzeltmeli). Deney 1'deki 432 testin (18 yapılandırma × 6 karşılaştırma × 4 ölçüt) tamamına Holm düzeltmesi uygulandı. Süre: tek iş parçacığı, `performance.now()`, ısınma turundan sonra.

### 4.2 Sonuçlar (özet; tamamı `sonuclar/deney1.md`)

Örnek yoğunluğu ve ulaşılabilecek en çok eşleşme (uygunluk kısıtı altında; (b) = (c)):

| Yük | Araç/yük | Yük başına uygun araç | En çok eşleşme oranı, % |
|---:|---:|---:|---:|
| 25 | 1 | 0,15 | 10,0 |
| 100 | 1 | 0,67 | 23,2 |
| 400 | 0,5 / 1 / 2 | 1,23 / 2,49 / 5,06 | 21,2 / 39,0 / 57,7 |
| 800 | 0,5 / 1 / 2 | 2,56 / 5,03 / 10,14 | 25,7 / 47,3 / 66,8 |

Ana ölçütler (30 tohum ortalaması [%95 GA]; n = 400 ve 800):

| Yük | Araç/yük | Yöntem | Eşleşme oranı, % | Eşleşme başına boş km | Toplam boş km | Ort. skor |
|---:|---:|:---|---:|---:|---:|---:|
| 400 | 1 | (a) kural | 34,1 [33,5; 34,8] | 54,6 [53,2; 56,0] | 7447 [7256; 7638] | 0,590 |
| 400 | 1 | (b) Macar km | 39,0 [38,1; 39,9] | 54,8 [53,2; 56,5] | 8570 [8216; 8924] | 0,581 |
| 400 | 1 | (c) Macar skor | 39,0 [38,1; 39,9] | 58,5 [57,0; 60,0] | 9144 [8808; 9480] | 0,593 |
| 400 | 1 | (d) aynı yükler | 34,1 | 46,7 [45,4; 48,0] | 6362 [6190; 6533] | 0,588 |
| 400 | 1 | (e) aynı sayı | 34,1 | 37,4 [36,2; 38,6] | 5098 [4941; 5254] | 0,616 |
| 800 | 1 | (a) kural | 41,0 [40,5; 41,5] | 53,7 [52,8; 54,6] | 17620 [17260; 17980] | 0,604 |
| 800 | 1 | (b) Macar km | 47,3 [46,7; 47,9] | 54,6 [53,6; 55,6] | 20685 [20179; 21191] | 0,593 |
| 800 | 1 | (d) aynı yükler | 41,0 | 43,5 [42,6; 44,4] | 14292 [13961; 14623] | 0,607 |
| 800 | 1 | (e) aynı sayı | 41,0 | 34,6 [33,7; 35,4] | 11356 [11041; 11671] | 0,637 |
| 800 | 2 | (a) kural | 60,4 [59,8; 61,0] | 41,3 [40,5; 42,2] | 19955 [19535; 20374] | 0,643 |
| 800 | 2 | (b) Macar km | 66,8 [66,2; 67,5] | 36,5 [35,4; 37,6] | 19515 [18882; 20148] | 0,619 |
| 800 | 2 | (d) aynı yükler | 60,4 | 29,8 [29,1; 30,6] | 14421 [14064; 14777] | 0,635 |

Kural tabanlıya göre göreli toplam boş km farkı (tohum başına (x − a)/a, ortalama [%95 GA]):

| Yük | Araç/yük | (d) aynı yükler, % | (e) aynı sayı, % | (b) Macar km, % (daha çok eşleşmeyle) |
|---:|---:|---:|---:|---:|
| 100 | 1 | −7,2 [−9,6; −4,9] | −24,6 [−28,6; −20,6] | −2,0 [−7,4; 3,4] |
| 200 | 1 | −9,9 [−11,4; −8,5] | −26,7 [−28,6; −24,8] | +10,1 [5,6; 14,6] |
| 400 | 1 | −14,5 [−15,7; −13,4] | −31,5 [−32,8; −30,3] | +15,2 [11,0; 19,3] |
| 800 | 0,5 | −10,7 [−11,7; −9,7] | −34,9 [−36,2; −33,6] | −11,0 [−13,6; −8,4] |
| 800 | 1 | −18,9 [−19,6; −18,2] | −35,6 [−36,5; −34,7] | +17,5 [15,0; 20,0] |
| 800 | 2 | −27,7 [−28,5; −27,0] | −39,7 [−40,8; −38,7] | −2,3 [−4,2; −0,3] |

Eşleşme oranı farkı (b)−(a), yüzde puanı: n = 100'de +0,6 / +1,6 / +2,8; n = 400'de +1,5 / +4,9 / +5,9; n = 800'de +1,9 / +6,3 / +6,4 (oran 0,5 / 1 / 2). n ≥ 100'de eşleştirilmiş t testi Holm düzeltmesinden sonra hepsinde anlamlı (n = 100, oran 0,5 dışında p < 0,001; o hücrede p_t = 0,020, Wilcoxon p = 0,127); n ≤ 50'de farklar küçük ve çoğu anlamlı değil.

Çalışma süresi (ms, bu makinede, ortalama):

| Yük | Araç/yük | Aday matrisi (ortak) | (a) | (b) | (c) | (d) | (e) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 1 | 5,1 | 0,03 | 3,6 | 3,7 | 0,1 | 0,5 |
| 400 | 1 | 73,8 | 0,34 | 134,7 | 133,0 | 2,1 | 15,4 |
| 800 | 1 | 297,2 | 1,31 | 900,9 | 894,2 | 15,0 | 99,5 |
| 800 | 2 | 609,9 | 2,81 | 505,1 | 485,2 | 33,7 | 259,2 |

### 4.3 Yorum

1. **Eşleşme sayısı:** Küresel atama, aynı uygunluk kuralıyla kural tabanlı yöntemden daha çok yükü eşleştirir. Fark pazar yoğunlaştıkça büyür (yük başına ~0,15 uygun araçtan ~5 uygun araca çıkınca 0,1 puandan ~6 puana). Seyrek pazarda (n ≤ 50) çakışan aday az olduğu için yöntemler hemen hemen aynı sonucu verir.
2. **Boş km — dikkatli okunmalı:** (b)'nin toplam boş km'si (a)'dan bazen düşük bazen yüksektir, çünkü (b) fazladan eşleştirdiği "zor" yüklerin boş km'sini de taşır. Bu yüzden saf atama verimi (d) ve (e) ile ölçüldü: **aynı yüklere daha iyi araç seçmek** toplam boş km'yi n ≥ 100'de pazar yoğunluğuna göre %4,5 (n = 100, oran 0,5) ile %27,7 (n = 800, oran 2) arasında azaltır; seyrek küçük örneklerde (n ≤ 50) kazanç %0–8'dir. Yükleri de serbestçe seçmek (e) n ≥ 100'de %20–40'a çıkar; ama (e) "hangi yük taşınsın" kararını da veren merkezi bir planlayıcı varsayar ve bir ilan platformunun gerçekte yapabileceğinin üst sınırıdır.
3. **Skor ile boş km ödünleşimi:** (c) skor toplamını en çoklar; boş km'si (b)'ninkinden her yapılandırmada fazladır (eşleşme başına 0,7–7,3 km). BR-21 skoru boş km'yi yalnız dolaylı izler: kalkış yakınlığı kuş uçuşudur, "her yer" araçta varış terimi nötrdür ve skorun %35'i (tarih, doluluk, güven) mesafeyle ilgisizdir. (b) ise ortalama skorda (c)'ye göre 0,001–0,023 kaybeder; güven ve doluluk terimleri yöntem seçiminde gözden çıkarılan değerlerdir.
4. **Süre:** Yoğun matrisli O(n³) Macar, 800 × 800'de ~0,9 sn sürer; kural tabanlı ~1 ms. Uygunluk/skor matrisinin kendisi (shared, 640 000 çift) 0,3 sn. Aday grafı seyrek (çiftlerin %1'inden azı uygun) olduğu için seyrek bir algoritma çok daha hızlı olurdu: aynı ağ üzerinde ardışık en kısa yollar (e), 800 × 800'de 0,1 sn. Ancak (e) en büyük eşleşmeye kadar değil (a)'nın eşleşme sayısına kadar çalıştığı için süreleri doğrudan karşılaştırılamaz. Ürün açısından: anlık bildirim için kural tabanlı yeterince hızlı; küresel atama dakikalık toplu bir iş olarak (ör. zamanlayıcı turunda) çalıştırılabilir.
5. **Sınırlılıklar (Deney 1'e özgü):**
   - Anlık görüntü (statik) problem: gerçekte ilanlar zaman içinde gelir; küresel atama ancak belli aralıklarla toplu çalıştırılırsa uygulanabilir ve bekleme gecikmesi doğurur. Bu ödünleşim ölçülmedi.
   - "En iyi adaya bildirim gider, o alır" varsayımı kural tabanlı yöntemi idealleştirir; nakliyecilerin kendi aramaları, ret/geç cevap ve BR-22 bildirim sınırı yok.
   - Macar sonucu bir *öneridir*; taraflar kabul etmek zorunda değildir. Kabul davranışı modellenmedi.
   - Konum ilçe merkezidir (aynı ilçe içi boş km = 0), parsiyel/çok duraklı taşıma yok, araç başına tek yük.
   - Eşleşme oranlarının mutlak düzeyi (%5–67) sentetik coğrafyaya ve BR-20 yarıçaplarına bağlıdır; platformun gerçek oranı değildir. Yöntemler arası **farklar** yorumlanmalıdır.

---

## 5. Deney 3 — canlı ilan teyidinin ilan tazeliğine etkisi

### 5.1 Yöntem

Ayrık olay simülasyonu, ilan başına (ilanlar birbirinden bağımsız; BR-05'teki şikayetler de ilana özeldir). 14 gün boyunca günde 100 ilan gelir (tohum başına 1400 ilan); her ilan yayından kalkana kadar izlenir (pencere sonunda kesilmez). Zaman milisaniye çözünürlüklü; zamanlayıcı turları 5 dakikanın katlarında.

- **Yük:** ilan saati mesai ağırlıklı [T]; yükleme başlangıcı ilan gününden 0–7 gün sonra, aralık 0–3 gün [T]. Yükün gerçekte "gittiği" (araç bulduğu ya da vazgeçildiği) an = ilan anı + log-normal (medyan 18 sa, σ = 1) [T]. Bu andan sonra ilan **bayattır**. Yükleme aralığı biterse ilan her senaryoda düşer.
- **Yük sahibi:** her teyit sorusuna bağımsız olarak **p** olasılıkla cevap verir; gecikme log-normal (medyan 30 dk, σ = 1,2) [T]. 23:00–07:00 arasına düşen eylem 07:00 + U(0, 90 dk)'ya kayar [T]. Cevap anında yük gitmişse ilanı kapatır ("araç bulundu"), gitmemişse "hâlâ geçerli" der. Ayrıca yük gittikten sonra **q** olasılıkla, log-normal (medyan 2 sa) gecikmeyle sorulmadan kapatır [T]. "Cevap verdi" = push'u açtı ya da SMS linkine tıkladı; push açılmayan soru 30 dakikada SMS'e düşer (SMS sayısı ayrıca sayılır).
- **Senaryo A — teyit yok:** ilan, sahibi kapatana ya da yükleme aralığı bitene kadar listede.
- **Senaryo B — sistem:** BR-02…04 shared fonksiyonlarıyla (varsayılan 24 sa / yükleme günü 6 sa / 4 sa / 12 sa).
- **B + BR-05:** görünür ilana "yük yok" şikayetleri Poisson süreciyle gelir: bayat ilana saatte 0,03, geçerli ilana saatte 0,002 (yersiz) [T]; her şikayet farklı, sayılan bir kullanıcıdan. "Yoğun" varyantta ikisi de 10 katı.
- **Ortak rastgele sayılar:** aynı tohumda bütün senaryolar aynı ilanları, aynı "gitme" anlarını ve sahibin k'ıncı soruya aynı eğilimini kullanır; farklar eşleştirilmiş olarak test edilir (Deney 3'teki 77 test üzerinde Holm).

**Ölçütler:**

| Ölçüt | Tanım |
|---|---|
| Bayat ilan-saat payı | Listede görünen (teyitli + teyit bekliyor) ilan-saatlerinin, yük gittikten sonraki payı |
| İlan başına bayat saat | Toplam bayat görünme süresi / ilan sayısı |
| İlan tazeliği (docs/03 §8) | Görünen ilan-saatlerinin son teyidi 24 saat içinde olan payı (anlık ölçümlerin zaman ortalaması) |
| Yanlışlıkla düşen geçerli ilan | Cevapsızlıktan (BR-04) "süresi doldu" olan ve o anda yükü hâlâ geçerli olan ilanların oranı |
| Kaybedilen geçerli saat | Yanlış düşen ilanın, düşmeseydi geçerli olarak listede kalacağı süre (ilan başına) |
| Soru / SMS | İlan başına "hâlâ geçerli mi?" sorusu (push) ve SMS yedeği |

### 5.2 Sonuçlar (özet; tamamı `sonuclar/deney3.md`)

A ile sistemin varsayılanları (30 tohum ortalaması [%95 GA]):

| Senaryo | Bayat ilan-saat, % | İlan başına bayat saat | Tazelik, % | Yanlış düşen geçerli, % | Soru / ilan | SMS / ilan |
|:---|---:|---:|---:|---:|---:|---:|
| A — teyit yok, q = 0,3 | 62,9 [62,5; 63,3] | 39,1 | 34,2 | 0 | 0 | 0 |
| A — teyit yok, q = 0,5 | 55,7 [55,2; 56,1] | 29,0 | 39,2 | 0 | 0 | 0 |
| A — teyit yok, q = 0,7 | 45,3 [44,7; 45,9] | 19,1 | 46,2 | 0 | 0 | 0 |
| B — 24/4/12, p = 0,5 | 27,4 [27,1; 27,7] | 7,6 | 84,6 | 15,4 [15,1; 15,8] | 1,09 | 0,91 |
| B — 24/4/12, p = 0,7 | 25,0 [24,7; 25,3] | 7,0 | 89,5 | 11,1 [10,7; 11,4] | 1,27 | 0,97 |
| B — 24/4/12, p = 0,9 | 22,0 [21,7; 22,2] | 6,2 | 94,8 | 4,7 [4,5; 4,9] | 1,54 | 1,06 |
| B + BR-05, p = 0,7 | 24,7 [24,4; 25,0] | 6,9 | 89,6 | 11,1 | 1,27 | 0,97 |
| B + BR-05 (10× şikayet), p = 0,7 | 19,7 [19,5; 19,9] | 5,1 | 92,2 | 11,4 [11,1; 11,8] | 1,35 | 1,04 |

Eşleştirilmiş farklar (q = 0,5): B(p = 0,7) − A: bayat pay −30,7 puan [−30,9; −30,4], tazelik +50,3 puan, yanlış düşme +11,1 puan (hepsi p < 0,001). BR-05 (varsayılan trafik) − B: bayat pay −0,28 puan [−0,32; −0,25]; 10× trafikte −5,3 puan [−5,4; −5,2], buna karşılık yanlış düşme +0,36 puan [0,30; 0,42].

Duyarlılık (p = 0,7, q = 0,5; tam ızgara p ∈ {0,5; 0,7; 0,9} için `deney3.md` §3):

| Soru aralığı (sa) | Bekliyor → düşme (sa) | Bayat pay, % | Tazelik, % | Yanlış düşen geçerli, % | Kayıp geçerli saat / ilan | Soru / ilan | SMS / ilan |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 12 | 6 | 18,4 | 100,0 | 20,8 | 4,45 | 1,49 | 1,19 |
| 12 | 12 | 20,6 | 96,3 | 15,1 | 3,24 | 1,50 | 1,20 |
| 12 | 24 | 24,7 | 85,9 | 8,1 | 1,87 | 1,50 | 1,20 |
| 24 | 6 | 23,3 | 93,0 | 15,1 | 2,95 | 1,26 | 0,96 |
| **24** | **12** | **25,0** | **89,5** | **11,1** | **2,13** | **1,27** | **0,97** |
| 24 | 24 | 28,1 | 82,6 | 5,8 | 1,18 | 1,27 | 0,97 |
| 48 | 6 | 31,9 | 72,1 | 12,0 | 2,04 | 1,13 | 0,91 |
| 48 | 12 | 33,0 | 70,6 | 8,6 | 1,40 | 1,13 | 0,92 |
| 48 | 24 | 35,0 | 66,9 | 4,0 | 0,70 | 1,14 | 0,92 |

(GA'lar ±0,2–0,5 puan düzeyinde; `deney3.md`.)

### 5.3 Yorum ve "24/4/12 uygun mu?" kararına katkı

1. **Teyit mekanizması bayat ilanı belirgin biçimde azaltır.** Bu varsayımlar altında listede görünen ilan-saatlerinin bayat payı %56'dan (A, q = 0,5) %25'e iner; bayat ilanın listede kalma süresi ilan başına ~29 saatten ~7 saate düşer. Etki p'ye göre çok değişmez (p = 0,5'te bile %27), çünkü asıl kazanç "yük gidince düzenli olarak sorulmak"tan gelir.
2. **Bedeli yanlış düşen geçerli ilanlardır ve bu bedel p'ye çok duyarlıdır.** Varsayılan sürelerle, cevap vermeyen sahibin ilanı 16 saatte düşer: p = 0,7'de ilanların ~%11'i, p = 0,5'te ~%15'i yükü hâlâ dururken listeden kalkar. Bu, kalan bayat payı kadar önemli bir kalite sorunudur (yük sahibi ilanı yeniden açmak zorunda kalır; BR-06 kararı verilirse güven skoru da etkilenir).
3. **Süreler ödünleşimi kaydırır, ortadan kaldırmaz.** p = 0,7'de:
   - "Teyit bekliyor"da kalma süresi 12 → 24 saat: yanlış düşme %11,1 → %5,8 (yarıya iner), bayat pay %25,0 → %28,1 (+3 puan). Bekleyen ilan sarı rozetle alta indiği için bu ek bayat sürenin bir kısmı kullanıcıya zaten işaretlidir ("teyit bekliyor" payı %13 → %21).
   - Soru aralığı 24 → 12 saat: bayat pay −4,4 puan, ama soru +%18, SMS +%24 ve yanlış düşme %15'e çıkar (daha çok soru, daha çok cevapsız kalma fırsatı).
   - Soru aralığı 48 saat: bayat pay %33'e, tazelik %71'e kötüleşir; yanlış düşme ancak 12 sa beklemeyle birlikte %8,6'ya iner.
4. **Bu varsayımlarla değerlendirme:** 24 saatlik soru aralığı makul bir orta nokta görünüyor. 12 saatlik "teyit bekliyor → süresi doldu" süresi ise, cevap oranı %90'ın altındaysa geçerli ilanların kayda değer bir kısmını düşürüyor; 24 saat, bayat payı birkaç puan artırma pahasına bu kaybı yarıya indiriyor. **Ancak bu öneri, ölçülmemiş p'ye ve cevap gecikmesi dağılımına dayanıyor.** En sağlam öneri: varsayılanları şimdilik koruyup pilotta "teyit cevap oranı ve medyan süresi"ni (Y5 metrikleri zaten ölçüyor) ölçmek; p < ~0,8 çıkarsa bekleme süresini 24 saate çekmek. Karar kullanıcıya aittir.
5. **İlan tazeliği ölçütü (docs/03 §8) soru aralığına bağlıdır:** 12 saatlik aralıkta tanım gereği ~%100'e yaklaşır, 48 saatte %70'e düşer. Aralığı değiştirmek bu metriği mekanik olarak değiştirdiği için, tazeliği yöntemler arası karşılaştırmada tek başına kullanmak yanıltıcı olur; "bayat ilan-saat payı" daha doğrudan bir ölçüttür (ama sahada ölçülemez: yükün gerçekten ne zaman gittiği bilinmez; sahada vekil ölçüt BR-05 "yük yok" şikayetleridir).
6. **BR-05'in etkisi şikayet trafiğine bağlıdır.** Varsayılan (düşük) trafikte bayat payı yalnız ~0,3 puan azaltır; 10 kat trafikte ~5 puan azaltır ve yersiz şikayetler yüzünden yanlış düşmeyi biraz artırır. Pilot ölçeğinde (az görüntülenme) BR-05'ten büyük etki beklenmemeli.
7. **Maliyet notu:** varsayılanlarda ilan başına ~1 SMS gidiyor (soruların ~%75'i 30 dakika içinde cevaplanmıyor: %30'u hiç, cevaplananların yaklaşık yarısı 30 dakikadan geç). SMS ücretli bir servistir; 12 saatlik aralık SMS'i ~%24 artırır.

### 5.4 Sınırlılıklar (Deney 3'e özgü)

- Bütün davranış parametreleri [T]: p, cevap gecikmesi, q, yükün gitme süresi dağılımı, uyku saatleri, şikayet oranları. Sonuçların **yönü** bu varsayımlara karşı sağlam görünüyor (bütün ızgarada B < A bayat payı), **büyüklükleri** değil.
- p her soru için bağımsız ve herkes için aynı: gerçekte bazı sahipler hiç cevap vermez, bazıları hep verir. Heterojenlik, yanlış düşmeleri belli sahiplerde toplar (oran aynı kalsa bile dağılımı değişir).
- Yanlış düşen ilanın yeniden yayınlanması ("yeniden yayınla" özelliği var) modellenmedi: kaybedilen geçerli saat üst sınırdır.
- Yükün gitme zamanı sistemden bağımsız alındı: daha taze bir listenin araç bulmayı hızlandırması (geri besleme) yok.
- "Teyit bekliyor" ilanlar görünür sayıldı (sistemdeki gibi alta iner, sarı rozetli); kullanıcıların bunlara daha az güvenmesi modellenmedi.
- SMS gönderimi 5 dakikalık turun ilk uygun anında; push'un açılıp cevap verilmemesi durumu ayrıca modellenmedi ("açtı" = "cevap verdi").

---

## 6. Testler

`npx tsx --test tez/simulasyon/test/*.test.ts` → **32 test, 32 geçti, 0 kaldı** (bu makinede ~3 sn).

| Dosya | Ne sınanıyor |
|---|---|
| `macar.test.ts` | Tam atama (r ≤ c, kare ve dikdörtgen) 300 rastgele örnekte kaba kuvvetle aynı en az maliyet; kısmi atama (uygunsuz çiftli, n > m dahil, tamamen uygunsuz satırlı) 400 örnekte aynı en çok eşleşme ve en az maliyet; eşleşme sayısının maliyetten önce geldiği el ile örnek |
| `akis.test.ts` | Tam k eşleşme: 300 örnekte her k için kaba kuvvetle aynı optimum (600+ k değeri); k = en büyükte Macar ile aynı |
| `eslestirme.test.ts` | Aday matrisinin her hücresi doğrudan shared `matchLoadWithCapacity` sonucuyla aynı (uygunluk ve skor); `lon → lng` dönüşümü; boş km tanımı; kural tabanlı seçimin tanıma uygunluğu; yöntemlerin kendi amaçlarında en iyi oluşu |
| `uretici.test.ts` | Aynı tohum aynı veri, farklı tohum farklı veri; araçların iç içeliği; her ilan shared zod şemalarından ve tarih kurallarından geçer; koridor payı ≈ %55 |
| `teyit.test.ts` | Varsayılan parametrelerin shared ile aynılığı; BR-02…04 geçiş zamanları (el ile hesaplanmış); yükleme günü 6 saat kuralı; "geçerli" cevabın son teyidi yenilemesi ve gittikten sonraki cevabın kapatması; senaryo A; BR-05; uyku saatleri; **atlanan zamanlayıcı turlarının sonucu değiştirmediği** (her 5 dakikada tur atan sürümle 600 ilan × senaryo birebir aynı) |
| `istatistik.test.ts` | t ve normal dağılım tablo değerleri, özet ve GA, eşleştirilmiş t, Wilcoxon, Holm |
| `donus.test.ts` | Deney 2: aynı tohum aynı örnek, işler iç içe ve il dışı, varış günü shared `estimatedArrivalDay`; her iş × pazar yükü çiftinde aday kararı doğrudan shared (`matchLoadWithCapacity` sanal ilanla, değilse `fitRejectReason` + `onRouteMatch`) ve kabul kuralıyla aynı; küresel atama 60 küçük örnekte kaba kuvvetle aynı en az toplam boş km ve hiçbir yöntemden kötü değil; bir yük tek araca, B yalnız dönüş yükü, C dönüş adayı varken rota seçmez; polyline kodlaması (Google örneği) |

Testlerin hata yakaladığı da denendi: Macar'daki ceza sabiti küçültülünce ve teyit simülasyonunda SMS turu atlanınca ilgili 4 test kırıldı (sonra geri alındı). Deney 2'de küresel atamanın "eşleşmeden dön" maliyeti 0 yapılınca ve sistem sırası (önce dönüş, sonra rota) ters çevrilince ilgili testler kırıldı (geri alındı).

---

## 7. Deney 2 — dönüş planının (F4) boş km'ye etkisi

### 7.1 Yöntem

Kurallar sistemle aynıdır ve shared'dan içe aktarılır (§2): tahmini varış, dönüş penceresi, sanal boş araç ilanıyla BR-20 dönüş yükü, BR-23 rota üstü. API'deki `ReturnPlanService` ile aynı karar sırası: önce dönüş yükü, değilse araç/tarih uyuyorsa rota üstü.

- **Örnek:** *J* gidiş işi ve *J* × ρ pazar yükü (dönüşte alınabilecek). Gidiş işi = üreticinin bir yükü (**il dışı** [T]; il içiyse yeniden çekilir), aracı yükün istediği tiptir (kasa yük istiyorsa o, istemiyorsa tipin kasa dağılımından [T]; kapasite tip aralığından, yükten az değil). **Ev = işin kalkış ilçesi** (API'deki varsayım). Tahmini varış = yükleme başlangıcı + ⌈yol km / 600⌉ (shared, gecikmesiz). Pazar yükleri üreticinin olağan yükleridir (Deney 1 ile aynı dağılımlar), sahiplerinin güven skoru shared `trustScore` ile. İşler tohum başına iç içe (50 işin ilk 50'si 100 işinkiyle aynı), pazar yükleri oranlar arasında iç içe.
- **Aday:** her iş için pazar yükü, (i) sanal boş araç ilanıyla (varıştan eve, varış … +2 gün, işteki araç) BR-20 adayıysa **dönüş yükü**; (ii) değilse araç/tarih uyuyor ve dönüş yolunun OSRM çizgisine kalkışı ve varışı ≤ 30 km, yönü doğruysa **rota üstü**. **Kabul [T]:** nakliyeci yalnız boş km'sini azaltan yükü alır (gelir modellenmedi).
- **Boş km:** boş dönüş = karayolu(varış → ev); dönüş yüküyle = karayolu(varış → yük kalkışı) + karayolu(yük varışı → ev). Gidişte boş km yok (iş evden başlar). Boş km oranı = boş / (boş + yüklü), gidiş + dönüş.

| Kod | Yöntem | Not |
|---|---|---|
| A | Dönüş planı yok: boş döner | |
| B | Yalnız dönüş yükleri (BR-20) | Nakliyecinin varışta **elle boş araç ilanı** açmasının karşılığı: F4 olmadan da sistemde var |
| C | Dönüş + rota üstü (**F4**) | Uygulamadaki sıra: dönüş listesinden en yüksek skorlu, yoksa rota üstü listesinden |
| C-km | Aynı öneriler, nakliyeci boş km'si en az olanı seçer | Kullanıcı davranışı duyarlılığı |
| C-Macar | Aynı adaylarla küresel atama, toplam boş km tasarrufu en çok | Merkezi planlayıcı üst sınırı; her işe "eşleşmeden dön" sahte sütunu (maliyet T), eşleşme maliyeti T − tasarruf |

B, C ve C-km'de işler **varış gününe göre** seçer (önce varan önce alır); bir yükü tek araç alır. **Okuma:** C − B = F4'e özgü katkı (rota üstü + aynı listede sunma); B − A = dönüşte platformdan yük bulmanın etkisi (F4 bunu otomatikleştirir).

**Tasarım:** *J* ∈ {50, 100, 200, 400}, ρ ∈ {1, 2, 4}, 30 tohum (12 × 30 = 360 örnek, her örnekte 5 yöntem); duyarlılık *J* = 200, ρ = 2'de bir parametre değiştirilerek (pencere 1/2/4 gün, sapma 15/30/50 km, dönüş yarıçapı 25/40, 50/80, 100/160 km). İstatistik Deney 1 ile aynı (`istatistik.ts`): eşleştirilmiş t, Wilcoxon, ana deneydeki 180 test üzerinde Holm.

### 7.2 Sonuçlar (özet; tamamı `sonuclar/deney2.md`)

Araç başına boş dönüş (A) ~634–650 km; boş km oranı A'da %50 (dönüş ≈ gidiş). İş başına aday: dönüş yükü 0,06 (J = 50, ρ = 1) – 1,59 (J = 400, ρ = 4), rota üstü 0,22 – 6,08.

| İş | Pazar/iş | Yöntem | Dönüş yükü bulma, % | Araç başına boş km | Boş km oranı, % | Boş km azalması (A'ya göre), % |
|---:|---:|:---|---:|---:|---:|---:|
| 100 | 2 | B | 11,9 [11,1; 12,8] | 605 | 47,0 | 5,3 [4,6; 6,0] |
| 100 | 2 | C (F4) | 31,6 [29,7; 33,6] | 576 | 44,6 | 9,7 [8,8; 10,6] |
| 100 | 2 | C-Macar | 33,2 | 572 | 44,2 | 10,5 [9,6; 11,4] |
| 200 | 2 | B | 17,4 [16,6; 18,2] | 599 | 45,5 | 8,0 [7,5; 8,5] |
| 200 | 2 | C (F4) | 40,8 [39,7; 41,9] | 562 | 42,5 | 13,6 [12,9; 14,3] |
| 200 | 2 | C-km | 41,0 | 561 | 42,4 | 13,7 [13,1; 14,4] |
| 200 | 2 | C-Macar | 44,0 | 552 | 41,8 | 15,1 [14,3; 15,8] |
| 400 | 4 | B | 36,1 [35,4; 36,7] | 526 | 39,6 | 19,1 [18,5; 19,6] |
| 400 | 4 | C (F4) | 69,8 [69,0; 70,7] | 461 | 34,5 | 29,1 [28,3; 29,8] |
| 400 | 4 | C-Macar | 74,4 | 438 | 32,7 | 32,7 [31,8; 33,5] |

Bütün yapılandırmalarda (Holm sonrası p < 0,001): B < A, C < A ve **C < B** toplam boş km'de. C − B (F4'e özgü): dönüş yükü bulma +9,4 (J = 50, ρ = 1) ile +33,7 puan (J = 400, ρ = 4); boş km azalmasına +2,2 (J = 50, ρ = 1) ile +10,0 puan (J = 400, ρ = 4). Bulunan dönüşlerin %50–70'i rota üstü listesinden gelir. C-km − C: azalmada en çok +1,1 puan (yoğun pazarda; seyrekte anlamsız). C-Macar − C: azalmaya +0,3 ile +3,6 puan.

Duyarlılık (J = 200, ρ = 2; C'nin boş km azalması): pencere 1 / 2 / 4 gün → %13,3 / 13,6 / 13,8; sapma 15 / 30 / 50 km → %11,0 / 13,6 / 17,0; dönüş yarıçapı 25/40 / 50/80 / 100/160 km → %11,1 / 13,6 / 20,2 (B: %2,6 / 8,0 / 17,6).

### 7.3 Yorum

1. **Dönüş planı boş km'yi belirgin biçimde azaltır ve etki pazar yoğunluğuyla büyür.** F4 (C), boş dönüşe göre toplam boş km'yi seyrek pazarda (J = 50–100, ρ = 1) %4–5, yoğun pazarda (J = 400, ρ = 4) %29 azaltır; araç başına ~650 km boş dönüş ~460 km'ye iner. docs/03 §8'deki "boş km azalması (simülasyon)" ölçütü budur.
2. **F4'e özgü katkı rota üstü listesidir.** Yalnız BR-20 dönüş yükü (B) — ki nakliyeci varışta elle boş araç ilanı açarak F4 olmadan da alabilir — azalmanın %50–66'sını verir; rota üstü ara yükler bulma oranını yaklaşık iki ile üç katına (1,9–3,0) çıkarır ve azalmaya 2,2–10 puan ekler. Rota üstü yükler daha kısa olduğundan bulunan yük başına tasarrufları dönüş yükünden küçüktür (J = 200, ρ = 2'de B'de bulunan yük başına ~%0,46, C'de ~%0,33 azalma puanı).
3. **Sıralama yeterince iyi.** Uygulamanın sırası (önce dönüş listesi, skor) ile "en az boş km'yi seçen nakliyeci" arasında fark en çok 1,1 puan; listedeki sıra boş km açısından kullanıcıyı yanlış yönlendirmiyor.
4. **Merkezi koordinasyonun kazancı sınırlı.** Aynı adaylarla küresel atama, sıralı seçime göre en çok 3,6 puan ek azalma getirir (yoğun pazarda büyür). Deney 1'deki gibi: kural tabanlı sıralı seçim, üst sınıra yakındır; küresel atama dakikalık toplu bir iş olarak düşünülebilir ama önceliği düşüktür.
5. **Pencere süresi önemsiz, sapma ve yarıçap belirleyici.** Dönüş penceresini 1'den 4 güne çıkarmak etkiyi yalnız ~0,5 puan değiştirir (BR-20'nin ±1 gün toleransı ve pazar yüklerinin tarih aralığı zaten geniş); sistemdeki 2 gün makul. Sapma sınırı 30 → 50 km etkiyi %13,6'dan %17'ye çıkarır, ama gerçekte 50 km sapmayı kabul eden nakliyeci oranı ölçülmedi; 30 km (BR-23) tutucu ve makul bir varsayılan. Dönüş yarıçapı B'yi çok etkiler (25/40 km'de %2,6), C'yi daha az (rota üstü listesi dar yarıçapı telafi eder).

### 7.4 Sınırlılıklar (Deney 2'ye özgü)

- **Rekabet yalnız deneydeki araçlar arasında:** pazardaki başka nakliyeciler (kendi boş araç ilanları, aramaları) dönüş yüklerini almaz. Gerçek bulma oranları daha düşük olur; mutlak düzeyler iyimserdir, yöntemler arası **farklar** yorumlanmalıdır.
- **Statik pazar:** pazar yükleri baştan var; zaman içinde gelen ve giden ilanlar, yüklerin başka yollarla araç bulması yok.
- **Tek dönüş yükü, zincir yok:** araç en çok bir dönüş yükü alır; dönüş yükünden sonra eve dönmeden ikinci bir yük aranmaz.
- **Kabul ve davranış [T]:** nakliyeci yalnız boş km'yi azaltan yükü alır, öneriyi her zaman kabul eder; gelir, bekleme, sapma isteksizliği ve yük sahibinin kabulü modellenmedi. 50 km sapma gibi duyarlılık değerlerinin gerçekte kabul edilip edilmeyeceği bilinmez.
- **Ev = işin kalkış ilçesi** (API'deki varsayım); nakliyecinin gerçek ev bölgesi (A4 "çalıştığı bölgeler") yok. Gidiş işi il dışı [T]; gecikme yok.
- **Rota:** OSRM'nin sadeleştirilmiş otomobil profili çizgisi (kamyon kısıtları yok); konum ilçe merkezi. Rota üstü yük yalnız **dönüş** yolunda aranır (gidişte boş kapasiteyle ara yük yok, sistemde de yok). Sistem listede grup başına en çok 20 öneri gösterir; simülasyon bütün adayları kullanır (seçilen yük nadiren 20'nin dışındadır).

## 8. Varsayımlar ([T] = tahmin, `parametreler.ts`)

| Grup | Varsayım | Değer |
|---|---|---|
| Ortak | Referans gün | 2026-11-02 (Pazartesi) |
| Ortak | Tohum sayısı | 30 / yapılandırma |
| Coğrafya [T] | İl ağırlıkları | koridor 20, merkez 6, diğer 0,5 (≈ %55 / %21 / %25) |
| Coğrafya [T] | İlçe seçimi | il içinde düzgün |
| Coğrafya [T] | İl içi yük oranı | panelvan 0,6; kamyonet 0,5; kamyon 0,25; kırkayak 0,1; tır 0,05 |
| Araç [T] | Tip karışımı (yük ve araç) | tır 40, kırkayak 10, kamyon 25, kamyonet 15, panelvan 10 |
| Araç [T] | Kapasite (t, düzgün) | tır 24–27, kırkayak 18–22, kamyon 10–15, kamyonet 3–7,5, panelvan 1–1,5 |
| Araç [T] | Kasa dağılımı | tipe göre (ör. tır: tenteli 45, kayar perde 15, frigo 12, açık 10, damper 8, lowbed 5, kapalı 5) |
| Araç [T] | "Her yer" oranı | 0,35 |
| Araç [T] | Müsaitlik | başlangıç 0–5 gün (35/30/15/10/5/5), aralık 0–3 gün (40/30/20/10) |
| Yük [T] | Yük cinsi karışımı | genel 25, palet 20, dökme 8, inşaat 10, gıda 12, soğuk zincir 6, makine 6, tarım 10, tehlikeli 3 |
| Yük [T] | Cinse göre kasa isteği | ör. soğuk zincir → frigo; dökme → damper 80 / fark etmez 20 |
| Yük [T] | Ağırlık | U(0,2; 1,0) × istenen tipin kapasite üst sınırı |
| Yük [T] | Yükleme | başlangıç 0–7 gün (20/30/20/15/5/4/3/3), aralık 0–3 gün (50/25/15/10) |
| Güven [T] | trustScore girdileri | %20 yeni üye; iş sayısı log-normal(15, 1); %60 puanlanmış; yıldız U(3,5; 5); doğrulama 0/1/2 = 10/50/40; iptal ≤ 0,1; şikayet ≤ 0,02 |
| Mesafe | Boş km | OSRM karayolu (yoksa kuş uçuşu × 1,3) |
| Deney 2 | Tasarım | iş ∈ {50, 100, 200, 400}, pazar/iş ∈ {1, 2, 4}; duyarlılık 200 iş, pazar/iş 2 |
| Deney 2 [T] | Gidiş işi | üreticinin yükü, il dışı; araç = istenen tip, kasa yük istiyorsa o; kapasite tip aralığı, yükten az değil |
| Deney 2 [T] | Ev | işin kalkış ilçesi (API ile aynı) |
| Deney 2 [T] | Kabul | yalnız boş km'yi azaltan dönüş yükü; öneri kabul edilir; önce varan önce seçer |
| Deney 2 | Sistem parametreleri | shared `RETURN_PLAN_PARAMS` (600 km/gün, pencere +2 gün, sapma 30 km), `DEFAULT_MATCH_PARAMS` (50/80 km, ±1 gün); ızgara: pencere {1, 2, 4}, sapma {15, 30, 50}, yarıçap {25/40, 50/80, 100/160} |
| Deney 3 [T] | İlan geliş | 14 gün × 100 ilan/gün, saat ağırlıkları mesai yoğun |
| Deney 3 [T] | Yükün gitmesi | log-normal, medyan 18 sa, σ = 1 |
| Deney 3 [T] | Kendiliğinden kapama | q = 0,5 (duyarlılık 0,3 / 0,7), gecikme log-normal medyan 2 sa, σ = 1 |
| Deney 3 [T] | Cevap | p = 0,7 (duyarlılık 0,5 / 0,9), gecikme log-normal medyan 30 dk, σ = 1,2 |
| Deney 3 [T] | Uyku | 23:00–07:00, uyanınca + U(0, 90 dk) |
| Deney 3 [T] | BR-05 şikayeti | bayat 0,03/sa, geçerli 0,002/sa; yoğun varyant 10× |
| Deney 3 | Sistem parametreleri | shared `DEFAULT_CONFIRMATION_PARAMS` (24 / 6 / 4 / 12 sa, SMS 30 dk, eşik 2); ızgara: aralık {12, 24, 48}, bekleme {6, 12, 24} |

---

## 9. Genel sınırlılıklar

- **Sentetik veri:** coğrafya, araç/yük karışımı, tarihler ve insan davranışı tahmindir; saha görüşmeleri (Faz 0) ve pilot verisiyle güncellenmelidir. Sonuçların yönü ve göreli büyüklüğü tartışılabilir, mutlak değerleri değil.
- **Mesafe:** ilçe merkezleri arası; gerçek yükleme adresleri, OSRM'in araç profili (kamyon kısıtları yok, otomobil profili) ve trafik dikkate alınmadı. OSRM yoksa kuş uçuşu × 1,3 medyanı tutturur ama dağılımın kuyruğunu kaçırır.
- **Uygunluk:** shared haversine; sistemdeki PostGIS ön süzgeci 2 km pay bırakır ve kesin kararı yine shared verir, bu yüzden simülasyon ile sistem aynı adayları bulur (sferoid/küre farkı yarıçap sınırında birkaç yüz metre olabilir).
- **İstatistik:** 30 tohum; tohumlar arası bağımsızlık var, aynı tohumda yöntemler eşleştirilmiş. Holm düzeltmesi her deneyde tüm testleri tek aile sayar (tutucu). Küçük örneklerde (n ≤ 50) birçok fark sıfıra yakın; Wilcoxon normal yaklaşımı küçük sıfır-dışı fark sayısında yaklaşıktır.
- **Süre ölçümleri:** tek makine, tek iş parçacığı; göreli okunmalıdır.
