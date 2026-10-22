# NFR-07 kullanılabilirlik ölçümü

**Gereksinim (docs/03 NFR-07):** ilk ilanı vermek < 90 sn; yük aramaktan aramaya < 3 dokunuş.

Bu bir **analitik ölçüm**dür, gerçek kişiyle yapılan deneme değildir; o deneme henüz yapılmadı.

## Yöntem

Testler:
- `apps/mobile/e2e/usability.spec.ts`: Expo web derlemesi, 390×844 ekran.
- `apps/web/e2e/usability.spec.ts`: Chrome, Edge ve Firefox, 1280×720 ekran.

Ortak sayaç `e2e/usability.ts`. İki pakette de aynı dosya var.

Çalıştırmak için önce API'yi, web'i ve Expo'yu açın, sonra:

```
cd apps/mobile && NFR07_OUT=../../arastirma/kullanilabilirlik/sonuclar npx playwright test e2e/usability.spec.ts
cd apps/web && NFR07_OUT=../../arastirma/kullanilabilirlik/sonuclar npx playwright test e2e/usability.spec.ts
```

İkinci komut üç tarayıcıda da koşar.

1. **En kısa yol, gerçek arayüzde yürünür.**
   - Yalnız zorunlu alanlar doldurulur. Varsayılanlara dokunulmaz: yükleme günü bugün, kasa "fark etmez", fiyat "teklif alayım".
   - İlan: Aydın/Nazilli → İstanbul/Esenyurt, palet, 18 ton, tır.
   - Yol testte gerçekten yürüdüğü için, ileride forma yeni bir zorunlu alan eklenirse ilan gönderilemez ve test düşer.
2. **Sayılanlar:**
   - **Dokunuş ya da tıklama.** Bir alanı odaklamak için yapılan dokunuş da sayılır. Alan kendiliğinden odaktaysa sayılmaz; bu, sayfada `document.activeElement` ile denetlenir, varsayılmaz.
   - **Tuş.** Yazılan her karakter sayılır. Web'deki açılır listede ilk harfler ve Enter sayılır.
   - **Karar adımı.** Her alan, her seçim ve gönderme bir adımdır.
   - **El değiştirme.** Elin fare ile klavye arasında gidip gelmesi; yalnız masaüstünde sayılır.
   - **Uygulama dışı dokunuş.** "Ara"dan sonra telefonun arama ekranındaki dokunuş.
3. **Harf sayısı ölçülür, tahmin edilmez.**
   - Hedef, listede ilk eşleşme olana kadar harf yazılır. Mobil seçicinin araması "içerir" diye eşleştirir, web açılır listesi "ile başlar" diye.
   - Örnek: "Esenyurt" için "eseny" yazılır, çünkü "esen" yazınca Esenler öne çıkıyor.
   - Bu kural kötümserdir: hedef ekranda görünse de ilk sırada değilse bir harf daha yazılır.
4. **Süre KLM ile tahmin edilir** (Keystroke-Level Model; Card, Moran, Newell 1980, *Communications of the ACM* 23(7)). İşlem süreleri (saniye):

   | İşlem | Süre |
   |---|---:|
   | K tuş: ortalama, sekreter olmayan yazıcı (~40 kelime/dk) | 0,28 |
   | K tuş: kötü durum, klavyeye yabancı | 1,20 |
   | P hedefi gösterme | 1,10 |
   | BB tıklama/dokunma (bas + bırak) | 0,20 |
   | H el değiştirme (fare ↔ klavye) | 0,40 |
   | M zihinsel hazırlık | 1,35 |

   Süre şöyle hesaplanır:

   > süre = M × adım + (P + BB) × (dokunuş + uygulama dışı dokunuş) + H × el değiştirme + K × tuş + R

   - M yerleştirmesi sadeleştirildi: her karar adımına bir M.
   - Dokunmatik ekranda H yok; bir dokunuş P + BB sayılır.
   - R, sistemin cevap süresidir. Yerine otomatik koşunun duvar saati süresi konur. İçinde Playwright'ın kendi payı da olduğu için gerçekte olandan fazladır.

### Sınırlar

