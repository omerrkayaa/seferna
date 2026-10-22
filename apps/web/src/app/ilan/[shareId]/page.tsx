import type { Metadata } from "next";
import Link from "next/link";
import { cache, Suspense } from "react";
import { BadgeCheck, Truck } from "lucide-react";
import { BODY_TYPES, CARGO_TYPES, sharePath, VEHICLE_TYPES } from "@nakliye/shared";
import { LoadStatusBadge } from "@/components/load-status-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { ago, dayRange, place, tl } from "@/lib/format";
import type { SharedLoad } from "@/lib/types";

/** Aynı istekte sayfa ve önizleme kartı tek API çağrısı yapsın. Bulunamazsa null. */
const getShared = cache(async (shareId: string): Promise<SharedLoad | null> => {
  try {
    return await api<SharedLoad>(`/public/loads/${encodeURIComponent(shareId)}`, { auth: false });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
});

const visible = (l: SharedLoad): l is Extract<SharedLoad, { loadFrom: string }> => l.status === "teyitli" || l.status === "teyit_bekliyor";

/** WhatsApp/Telegram önizleme kartı (Open Graph). İlanlar kısa ömürlü: arama motoruna kapalı. */
export async function generateMetadata({ params }: PageProps<"/ilan/[shareId]">): Promise<Metadata> {
  const { shareId } = await params;
  const l = await getShared(shareId);
  const base = { robots: { index: false, follow: false } };
  if (!l) return { ...base, title: "İlan bulunamadı" };
  const title = `${place(l.origin)} → ${place(l.dest)}`;
  const description = visible(l)
    ? `${dayRange(l.loadFrom, l.loadTo)} yükleme · ${l.weightTon} ton ${CARGO_TYPES[l.cargoType]} · ${VEHICLE_TYPES[l.vehicleType]} · ${
        l.priceType === "sabit" && l.price !== null ? tl(l.price) : "Teklif usulü"
      }`
    : "Bu ilan artık yayında değil.";
  return { ...base, title, description, openGraph: { title, description, url: sharePath(shareId), siteName: "Seferna", locale: "tr_TR", type: "website" } };
}

/** FR-16 / F8 paylaşım sayfası: girişsiz; numara yok ("Ara" uygulamada, kayıtlı). */
export default function SharedLoadPage({ params }: PageProps<"/ilan/[shareId]">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-10">
      <Link href="/" className="flex items-center gap-2 text-primary">
        <Truck className="size-6" aria-hidden />
        <span className="font-bold">Seferna</span>
      </Link>
      <Suspense fallback={<p className="text-muted-foreground">Yükleniyor…</p>}>
        <Shared params={params} />
      </Suspense>
    </main>
  );
}

async function Shared({ params }: Pick<PageProps<"/ilan/[shareId]">, "params">) {
  const { shareId } = await params;
  const l = await getShared(shareId);
  if (!l) {
    return (
      <p role="alert" className="rounded-lg border p-4">
        İlan bulunamadı. Bağlantı eksik kopyalanmış olabilir.
      </p>
    );
  }
  if (!visible(l)) {
    return (
      <Card>
        <CardHeader>
          <h1 className="text-lg leading-snug font-semibold">
            {place(l.origin)} → {place(l.dest)}
          </h1>
        </CardHeader>
        <CardContent className="space-y-3">
          <LoadStatusBadge status={l.status} />
          <p>Bu ilan artık yayında değil. Güncel ve teyitli yükler Seferna uygulamasında.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      <Card>
        <CardHeader className="space-y-2">
          <h1 className="text-lg leading-snug font-semibold">
            {place(l.origin)} → {place(l.dest)}
          </h1>
          {/* CardHeader ızgara: rozet tüm genişliğe yayılmasın */}
          <div>
            <LoadStatusBadge status={l.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Yükleme</dt>
            <dd>{dayRange(l.loadFrom, l.loadTo)}</dd>
            <dt className="text-muted-foreground">Yük</dt>
            <dd>
              {CARGO_TYPES[l.cargoType]}, {l.weightTon} ton
            </dd>
            <dt className="text-muted-foreground">Araç</dt>
            <dd>
              {VEHICLE_TYPES[l.vehicleType]}
              {l.bodyType ? `, ${BODY_TYPES[l.bodyType]}` : ""}
            </dd>
            <dt className="text-muted-foreground">Fiyat</dt>
            <dd className="font-semibold">{l.priceType === "sabit" && l.price !== null ? tl(l.price) : "Teklif usulü"}</dd>
            <dt className="text-muted-foreground">Son teyit</dt>
            <dd>{ago(l.lastConfirmedAt)}</dd>
            {l.note && (
              <>
                <dt className="text-muted-foreground">Not</dt>
                <dd>{l.note}</dd>
              </>
            )}
          </dl>
          <p className="flex flex-wrap items-center gap-2 border-t pt-4">
            <span>{l.shipper.displayName ?? "Yük sahibi"}</span>
            {l.shipper.verified && (
              <span className="inline-flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400">
                <BadgeCheck className="size-4" aria-hidden /> Doğrulanmış
              </span>
            )}
          </p>
        </CardContent>
      </Card>
      <section className="space-y-2 rounded-lg bg-muted/60 p-4 text-sm">
        <h2 className="font-semibold">Bu yükü taşımak mı istiyorsunuz?</h2>
        <p>Seferna uygulamasında ilanı açıp yük sahibini arayın ya da teklif verin. İlanlar düzenli olarak sahibine teyit ettirilir; cevapsız kalan ilan yayından kalkar.</p>
        <p>
          Yük sahibi misiniz?{" "}
          <Link href="/giris" className="font-medium text-primary underline-offset-4 hover:underline">
            Siz de ilan verin
          </Link>
        </p>
      </section>
    </>
  );
}
