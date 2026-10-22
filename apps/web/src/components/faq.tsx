import { ChevronDown } from "lucide-react";
import { ABUSE_LIMITS, JOB_PARAMS, MODERATION_FREE_AFTER } from "@nakliye/shared";

/**
 * Tanıtım sayfası SSS. Cevaplar platformda gerçekten uygulanan kurallarla aynı; sabit sayılar
 * shared'dan gelir. Teyit aralıkları yöneticinin değiştirebildiği parametre olduğu için sayı verilmez.
 * Yerel <details>: betiksiz açılır, klavyeyle ve ekran okuyucuyla çalışır.
 */
const FAQ: [string, string][] = [
  ["Kullanmak ücretli mi?", "Hayır. Platform tez çalışması kapsamında deneme aşamasında ve kullanım için ücret alınmıyor."],
  [
    "Ödeme platform üzerinden mi yapılıyor?",
    "Hayır. Fiyat, ödeme ve taşımanın kendisi yük sahibiyle nakliyeci arasındadır; platform taşıma sözleşmesinin tarafı değildir.",
  ],
  [
    "Numaram kimlere görünür?",
    `İlan sahibinin numarası listede gizlidir (0532\u00a0***\u00a0**\u00a067 gibi). Nakliyeci “Ara” dediğinde açılır ve bu kayda geçer; bir kişi 24 saatte en çok ${ABUSE_LIMITS.callsPerDay} ilanın numarasını açabilir. Teklif kabul edilince iki taraf birbirinin numarasını görür. Paylaşım bağlantılarında ve güzergâh sayfalarında numara hiç yoktur.`,
  ],
  [
    "İlanın “teyitli” olması ne demek?",
    "İlan sahibine düzenli olarak “hâlâ geçerli mi?” diye sorulur: normalde günde bir, yükleme gününde daha sık. Cevap gelmezse ilan önce “Teyit bekliyor” olur, bir süre sonra listeden düşer. Sahibi “araç bulundu” derse ilan kapanır.",
  ],
  [
    "İlanım hemen yayına çıkar mı?",
    `Yeni hesapların ilk ${MODERATION_FREE_AFTER} ilanı yayından önce kontrol edilir. Sonraki ilanlar ve belgesi onaylanmış hesapların ilanları doğrudan yayına çıkar.`,
  ],
  [
    "Gerçek olmayan bir ilan görürsem ne yapmalıyım?",
    "Uygulamada ilanın sayfasından şikayet edin. Birden çok kişi “yük yok” derse ilan sahibine hemen yeniden teyit sorulur; cevap gelmezse ilan listeden düşer. Haklı bulunan şikayetler ilan sahibinin güven skoruna yansır.",
  ],
  [
    "Teslim kodu nedir?",
    `Teklifi kabul ettiğinizde 6 haneli teslim kodu size SMS ile gelir; kodu yükü teslim alacak kişiye iletin. Yük teslim alınınca kod şoförle paylaşılır, şoför kodu girince teslim onaylanır. Kodu teslimden önce paylaşmayın. Teslimden sonra ${JOB_PARAMS.autoCompleteH} saat içinde itiraz edebilirsiniz; itiraz yoksa taşıma tamamlanır.`,
  ],
  [
    "“Doğrulanmış” işareti nasıl alınır?",
    "Nakliyeci aracının ruhsatını, yük sahibi firmasının vergi levhasını yükler; yönetici onaylayınca işaret görünür. Belgeler herkese açık değildir, yalnız siz ve yönetici görebilir.",
  ],
  [
    "Fiyatı nasıl belirlerim?",
    "İlana fiyat yazabilir ya da teklif usulünü seçebilirsiniz. İlan formu güzergâh ve araç tipine göre yakıt, şoför ve araç giderinden bir fiyat aralığı önerir; otoyol ve köprü ücretleri dahil değildir. Bu aralık tahmindir, bağlayıcı değildir.",
  ],
  [
    "Hangi cihazlarda kullanabilirim?",
    "Yük sahipleri web panelini bilgisayardan ya da telefon tarayıcısından kullanır. Nakliyeci uygulaması Android içindir ve yakında yayımlanacak; iPhone sürümü şimdilik yok.",
  ],
  [
    "Hangi illerde çalışıyor?",
    "İlan Türkiye'nin bütün il ve ilçeleri için verilebilir. Başlangıçta Aydın – İzmir – Manisa – İstanbul hattına odaklanıyoruz.",
  ],
];

export function Faq() {
  return (
    <section id="sss" aria-labelledby="sss-baslik" className="mx-auto max-w-5xl space-y-6 px-4 py-14">
      <h2 id="sss-baslik" className="text-2xl font-bold">
        Sık sorulan sorular
      </h2>
      <div className="max-w-3xl divide-y rounded-lg border">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group px-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium [&::-webkit-details-marker]:hidden">
              {q}
              <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <p className="pb-4 text-sm leading-relaxed text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