- **KLM hatasız, işini bilen kullanıcıyı varsayar.** Ekranı ilk kez görenin arayıp okumaya ya da hata düzeltmeye harcadığı zamanı katmaz. Bu yüzden "ilk ilan" için çıkan süre gerçeğin alt sınırına yakındır. Gerçek kişiyle süre tutarak deneme şart (rehber §4).
- **SMS'in gelme süresi dahil değil.** Geliştirme ortamında kod anında loga düşüyor. Gerçek SMS'in kaç saniyede geldiği operatöre bağlı; bunu ölçmedim.
- **"Ara"dan sonraki adım test ortamında yapılamaz.** Web derlemesinde numara bir uyarıyla gösteriliyor. Android'de `tel:` bağlantısı numarayı arama ekranına yazar ve aramak için bir dokunuş daha gerekir. iOS da aramadan önce onay sorar. Bu dokunuş "uygulama dışı" diye ayrıca sayılır.
- **Web'deki açılır listeler fare ve harfle atlamayla seçilir:** tıkla, ilk harfleri yaz, Enter. Yalnız fareyle seçen biri (tıkla, kaydır, tıkla) daha az el değiştirir ama kaydırma süresi KLM'de yoktur.
- **Mobil ölçüm Expo web derlemesinde yapıldı.** Telefonda klavyenin açılıp kapanması ve animasyonlar farklıdır.

## Sonuçlar (2026-10-16)

Ham sonuçlar `sonuclar/` klasöründe, her akış için bir JSON dosyası. Her dosyada sayılar, süreler ve adımların sırası var.

### İlk ilanı vermek (hedef < 90 sn)

| Akış | Dokunuş | Tuş | Adım | El değiştirme | Sistem (sn) | KLM tipik (sn) | KLM kötü durum (sn) |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Mobil**, yeni hesap: uygulama açılışından ilanın gönderilmesine | 18 | 31 | 12 | – | 4,0 | **52,3** | 80,8 |
| Mobil, yalnız ilan formu | 12 | 14 | 8 | – | 3,3 | 33,6 | 46,5 |
| **Web (Chrome)**, yeni hesap: giriş sayfasından ilanın gönderilmesine | 13 | 37 | 12 | 18 | 1,5 | **52,2** | 86,2 |
| Web (Chrome), yalnız ilan formu | 8 | 20 | 8 | 14 | 0,9 | 33,3 | 51,7 |
| Web (Edge), yeni hesap | 13 | 37 | 12 | 18 | 2,2 | 52,8 | 86,9 |
| Web (Firefox), yeni hesap | 13 | 37 | 12 | 18 | 2,0 | 52,6 | 86,7 |

Mobil satırlar 2026-10-16'daki iki düzeltmeden sonraki ölçüm; öneriler 1 ve 2 aşağıda. Düzeltmeden önce yeni hesapla 20 dokunuş vardı: KLM tipik 55,0 sn, kötü durum 83,5 sn. Önceki JSON'lar 6fea47c'de.

Yeni hesabın adımları, iki platformda aynı sırayla: telefon numarası → SMS kodu → rol → "İlan ver" → kalkış ili → kalkış ilçesi → varış ili → varış ilçesi → yük cinsi → ağırlık → araç tipi → yayınla.

Tuşların dağılımı:
- 17 tuş giriş içindir: telefon numarası 11, SMS kodu 6.
- Mobildeki ilan formunda 14 tuş var:
  - aramalarda 12: "ay" (Aydın), "na" (Nazilli), "ist" (İstanbul), "eseny" (Esenyurt)
  - ağırlık 2: "18"
- Web formundaki 20 tuş, harfle atlama ve her listede bir Enter'dan gelir.

**Sonuç: karşılanıyor.**
- KLM tipik değerine göre yeni bir hesap ilk ilanını iki platformda da ~52 sn'de veriyor. Yalnız form ~34 sn.
- Kötü durumda (her tuş 1,2 sn, klavyeye yabancı biri) süre mobilde 81, web'de 86–87 sn. Hedefin altında ama pay az.
- KLM, ekranı ilk kez gören birinin arayıp okumaya harcadığı zamanı katmaz. Bu yüzden asıl kanıt gerçek kişiyle süre tutulan deneme olacak.

