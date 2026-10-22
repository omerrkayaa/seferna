# NFR-01 performans ölçümü

**Gereksinim (docs/03 NFR-01):** yük listesi API'si p95 < 300 ms (10.000 aktif ilanda); eşleşme bildirimi ilan yayınından itibaren < 60 sn.

## Yöntem

`node arastirma/performans/olcum.mjs` (seçenekler: `--ilan=10000 --istek=300 --es=10 --deneme=20 --sakla`)

1. En son yedek (`npm run db:backup`) ayrı bir veritabanına (`nakliye_perf`) geri yüklenir; geliştirme veritabanı kirlenmez. Mevcut aktif ilanlar ve boş araçlar kapatılır.
2. Sentetik veri (tohumlu, `setseed(0.42)`): 500 yük sahibi, **10.000 aktif ilan** (yarısı başlangıç koridorunda — Aydın, İzmir, Manisa, İstanbul — yarısı Türkiye geneli; %90 teyitli, %10 teyit bekliyor; 0–10 gün içinde yükleme; karışık yük/araç/kasa/fiyat), 1.000 nakliyeci, araç ve boş araç ilanı.
3. Bu veritabanına bağlı ikinci bir API (port 3200, zamanlayıcı kapalı) başlatılır; bir nakliyeci SMS koduyla girer.
4. **Liste:** 7 senaryo × 300 istek, 10 eşzamanlı bağlantı, 30 istek ısınma. Süre istemci tarafında uçtan uca ölçülür (istek + API + veritabanı + gövdenin okunması; aynı makine, ağ gecikmesi yok).
5. **Eşleşme bildirimi:** 20 deneme; her denemede farklı bir ilçede farklı bir nakliyecinin boş aracı açılır, sonra (moderasyondan muaf) yük sahibi o ilçeden ilan verir; ilanın kaydından `matches.notified_at` dolana kadar geçen süre.

Ortam: Intel i7-12700H (20 iş parçacığı), 32 GB, Node 24.18, PostgreSQL 16 + PostGIS 3.4 (Docker), Windows 11.

## Sonuçlar (2026-10-15)

Beş ölçüm: **önce** (eski sorgu, 1 ölçüm), **ilk sonra** (yeni sorgu, 1 ölçüm) ve **son kod** (yeni sorgu + NFR-09 istek istatistiği ara katmanı; aynı yedekten art arda 3 ölçüm, makinede başka iş yokken).

| Senaryo | Önce p50 | Önce p95 | İlk sonra p50 | İlk sonra p95 | Son kod p50 (ortanca) | Son kod p95 (3 ölçüm) | Son kod p99 (en kötü) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Filtresiz ilk sayfa | 110 | 159 | 98 | 161 | 51 | 66–127 | 342 |
| Kalkış ili (İzmir) | 72 | 92 | 100 | 170 | 56 | 66–69 | 85 |
| Varış ili + araç tipi (İstanbul, tır) | 58 | 71 | 92 | 116 | 55 | 66–70 | 81 |
| Yükleme günü | 29 | 36 | 25 | 33 | 15 | 21–26 | 32 |
| **Yakınımdakiler (İzmir Konak, 50 km)** | **2.390** | **3.353** | **114** | **158** | **66** | **74–123** | 205 |
| Derin sayfa (5. sayfa) | 99 | 143 | 99 | 150 | 53 | 60–70 | 74 |
| Karma (her istekte farklı süzgeç) | 76 | 3.124 | 98 | 188 | 53 | 65–79 | 88 |

Süreler milisaniye. Eşleşme bildirimi (20 deneme, en az / ortanca / en çok): önce 210 / 342 / 454 ms, ilk sonra 351 / 543 / 784 ms, son kod 173–197 / 321–349 / 394–427 ms.

**NFR-01 sonucu:** son kodla üç ölçümün hepsinde bütün liste senaryolarında p95 ≤ 127 ms (hedef < 300 ms) ✅; eşleşme bildirimi en çok 0,43 sn (hedef < 60 sn) ✅. (Bir ölçümde filtresiz ilk sayfanın p99'u 342 ms — gereksinim p95 üzerinden.)

**Ölçümler arası değişkenlik büyük.** Aynı sorgu kodunda "ilk sonra" ile "son kod" arasında İzmir p95 170 → 66–69 ms, eşleşme ortancası 543 → ~330 ms; ölçüm süresi de 68 sn → 40–44 sn ("önce" 136 sn). Ara katman bir şeyi hızlandırmaz; fark büyük olasılıkla ölçüm sırasında makinedeki başka yükten (o sırada ne çalıştığından emin değilim). Bu yüzden: (1) "önce" tek ölçüm ve aynı koşulda tekrarlanmadı — yakınımdakilerdeki 3,35 sn → ~0,1 sn (p95 27–45 kat) fark gürültüyle açıklanamaz ve EXPLAIN ile de destekleniyor, ama öteki senaryolardaki önce/sonra farkları (± 100 ms) anlamlı sayılmamalı; (2) daha önce "il süzgeçli senaryolar yavaşladı" diye yazdığım bedel tekrar ölçümde görülmedi, geri alındı.

## Bulgu ve düzeltme

İlk ölçümde "Yakınımdakiler" p95 3,35 sn ile hedefi on kat aştı. `EXPLAIN ANALYZE`: planlayıcı `ST_DWithin(origin_geom::geography, …)` süzgecinin **1 satır** döndüreceğini tahmin etti (gerçekte 2.039); bu yüzden ilçe, il ve kullanıcı birleştirmelerini iç içe döngüyle, her satırda kullanıcı tablosunu baştan sona tarayarak yaptı (11,7 milyon satır elendi; ~2 sn). Geometry üzerindeki GiST indeksi de `::geography` ifadesine uymadığı için kullanılmıyordu.

Düzeltme (iki parça):
1. **Arama iki adımda:** süzme, sıralama ve sayfa yalnız ilan tablosunda (il süzgeci ilçe alt sorgusuyla); birleştirmeler yalnız sayfadaki 21 ilan için. Planlayıcının tahmini ne olursa olsun pahalı birleştirme küçük kümede yapılır.
2. **İfade indeksleri** (migration 0026): `load_posts` ve `capacity_posts` kalkış/varış noktaları için `gist ((… ::geography))`. Hem kullanılır hem de PostgreSQL ifade için istatistik toplar. Yalnız ilk adım: indeksle 36 ms, indekssiz 63 ms.

**Bedeli:** her aramada iki sorgu turu (ikincisi yalnız sayfadaki ≤ 21 ilan için); son kod ölçümlerinde il süzgeçli senaryolar 66–70 ms ile ölçülebilir bir yavaşlama göstermedi.

**Sınırlar:** tek makine, ağ gecikmesi yok, 10 eşzamanlı bağlantı; gerçek yük dağılımı (çok sayıda eşzamanlı mobil istemci, ağ) farklıdır. "Önce" koşulu (eski sorgu) aynı sessiz koşulda tekrarlanmadı. Sonuçlar `sonuclar/`: `olcum-2026-10-15-once.json` (önce), `olcum-2026-10-15.json` (ilk sonra), `olcum-2026-10-15-2.json` … `-4.json` (son kod). Betik aynı gün ikinci ölçümde dosya adına `-2`, `-3` … ekler (öncekinin üzerine yazmaz).
