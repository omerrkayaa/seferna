import { Suspense } from "react";
import { CARGO_TYPES, VEHICLE_TYPES } from "@nakliye/shared";
import { LoadStatusBadge } from "@/components/load-status-badge";
import { api } from "@/lib/api";
import { ago, dayRange, place } from "@/lib/format";
import type { PublicFeed } from "@/lib/types";

const tons = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

/**
 * Tanıtımdaki canlı yük akışı (karar 2026-10-16): en son teyit edilen ilanlar, istek anında.
 * Sayfa kabuğu statik kalır, akış sonradan gelir. Anonim: numara, ilan sahibi, fiyat ve ilana bağlantı yok.
 */
export function LiveFeed() {
  return (
    <section aria-labelledby="akis-baslik" className="border-t">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-14">
        {/* Kartlar için yer ayrılır (ölçülen ızgara: telefonda 3 kart 488, sm 512, lg 344 px): 1920×1080'de akış ekranda,
            kartlar sonradan gelince altındaki bölümler kayardı */}
        <Suspense
          fallback={
            <>
              <FeedShell title="Şu an yayındaki ilanlar" />
              <div aria-hidden className="min-h-[488px] sm:min-h-[512px] lg:min-h-[344px]" />
            </>
          }
        >
          <Feed />
        </Suspense>
      </div>
    </section>
  );
}

async function Feed() {
  let feed: PublicFeed;
  try {
    feed = await api<PublicFeed>("/public/feed", { auth: false });
  } catch {
    return <FeedShell title="Şu an yayındaki ilanlar" note="İlanlar şu an yüklenemedi." />;
  }
  if (feed.loads.length === 0) return <FeedShell title="Şu an yayında ilan yok" note="İlk ilanı siz verin; yukarıdaki formdan başlayabilirsiniz." />;
  const now = Date.now();
  return (
    <>
      <FeedShell title={`Şu an yayında ${feed.activeLoads} ilan`} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="feed">
        {feed.loads.map((l, i) => (
          // Telefonda ilk üçü (altı kart alt alta sayfayı ~1000 px uzatıyordu)
          <li key={i} className={`space-y-3 rounded-lg border bg-background p-5 ${i >= 3 ? "max-sm:hidden" : ""}`}>
            <p className="font-semibold">
              {place(l.origin)} → {place(l.dest)}
            </p>
            <p className="text-sm text-muted-foreground">
              {CARGO_TYPES[l.cargoType]} · {tons.format(l.weightTon)} ton · {VEHICLE_TYPES[l.vehicleType]}
              <br />
              Yükleme: {dayRange(l.loadFrom, l.loadTo)}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <LoadStatusBadge status={l.status} />
              <span>
                Son teyit <time dateTime={l.lastConfirmedAt}>{ago(l.lastConfirmedAt, now)}</time>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function FeedShell({ title, note }: { title: string; note?: string }) {
  return (
    <div className="space-y-2">
      <h2 id="akis-baslik" className="text-2xl font-bold">
        {title}
      </h2>
      <p className="max-w-3xl text-muted-foreground">
        {note ??
          "En son teyit edilen ilanlar. Numara ve ilan sahibi burada gösterilmez; nakliyeciler ilanları uygulamada görür, arar ya da teklif verir."}
      </p>
    </div>
  );
}