### Yük aramaktan aramaya (hedef < 3 dokunuş)

Bu akış mobilde, nakliyecinin yük akışında ölçüldü (demo hesabı).

| Akış | Uygulamada dokunuş | Uygulama dışı | Toplam | Tuş | KLM tipik (sn) |
|---|---:|---:|---:|---:|---:|
| Akıştaki kartın "Ara" düğmesi | 1 | 1 | **2** | 0 | 4,1 |
| Kartı açıp yük detayındaki "Ara" | 2 | 1 | 3 | 0 | 6,9 |
| Önce kalkış ilini seçip ("ay" yazıp) karttaki "Ara" | 3 | 1 | 4 | 2 | 9,3 |
| Uygulama yeniden açılınca, hatırlanan rotayla karttaki "Ara" (öneri 3'ten sonra) | 1 | 1 | **2** | 0 | 4,1 |

**Sonuç: olağan kullanımda karşılanıyor.**
- Kartta doğrudan "Ara" var: 2 dokunuş, uygulamada yalnız 1.
- Rota bir kez seçildikten sonra uygulama her açıldığında o rotayla geliyor. Aynı güzergâhta çalışan şoför de 2 dokunuşla arıyor.
- Yeni bir rota seçmek (ilk kez ya da güzergâh değişince) 4 dokunuş tutuyor. Detaydan aramak da 3 dokunuş. Bu iki yol "< 3"ü karşılamıyor.

## Bulgular ve öneriler

İlk üçü 2026-10-16'da uyguladım. Yukarıdaki mobil sayılar bu düzeltmelerden sonraki ölçüm.

1. **Mobil rol ekranında "Nakliyeciyim" önceden seçili geliyor.**
   - Yük sahibi önce o seçimi kaldırmak zorunda; bu fazladan bir dokunuş ve bir karar.
   - Fark etmeyen biri yük sahibi seçimini de ekleyip iki rolle devam edebilir.
   - Öneri: hiçbir rol seçili gelmesin, ya da iki büyük düğme olsun ("Yük veriyorum" / "Aracım var").
   - **Uygulandı:** hiçbiri seçili gelmiyor. İki rolü birden seçebilmek için iki düğme yerine bu yol seçildi. Seçim yapılana kadar "Devam" pasif. Yük sahibi için 3 dokunuş 2'ye indi.
2. **Mobil girişte telefon ve SMS kodu alanları kendiliğinden odaklanmıyor.**
   - Web'de kod alanı odaklanıyor; mobilde 2 dokunuş fazla.
   - Öneri: SMS kodu ekranında kod alanı kendiliğinden odaklansın. Android'in SMS kodu önerisi (`autoComplete="sms-otp"`) zaten var; bu ölçümde sayılmadı.
   - **Uygulandı:** SMS kodu alanı ve yöneticinin doğrulama kodu alanı kendiliğinden odaklanıyor (1 dokunuş azaldı). Telefon alanı ilk ekranda olduğu için değiştirilmedi.
3. **Rota seçerek aramada 4 dokunuş gerekiyor.**
   - Öneri: son seçilen Nereden/Nereye cihazda hatırlansın. Aynı güzergâhta çalışan şoför uygulamayı her açtığında rotayı yeniden seçmez ve akıştan 2 dokunuşla arar.
   - **Uygulandı:** rota cihazda saklanıyor; "Her yer" seçilince unutuluyor. Araç tipi süzgeci hatırlanmıyor.
   - Çevrimdışı liste artık son görülen süzgeçle birlikte saklanıyor ve aynı süzgeçte gösteriliyor. Önceden yalnız filtresiz liste saklanıyordu; hatırlanan rotayla açılan uygulama çevrimdışıyken hiç liste gösteremezdi.
4. **Web'de ilçe seçimi yer yer 5 harf istiyor** (Esenler/Esenyurt).
   - Arama kutulu bir seçici (mobildeki gibi) birkaç tuş kazandırır.
   - Süreye etkisi küçük (~1 sn), öneri değil, not.
