import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, BellRing, FileSpreadsheet, KeyRound, RefreshCcw, Share2, Smartphone, Star } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AudienceTabs } from "@/components/audience-tabs";
import { Faq } from "@/components/faq";
import { HeroMap } from "@/components/hero-map/hero-map";
import { LiveFeed } from "@/components/live-feed";
import { PriceForm } from "@/components/price-form";
import { ProductShots } from "@/components/product-shots";
import { ReturnPlanSection } from "@/components/return-plan/return-plan-section";
import { RouteForm } from "@/components/route-form";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { buttonVariants } from "@/components/ui/button";
import { PROVINCES, ROUTE_PAGES } from "@/lib/route-pages";

// Arama sonucunda yalnız "Nakliye" görünüyordu (düzenin varsayılan başlığı); başlık ≤ 60, açıklama ≤ 160 karakter
export const metadata: Metadata = {
  title: { absolute: "Teyitli yük ilanları, nakliyeci ve dönüş yükü · Nakliye" },
  description:
    "Yük sahibiyle nakliyeciyi buluşturan platform: sahibine düzenli teyit ettirilen ilanlar, teklif karşılaştırma, kodla teslim ve dönüş yükü önerisi.",
  alternates: { canonical: "/" },
};

const FEATURES: [LucideIcon, string, string][] = [
  [RefreshCcw, "Canlı ilan teyidi", "İlan sahibine düzenli olarak “hâlâ geçerli mi?” diye sorulur. Cevapsız ilan listeden düşer; bayat ilanla vakit kaybetmezsiniz."],
  [BadgeCheck, "Doğrulanmış sahipler", "Yeni hesapların ilk ilanları kontrol edilir; birden çok “yük yok” şikayeti gelen ilan hemen yeniden teyide düşer."],
  [KeyRound, "Teslim kodu ve puan", "Yük, alıcının verdiği 6 haneli kodla teslim edilir. Puan yalnız tamamlanan işten sonra verilir."],
  [BellRing, "Dönüş yükü bildirimi", "Nakliyeci boş aracını ve rotasını bildirir; uyan yük çıkınca haber alır. Boş dönüş azalır."],
  [FileSpreadsheet, "Excel ile toplu ilan", "Çok yük veren firmalar şablonu doldurup tek seferde yayınlar."],
  [Share2, "WhatsApp'ta paylaş", "İlanı tek dokunuşla gruplara gönderin; bağlantı ilanın güncel durumunu gösterir."],
];

