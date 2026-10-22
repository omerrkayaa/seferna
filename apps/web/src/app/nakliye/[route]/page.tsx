import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowRight, Smartphone } from "lucide-react";
import { PriceTable } from "@/components/price-table";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";
import { ROUTE_PAGES, routePage, type RoutePage } from "@/lib/route-pages";
import type { RouteSummary } from "@/lib/types";

/** Koridordaki güzergâhlar derlemede hazırlanır; listede olmayan adresi proxy render'dan önce 404'e çevirir. */
export function generateStaticParams() {
  return ROUTE_PAGES.map((r) => ({ route: r.slug }));
}

export async function generateMetadata({ params }: PageProps<"/nakliye/[route]">): Promise<Metadata> {
  const r = routePage((await params).route);
  if (!r) return {};
  const title = `${r.from.name} ${r.to.name} nakliye`;
  const description = `${r.from.name} → ${r.to.name} yük taşıma: araç tipine göre tahmini ücret aralığı, karayolu mesafesi ve şu an yayındaki ilan sayısı.`;
  return {
    title,
    description,
    alternates: { canonical: r.path },
    openGraph: { title, description, url: r.path, siteName: "Seferna", locale: "tr_TR", type: "website" },
  };
}

/** W2 güzergâh sayfası: arama motoruna açık. Yayındaki ilan sayısı ve F7 fiyat aralığı istek anında. */
export default async function RouteLandingPage({ params }: PageProps<"/nakliye/[route]">) {
  const r = routePage((await params).route);
  if (!r) notFound();
  const reverse = routePage(`${r.to.slug}-${r.from.slug}`);
  // Hepsi (71) çok uzun: ters yön, aynı ilden çıkanlar ve aynı ile varanlar
  const groups = [
    { title: `${r.from.name} çıkışlı`, routes: ROUTE_PAGES.filter((x) => x !== r && x.from === r.from) },
    { title: `${r.to.name} varışlı`, routes: ROUTE_PAGES.filter((x) => x !== r && x.to === r.to) },
  ];
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-4 py-10">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-balance sm:text-4xl">
            {r.from.name} – {r.to.name} nakliye
          </h1>
          <p className="text-lg text-muted-foreground">
            {r.from.name} çıkışlı, {r.to.name} varışlı yükler: yayındaki ilanlar ve araç tipine göre tahmini taşıma ücreti.
          </p>
        </div>

        {/* İlan sayısı + fiyat tablosu için yer ayrılır (ölçülen: 390 px'te 539, sm ve üstünde 479 px): yoksa sonradan
            gelince altındaki "İlan ver" kutusu ve güzergâh listesi aşağı kayıyordu (CLS, telefonda 0,31) */}
        <Suspense fallback={<p className="min-h-[539px] text-muted-foreground sm:min-h-[479px]">Güncel bilgiler yükleniyor…</p>}>
          <Live route={r} />
        </Suspense>

        <section aria-labelledby="ilan-ver" className="space-y-3 rounded-lg bg-muted/60 p-5">
          <h2 id="ilan-ver" className="text-lg font-semibold">
            Bu güzergâhta yükünüz mü var?
          </h2>
          <p className="text-sm">
            İlanınızı verin; nakliyeciler sizi arasın ya da teklif versin. İlanlar düzenli olarak sahibine teyit ettirilir, bayat ilan listede kalmaz.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/panel/ilanlar/yeni?nereden=${r.from.id}&nereye=${r.to.id}`} className={buttonVariants({ className: "h-11 px-5" })}>
              Yük ilanı ver <ArrowRight aria-hidden />
            </Link>
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Smartphone className="size-4" aria-hidden /> Nakliyeci uygulaması (Android) yakında
            </span>
          </div>
        </section>

        <nav aria-labelledby="diger" className="space-y-3">
          <h2 id="diger" className="text-lg font-semibold">
            Diğer güzergâhlar
          </h2>
          {reverse && (
            <p>
              Ters yön:{" "}
              <Link href={reverse.path} className="text-primary underline-offset-4 hover:underline">
                {reverse.from.name} – {reverse.to.name} nakliye
              </Link>
            </p>
          )}
          <div className="grid gap-6 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.title} className="space-y-2">
                <h3 className="font-semibold">{g.title}</h3>
                <ul className="space-y-1">
                  {g.routes.map((x) => (
                    <li key={x.slug}>
                      <Link href={x.path} className="text-primary underline-offset-4 hover:underline">
                        {x.from.name} – {x.to.name} nakliye
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      </main>
      <SiteFooter />
    </>
  );
}

async function Live({ route }: { route: RoutePage }) {
  const s = await api<RouteSummary>(`/public/routes/${route.from.id}/${route.to.id}`, { auth: false });
  return (
    <>
      <section aria-labelledby="ilanlar" className="space-y-2 rounded-lg border p-5">
        <h2 id="ilanlar" className="text-2xl font-bold" data-testid="active-loads">
          {s.activeLoads > 0 ? `Şu an yayında ${s.activeLoads} ilan` : "Şu an yayında ilan yok"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Yükleme günü geçmemiş, sahibine düzenli teyit ettirilen ilanlar. Nakliyeciler ilanları uygulamada görür; yük sahibini arar ya da teklif verir.
        </p>
      </section>

      <section aria-labelledby="fiyat" className="space-y-3">
        <h2 id="fiyat" className="text-xl font-semibold">
          Tahmini taşıma ücreti
        </h2>
        <PriceTable summary={s} />
      </section>
    </>
  );
}
