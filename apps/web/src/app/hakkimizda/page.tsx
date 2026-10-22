import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, KeyRound, LayoutDashboard, RefreshCcw, Route } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Hakkımızda",
  description: "Neden “daha az ama gerçek ilan” diyoruz, neyi bilerek yapmıyoruz ve platformu kim geliştiriyor.",
  alternates: { canonical: "/hakkimizda" },
};

// Her madde uygulamada var olan bir özelliğe karşılık gelir.
const DIFFERENCES: [LucideIcon, string, string][] = [
  [RefreshCcw, "İlan teyit edilir", "Sahibi “hâlâ geçerli” demeyen ilan listeden düşer; kartta son teyidin ne zaman olduğu yazar."],
  [BadgeCheck, "İlanı sahibi verir", "Başka yerden toplanmış ilan yok; her ilan telefonu doğrulanmış bir hesaptan gelir."],
  [KeyRound, "Puan yalnız tamamlanan işten", "Yük, alıcının kodu girilince teslim edilmiş sayılır; puan ancak ondan sonra verilir."],
  [Route, "Dönüş yükü", "Nakliyecinin dönüş yolunun üstündeki yükler, iş sürerken önüne gelir."],
  [LayoutDashboard, "Yük sahibine web paneli", "Masaüstünden ilan, Excel ile toplu ilan ve teklifleri yan yana karşılaştırma."],
];

const NOT_DOING = [
  "WhatsApp gruplarından ya da başka sitelerden ilan toplamıyoruz.",
  "Ödemeye aracılık etmiyoruz: fiyat, ödeme ve taşıma yük sahibiyle nakliyeci arasındadır.",
  "Konum takibi yapmıyoruz: konum yalnız \"Yakınımdakiler\"e dokununca bir kez alınır, saklanmaz ve arka planda izlenmez.",
];

/** Hakkımızda: neden, nasıl farklı, bilerek yapmadıklarımız, kim geliştiriyor. */
export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-12 px-4 py-10">
        <div className="space-y-4">
          <h1 className="text-3xl font-bold sm:text-4xl">Hakkımızda</h1>
          <p className="text-lg text-muted-foreground">
            Yük sahibiyle nakliyeciyi buluşturan bir platform yapıyoruz. Tek bir sözümüz var: gördüğün her yük gerçek ve şu an geçerli.
          </p>
        </div>

        <section aria-labelledby="neden" className="space-y-3">
          <h2 id="neden" className="text-2xl font-bold">
            Neden?
          </h2>
          <p>
            Seferna fikri, bir tanıdığımızın evini taşırken şoförle sohbet ederken doğdu. Ardından nakliye ilan uygulamalarının kullanıcı yorumlarını
            okuduk.
          </p>
          <p>
            Yorumlarda en sık şu şikayetlerle karşılaştık: aylar önce verilmiş ve çoktan gitmiş ilanlar, yükü
            olmayan sahte ilanlar ve telefonu açmayan ilan sahipleri. Üçünün kökü aynı: ilanın gerçek ve güncel olduğundan emin olunamaması.
          </p>
          <p>
            Bazı platformlar ilan sayısını artırmak için başka kaynaklardan ilan topluyor; bu da bayat ilan sorununu büyütüyor. Biz tersini seçtik:{" "}
            <strong>daha az ama gerçek ilan.</strong>
          </p>
        </section>

        <section aria-labelledby="fark" className="space-y-4">
          <h2 id="fark" className="text-2xl font-bold">
            Neyi farklı yapıyoruz?
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {DIFFERENCES.map(([Icon, title, text]) => (
              <li key={title} className="space-y-1.5 rounded-lg border bg-card p-4">
                <p className="flex items-center gap-2 font-semibold">
                  <Icon className="size-5 text-brand-accent" aria-hidden /> {title}
                </p>
                <p className="text-sm text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="yapmadiklarimiz" className="space-y-3">
          <h2 id="yapmadiklarimiz" className="text-2xl font-bold">
            Bilerek yapmadıklarımız
          </h2>
          <ul className="space-y-2">
            {NOT_DOING.map((t) => (
              <li key={t} className="ml-5 list-disc">
                {t}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="kim" className="space-y-3">
          <h2 id="kim" className="text-2xl font-bold">
            Kim geliştiriyor?
          </h2>
          <p>
            Seferna&apos;yı Bilgisayar Mühendisliği son sınıf öğrencisi Ömer Kaya geliştiriyor. Şu an deneme aşamasında ve kullanmak ücretsiz. Aydın – İzmir –
            Manisa – İstanbul hattında başlıyoruz.
          </p>
          <p>Görüşünüzü duymak isteriz: özellikle nakliyecilerin ve yük sahiplerinin sahadaki deneyimi platformu doğrudan şekillendiriyor.</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
            <Link href="/iletisim" className={buttonVariants({ className: "h-11 px-5" })}>
              Bize ulaşın <ArrowRight aria-hidden />
            </Link>
            <Link href="/#nasil-calisir" className="text-sm text-primary underline-offset-4 hover:underline">
              Nasıl çalışır
            </Link>
            <a href="https://www.instagram.com/omerkay_aa/" className="text-sm text-primary underline-offset-4 hover:underline">
              Instagram: @omerkay_aa
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
