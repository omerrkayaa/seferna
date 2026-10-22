import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileSpreadsheet, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";
import { ago, dayRange, place } from "@/lib/format";
import type { Me, ShipperSummary } from "@/lib/types";
import { cn } from "cn";
import { BecomeShipper } from "./become-shipper";
import { ConfirmButton } from "./ilanlar/confirm-button";

export const metadata: Metadata = { title: "Gösterge" };

/** P2 gösterge paneli: yayındaki ilanlar, teyit bekleyenler, gelen teklifler, bu ayki taşımalar. */
export default function Dashboard({ searchParams }: PageProps<"/panel">) {
  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <Reopened searchParams={searchParams} />
      </Suspense>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold">Gösterge</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/panel/ilanlar/toplu" className={buttonVariants({ variant: "outline", className: "h-11 px-5" })}>
            <FileSpreadsheet aria-hidden /> Excel ile toplu ilan
          </Link>
          <Link href="/panel/ilanlar/yeni" className={buttonVariants({ className: "h-11 px-5" })}>
            <Plus aria-hidden /> Yeni ilan
          </Link>
        </div>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Yükleniyor…</p>}>
        <Summary />
      </Suspense>
    </div>
  );
}

/** Girişte hesap yeniden açıldıysa not (FR-08 dondurma, FR-07 silinen hesabın süresi içinde dönüşü) */
async function Reopened({ searchParams }: Pick<PageProps<"/panel">, "searchParams">) {
  const { acildi } = await searchParams;
  const text =
    acildi === "dondurma"
      ? "Hesabınız yeniden açıldı. Dondururken kapanan ilanlarınızı “Benzerini yayınla” ile yeniden açabilirsiniz."
      : acildi === "silme"
        ? "Hesabınız puanları ve geçmişiyle yeniden açıldı. Adınızı, firma ve araç bilgilerinizi yeniden girin."
        : null;
  return (
    text && (
      <p role="status" className="rounded-md bg-muted p-3 text-sm">
        {text}
      </p>
    )
  );
}

async function Summary() {
  const me = await api<Me>("/me");
  if (!me.roles.includes("shipper")) return <BecomeShipper />;
  const s = await api<ShipperSummary>("/loads/mine/summary");
  const empty = s.loads.visible + s.loads.moderation + s.jobs.active + s.jobs.completed + s.jobs.cancelled === 0;

  return (
    <div className="space-y-8">
      {empty && (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          Yayında ilanınız yok.{" "}
          <Link href="/panel/ilanlar/yeni" className="font-medium text-primary underline-offset-4 hover:underline">
            Yeni ilan verin
          </Link>
          ; uygun boş aracı olan nakliyeciler bilgilendirilir.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile href="/panel/ilanlar" label="Yayındaki ilan" value={s.loads.visible} note={s.loads.moderation > 0 ? `${s.loads.moderation} ilan onay bekliyor` : "İlanlarım"} />
        <Tile
          href="#teyit"
          label="Teyit bekleyen"
          value={s.loads.awaiting}
          note={s.loads.awaiting > 0 ? "Cevaplanmazsa ilan listeden düşer" : "Hepsi güncel"}
          warn={s.loads.awaiting > 0}
        />
        <Tile href="#teklifler" label="Bekleyen teklif" value={s.offers.pending} note={s.offers.loads.length > 0 ? `${s.offers.loads.length} ilanda` : "Henüz teklif yok"} />
        <Tile
          href="/panel/tasimalar"
          label="Bu ay tamamlanan taşıma"
          value={s.jobs.completed}
          note={`${s.jobs.active} süren${s.jobs.cancelled > 0 ? ` · ${s.jobs.cancelled} iptal` : ""}`}
        />
      </div>

      {s.awaitingConfirmation.length > 0 && (
        <section id="teyit" aria-labelledby="teyit-baslik" className="space-y-3">
          <h2 id="teyit-baslik" className="text-lg font-semibold">
            Teyit bekleyen ilanlar
          </h2>
          <p className="text-sm text-muted-foreground">Yük hâlâ duruyorsa &quot;Hâlâ geçerli&quot; deyin; araç bulduysanız ilan sayfasından kapatın.</p>
          <ul className="divide-y rounded-lg border">
            {s.awaitingConfirmation.map((l) => (
              <li key={l.id} data-load-id={l.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <Link href={`/panel/ilanlar/${l.id}`} className="font-medium underline-offset-4 hover:underline">
                    {place(l.origin)} → {place(l.dest)}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {dayRange(l.loadFrom, l.loadTo)} · son teyit {ago(l.lastConfirmedAt)}
                  </p>
                </div>
                <ConfirmButton id={l.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.offers.loads.length > 0 && (
        <section id="teklifler" aria-labelledby="teklif-baslik" className="space-y-3">
          <h2 id="teklif-baslik" className="text-lg font-semibold">
            Teklif gelen ilanlar
          </h2>
          <ul className="divide-y rounded-lg border">
            {s.offers.loads.map((l) => (
              <li key={l.id} data-load-id={l.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">
                    {place(l.origin)} → {place(l.dest)}
                  </p>
                  <p className="text-sm text-muted-foreground">{dayRange(l.loadFrom, l.loadTo)}</p>
                </div>
                <Link href={`/panel/ilanlar/${l.id}#teklifler`} className={buttonVariants({ variant: "outline", className: "h-11" })}>
                  {l.pendingOffers} teklifi karşılaştır
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Tile({ href, label, value, note, warn }: { href: string; label: string; value: number; note: string; warn?: boolean }) {
  return (
    <Link
      href={href}
      className={cn("block space-y-1 rounded-lg border p-4 transition-colors hover:bg-muted/50", warn && "border-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30")}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </Link>
  );
}
