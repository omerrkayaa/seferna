# Nakliye — Android uygulaması (Expo)

Expo SDK 57 · Expo Router · React Native 0.86. Nakliyeci ve yük sahibi ekranları; sekmeler role göre:
nakliyeci **Yükler · Dönüş Planı**, yük sahibi **İlanlarım** (ilan verme oradan), ortak **İşlerim · Profil**. Bildirimler sağ üstteki zilde.

Henüz yok: gerçek push bildirimi (FCM; Firebase projesi ve geliştirme derlemesi gerekir — Expo Go Android'de uzak bildirimi
desteklemiyor), belge fotoğrafı yükleme (dosya deposu kararı). Bildirimler uygulama içi kutuda.

## Telefonda demo (Expo Go)

1. Bilgisayarda: veritabanı + API açık olmalı (`apps/api`, port 3000). Demo verisi: `cd apps/api && npm run db:seed-demo`.
2. `cd apps/mobile && npx expo start`
3. Telefona Play Store'dan **Expo Go** kurun, telefon bilgisayarla **aynı Wi-Fi**'da olsun, terminaldeki QR kodu okutun.
4. Giriş ekranında **Demo hesabıyla gir** (numara `0555 010 20 30`, kod `123456`; yalnız geliştirmede) — demo nakliyeci.
   Yük sahibi tarafını denemek için kendi numaranızla girip "Yük sahibiyim"i seçin; SMS kodu API'nin konsol çıktısında
   (`[SMS → +90…] Nakliye giriş kodunuz: …`). Yeni hesabın ilk ilanı yönetici onayı bekler (BR-11).

Bağlanamazsa:
- Windows Güvenlik Duvarı Node.js'e özel ağda izin vermeli (3000 ve 8081 portları).
- Bilgisayarda birden çok ağ adresi var (WSL 172.31.x). QR yanlış adresi gösterirse:
  `REACT_NATIVE_PACKAGER_HOSTNAME=<bilgisayarın Wi-Fi IP'si> npx expo start`
- API adresi Metro'nun adresinden türetilir (`<aynı IP>:3000`); farklıysa `EXPO_PUBLIC_API_URL` verin.
- Okul/iş ağları (ör. eduroam) cihazların birbirini görmesine izin vermeyebilir: telefonun hotspot'una bilgisayarı bağlayın
  (aradaki trafik mobil veriden düşmez; bilgisayarda "Ölçülü bağlantı"yı açın: `netsh wlan set profileparameter name="<ağ adı>" cost=Fixed`).
- **iPhone (2026-10-09 denendi):** App Store'daki Expo Go, "You need to be signed in" der → ücretsiz Expo hesabıyla hem Expo Go'da
  hem bilgisayarda `npx expo login` (PowerShell betik engeli verirse `npx.cmd expo login`). QR yoksa Safari'ye `exp://<IP>:8081` yazın.

## Komutlar
| Komut | Ne yapar |
|---|---|
| `npx expo start` | Geliştirme sunucusu (Expo Go) |
| `npx expo start --web` | Tarayıcıda dene (API CORS açmadığı için yalnız test tarayıcısında, güvenlik kapalı) |
| `npm run typecheck` / `npx expo lint` | Tip ve lint kontrolü |
| `npm run test:e2e` | Uçtan uca testler (6 test; Playwright, sistem Chrome, 390 px). Ön koşul: API `JOBS_ENABLED=false` ile çalışıyor ve çıktısı `apps/api/api.log`'da; `CI=1 npx expo start --web --port 8081` açık (**CI=1'de dosya izlenmez: kod değişince yeniden başlatın**). Demo verisini kendisi tazeler. `SHOTS=<klasör>` verilirse ekran görüntüsü alır. |

Paket eklerken `npx expo install <paket>` kullanın (SDK uyumlu sürüm). React sürümü kökteki `overrides` ile 19.2.3'e sabit: React Native tam sürüm eşleşmesi ister, web de aynı sürümü kullanır.
