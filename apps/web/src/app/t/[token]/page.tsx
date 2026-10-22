import type { Metadata } from "next";
import { Suspense } from "react";
import { Truck } from "lucide-react";
import { CARGO_TYPES, VEHICLE_TYPES } from "@nakliye/shared";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { dayRange, place, tl } from "@/lib/format";
import type { PublicConfirm } from "@/lib/types";
import { AnswerButtons } from "./answer-buttons";

// Token adreste: arama motoruna kapalı ve başka siteye referrer olarak gitmez
export const metadata: Metadata = { title: "İlan teyidi", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** SMS'teki "hâlâ geçerli mi?" linki (F1, docs/04 §5 adım 3): giriş gerektirmez, telefondan tek dokunuş. */
export default function ConfirmPage({ params }: PageProps<"/t/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex items-center gap-2 text-primary">
        <Truck className="size-6" aria-hidden />
        <span className="font-bold">Seferna</span>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Yükleniyor…</p>}>
        <Confirm params={params} />
      </Suspense>
    </main>
  );
}

async function Confirm({ params }: Pick<PageProps<"/t/[token]">, "params">) {
  const { token } = await params;
  let load: PublicConfirm;
  try {
    load = await api<PublicConfirm>(`/public/confirm/${encodeURIComponent(token)}`, { auth: false });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    return (
      <p role="alert" className="rounded-lg border p-4">
        {e.status === 404 ? e.message : "Bir sorun oluştu; biraz sonra tekrar deneyin."}
      </p>
    );
  }
  return (
    <Card>
      <CardHeader>
        {/* CardTitle div çizer; sayfanın başlığı ekran okuyucu için h1 */}
        <h1 className="text-lg leading-snug font-semibold">İlanınız hâlâ geçerli mi?</h1>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="space-y-1">
          <dt className="sr-only">Güzergâh</dt>
          <dd className="text-lg font-semibold">
            {place(load.origin)} → {place(load.dest)}
          </dd>
          <dt className="sr-only">Yükleme ve yük</dt>
          <dd className="text-muted-foreground">
            {dayRange(load.loadFrom, load.loadTo)} · {CARGO_TYPES[load.cargoType]}, {load.weightTon} ton · {VEHICLE_TYPES[load.vehicleType]}
          </dd>
          <dd className="text-muted-foreground">{load.priceType === "sabit" && load.price !== null ? tl(load.price) : "Teklif usulü"}</dd>
        </dl>
        <AnswerButtons token={token} />
      </CardContent>
    </Card>
  );
}