/** W1 tanıtım sayfası: değer önerisi, farklar, nasıl çalışır (yük sahibi / nakliyeci sekmeleri), Dönüş Planı canlandırması, rozetlerin anlamı (W3 özeti), canlı yük akışı, panel ve uygulama ekranları, SSS. */
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-5xl space-y-10 px-4 py-14 sm:py-20">
          <div className="space-y-8">
            <div className="max-w-3xl space-y-5">
              <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">Gördüğün her yük gerçek ve şu an geçerli.</h1>
              <p className="text-lg text-muted-foreground">
                Yük sahibiyle nakliyeciyi buluşturan, bayat ilanı listeden düşüren platform. Aydın – İzmir – Manisa – İstanbul hattında başlıyoruz.
              </p>
            </div>
            <div className="space-y-4">
              <RouteForm />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <Link href="/panel" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
                  Yük sahibiyim, panele gir <ArrowRight className="size-4" aria-hidden />
                </Link>
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Smartphone className="size-4" aria-hidden /> Nakliyeci uygulaması (Android) yakında
                </span>
              </div>
            </div>
          </div>
          <HeroMap />
        </section>

        <LiveFeed />

        <section aria-labelledby="farklar" className="border-y bg-muted/30">
          <div className="mx-auto max-w-5xl space-y-8 px-4 py-14">
            <h2 id="farklar" className="text-2xl font-bold">
              Daha az ama gerçek ilan
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(([Icon, title, text]) => (
                <li key={title} className="space-y-2 rounded-lg border bg-background p-5">
                  <Icon className="size-6 text-brand-accent" aria-hidden />
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="nasil-calisir" aria-labelledby="nasil" className="mx-auto max-w-5xl space-y-6 px-4 py-14">
          <h2 id="nasil" className="text-2xl font-bold">
            Nasıl çalışır
          </h2>
          <AudienceTabs />
        </section>

        <ReturnPlanSection />

        <section aria-labelledby="fiyat-baslik" className="mx-auto max-w-5xl space-y-5 px-4 py-14">
          <div className="max-w-2xl space-y-2">
            <h2 id="fiyat-baslik" className="text-2xl font-bold">
              Bu yol ne tutar?
            </h2>
            <p className="text-muted-foreground">İki il seçin; karayolu mesafesini ve araç tipine göre tahmini taşıma ücretini görün.</p>
          </div>
          <div className="max-w-3xl">
            <PriceForm id="ana-fiyat" />
          </div>
        </section>

        <ProductShots />

        <section id="guven" aria-labelledby="guven-baslik" className="border-t bg-muted/30">
          <div className="mx-auto max-w-5xl space-y-6 px-4 py-14">
            <h2 id="guven-baslik" className="text-2xl font-bold">
              Kartlardaki işaretler ne anlama geliyor?
            </h2>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Badge icon={BadgeCheck} term="Doğrulanmış" desc="Hesabın firma ya da kimlik bilgileri kontrol edildi." />
              <Badge icon={RefreshCcw} term="Son teyit" desc="İlan sahibinin ilanın hâlâ geçerli olduğunu en son ne zaman söylediği." />
              <Badge icon={Star} term="Puan ve iş sayısı" desc="Yalnız tamamlanmış taşımalardan; iki taraf da puanlayınca ya da 14 gün dolunca görünür." />
            </dl>
          </div>
        </section>

        <Faq />

        <section aria-labelledby="basla" className="bg-primary text-primary-foreground dark:border-y dark:bg-card dark:text-card-foreground">
          <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-14 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl space-y-2">
              <h2 id="basla" className="text-2xl font-bold">
                Yükünüzü bugün ilan edin
              </h2>
              <p className="text-primary-foreground/80 dark:text-muted-foreground">Teyitli ilanlar, kodla teslim ve yalnız tamamlanan işten puan. Deneme aşamasında kullanmak ücretsiz.</p>
            </div>
            <Link href="/panel/ilanlar/yeni" className={buttonVariants({ variant: "secondary", size: "lg", className: "h-12 shrink-0 px-6 dark:bg-primary dark:text-primary-foreground" })}>
              İlan ver <ArrowRight aria-hidden />
            </Link>
          </div>
        </section>

        <div className="bg-muted/30">
          <nav aria-labelledby="guzergahlar" className="mx-auto max-w-5xl space-y-4 px-4 py-14">
            <h2 id="guzergahlar" className="text-2xl font-bold">
              Güzergâhlar
            </h2>
            {/* Telefonda iki sütun ve görünen metinde "nakliye" yok (bağlantı adında var): tek sütunda 72 bağlantı ~2.400 px'ti */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-6 lg:grid-cols-3">
              {PROVINCES.map((p) => (
                <div key={p.slug} className="space-y-2">
                  <h3 className="font-semibold">{p.name} çıkışlı</h3>
                  <ul className="space-y-1 text-sm">
                    {ROUTE_PAGES.filter((r) => r.from === p).map((r) => (
                      <li key={r.slug}>
                        <Link href={r.path} className="text-primary underline-offset-4 hover:underline">
                          {r.from.name} – {r.to.name}
                          <span className="max-sm:sr-only"> nakliye</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Badge({ icon: Icon, term, desc }: { icon: LucideIcon; term: string; desc: string }) {
  return (
    <div className="space-y-1 rounded-lg border bg-background p-5">
      <dt className="flex items-center gap-2 font-semibold">
        <Icon className="size-5 text-primary" aria-hidden /> {term}
      </dt>
      <dd className="text-sm text-muted-foreground">{desc}</dd>
    </div>
  );
}
