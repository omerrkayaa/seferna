import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { GUIDES, guide } from "@/lib/guides";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps<"/rehber/[slug]">): Promise<Metadata> {
  const g = guide((await params).slug);
  if (!g) return {};
  const path = `/rehber/${g.slug}`;
  return {
    title: g.title,
    description: g.description,
    alternates: { canonical: path },
    openGraph: { title: g.title, description: g.description, url: path, siteName: "Seferna", locale: "tr_TR", type: "article" },
  };
}

/** Rehber yazısı: içerik lib/guides.tsx'te; son kontrol tarihi, kaynaklar ve "hukuki danışmanlık değildir" notu. */
export default async function GuidePage({ params }: PageProps<"/rehber/[slug]">) {
  const g = guide((await params).slug);
  if (!g) notFound();
  const others = GUIDES.filter((x) => x !== g);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10">
        <nav aria-label="Konum" className="text-sm">
          <Link href="/rehber" className="text-primary underline-offset-4 hover:underline">
            Rehber
          </Link>
        </nav>
        <article className="space-y-8">
          <header className="space-y-3">
            <h1 className="text-3xl font-bold text-balance sm:text-4xl">{g.title}</h1>
            <p className="text-lg text-muted-foreground">{g.description}</p>
            <p className="text-sm text-muted-foreground">Son kontrol: {g.checked}</p>
          </header>
          <div className="space-y-8 leading-relaxed [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p+p]:mt-3 [&_section>*+*]:mt-3 [&_ul]:space-y-1.5">
            {g.body}
          </div>
          <footer className="space-y-3 rounded-lg border bg-muted/40 p-5 text-sm">
            {g.sources.length > 0 && (
              <>
                <h2 className="font-semibold">Kaynaklar</h2>
                <ul className="space-y-1">
                  {g.sources.map((s) => (
                    <li key={s.href} className="ml-5 list-disc">
                      <a href={s.href} className="text-primary underline-offset-4 hover:underline" rel="noopener noreferrer" target="_blank">
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="text-muted-foreground">
              Bu yazı bilgilendirme amaçlıdır, hukuki ya da mali danışmanlık değildir. Mevzuat değişebilir; işlem yapmadan önce güncel metne ya da ilgili
              odaya danışın.
            </p>
          </footer>
        </article>
        <nav aria-labelledby="diger-rehber" className="space-y-2">
          <h2 id="diger-rehber" className="text-lg font-semibold">
            Diğer rehberler
          </h2>
          <ul className="space-y-1">
            {others.map((x) => (
              <li key={x.slug}>
                <Link href={`/rehber/${x.slug}`} className="text-primary underline-offset-4 hover:underline">
                  {x.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <SiteFooter />
    </>
  );
}
