import type { Metadata } from "next";
import Link from "next/link";
import { cache, Suspense } from "react";
import { ArrowRight, BadgeCheck, CalendarDays, PackageCheck, ShieldCheck, Star, Truck } from "lucide-react";
import { BODY_TYPES, VEHICLE_TYPES } from "@nakliye/shared";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { buttonVariants } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type { PublicCarrier } from "@/lib/types";

/** Aynı istekte sayfa ve önizleme kartı tek API çağrısı yapsın. Profil kapalıysa ya da yoksa null. */
const getCarrier = cache(async (id: string): Promise<PublicCarrier | null> => {
  try {
    return await api<PublicCarrier>(`/public/carriers/${encodeURIComponent(id)}`, { auth: false });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
});

// BR-10 nakliyeci seviyeleri (shared verificationLevel)
const LEVELS = ["Belgeleri henüz onaylanmadı", "Araç ruhsatı onaylı", "Ruhsat, K belgesi ve SRC onaylı"] as const;

/** Paylaşım önizlemesi var; arama motoruna kapalı (profil paylaşmak için açılır, dizine eklenmesi ayrıca kararlaştırılmadı). */
export async function generateMetadata({ params }: PageProps<"/nakliyeci/[id]">): Promise<Metadata> {
  const c = await getCarrier((await params).id);
  const base = { robots: { index: false, follow: false } };
  if (!c) return { ...base, title: "Profil bulunamadı" };
  const description = `${c.completedJobs} tamamlanmış iş${c.rating === null ? "" : ` · ${c.rating.toLocaleString("tr-TR")} puan`} · ${LEVELS[c.verificationLevel]}`;
  return { ...base, title: c.title, description, openGraph: { title: c.title, description, siteName: "Seferna", locale: "tr_TR", type: "profile" } };
}

/** Herkese açık nakliyeci profili (karar 2026-10-17): nakliyeci kendisi açar; telefon ve kişi adı gösterilmez. */
export default function CarrierProfilePage({ params }: PageProps<"/nakliyeci/[id]">) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10">
        {/* Profil için yer ayrılır (ölçülen: 390 px'te ~950, sm ve üstünde 690 px): yoksa profil gelince alt bilgi kayıyordu (CLS) */}
        <Suspense fallback={<p className="min-h-[760px] text-muted-foreground sm:min-h-[690px]">Yükleniyor…</p>}>
          <Profile params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

async function Profile({ params }: Pick<PageProps<"/nakliyeci/[id]">, "params">) {
  const c = await getCarrier((await params).id);
  if (!c) {
    return (
      <p role="alert" className="rounded-lg border p-4">
        Profil bulunamadı. Nakliyeci profilini kapatmış ya da bağlantı eksik kopyalanmış olabilir.
      </p>
    );
  }
  const since = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(c.memberSince));
  return (
    <>
      <div className="space-y-3">
        <p className="text-sm font-semibold text-orange-700 dark:text-brand-accent">Nakliyeci</p>
        <h1 className="text-3xl font-bold text-balance sm:text-4xl">{c.title}</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1">
            <ShieldCheck className="size-4 text-primary" aria-hidden /> {LEVELS[c.verificationLevel]}
          </span>
          {c.companyVerified && (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1">
              <BadgeCheck className="size-4 text-primary" aria-hidden /> Vergi levhası onaylı
            </span>
          )}
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <Stat icon={PackageCheck} term="Tamamlanan iş" value={String(c.completedJobs)} />
        <Stat icon={Star} term="Puan" value={c.rating === null ? "Henüz yok" : `${c.rating.toLocaleString("tr-TR")} / 5`} note={c.ratingCount > 0 ? `${c.ratingCount} puan` : undefined} />
        {/* "... den/dan beri" eki yılın okunuşuna bağlı; ek yerine başlık */}
        <Stat icon={CalendarDays} term="Üyelik başlangıcı" value={since} />
      </dl>

      <section aria-labelledby="araclar" className="space-y-3">
        <h2 id="araclar" className="text-xl font-semibold">
          Araçlar
        </h2>
        {c.vehicles.length === 0 ? (
          <p className="text-muted-foreground">Kayıtlı araç yok.</p>
        ) : (
          <ul className="space-y-2">
            {c.vehicles.map((v) => (
              <li key={v.vehicleType} className="flex items-start gap-3 rounded-lg border bg-card p-4">
                <Truck className="mt-0.5 size-5 shrink-0 text-brand-accent" aria-hidden />
                <span>
                  <span className="font-medium">
                    {v.count} {VEHICLE_TYPES[v.vehicleType]}
                  </span>
                  <span className="block text-sm text-muted-foreground">{v.bodyTypes.map((b) => BODY_TYPES[b]).join(", ")}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="calis" className="space-y-3 rounded-lg bg-muted/60 p-5">
        <h2 id="calis" className="text-lg font-semibold">
          Bu nakliyeciyle çalışmak ister misiniz?
        </h2>
        <p className="text-sm">
          İletişim bilgileri burada gösterilmez. İlanınızı verin; nakliyeciler teklif verir ya da sizi arar. Daha önce birlikte iş yaptıysanız panelde
          Nakliyecilerim&apos;den favorilere ekleyebilirsiniz; yeni ilanınız ona bildirilir.
        </p>
        <Link href="/panel/ilanlar/yeni" className={buttonVariants({ className: "h-11 px-5" })}>
          İlan ver <ArrowRight aria-hidden />
        </Link>
      </section>
      <p className="text-xs text-muted-foreground">
        Bu profili nakliyeci kendisi yayımladı. Puan ve iş sayısı yalnız platformda tamamlanmış taşımalardan hesaplanır.
      </p>
    </>
  );
}

function Stat({ icon: Icon, term, value, note }: { icon: typeof Star; term: string; value: string; note?: string }) {
  return (
    <div className="space-y-1 rounded-lg border p-4">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" aria-hidden /> {term}
      </dt>
      <dd className="text-xl font-semibold">{value}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}
