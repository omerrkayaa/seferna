import type { Metadata } from "next";
import { Suspense } from "react";
import { LOAD_DATE_LIMITS, trDay } from "@nakliye/shared";
import { api, ApiError } from "@/lib/api";
import { getLocations } from "@/lib/locations";
import { TR_PROVINCES } from "@/lib/provinces";
import type { LoadDetail, Me } from "@/lib/types";
import { BecomeShipper } from "../../become-shipper";
import { NewLoadForm, type LoadDraft } from "./new-load-form";

export const metadata: Metadata = { title: "Yeni ilan" };

/**
 * P3 ilan oluştur (tek ekran). `?kopya=<ilan>`: eski ilanın bilgileriyle dolu gelir ("Benzerini yayınla").
 * `?nereden=<il>&nereye=<il>` (plaka kodu; tanıtımdaki rota formu ve güzergâh sayfaları): iller seçili gelir.
 */
export default function NewLoadPage({ searchParams }: PageProps<"/panel/ilanlar/yeni">) {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Yeni ilan</h1>
        <p className="text-muted-foreground">İlanınız yayında kaldığı sürece düzenli olarak &quot;hâlâ geçerli mi?&quot; diye sorulur.</p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Yükleniyor…</p>}>
        <Form searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Form({ searchParams }: Pick<PageProps<"/panel/ilanlar/yeni">, "searchParams">) {
  // Önce oturum (dinamik): önbellekli il listesi derlemede değil istekte çağrılsın
  const me = await api<Me>("/me");
  if (!me.roles.includes("shipper")) return <BecomeShipper />;
  const now = new Date();
  const today = trDay(now);
  const maxDay = trDay(new Date(now.getTime() + LOAD_DATE_LIMITS.maxDaysAhead * 86_400_000));
  const { kopya, nereden, nereye } = await searchParams;
  const copied = typeof kopya === "string" ? await copyOf(kopya, today) : undefined;
  const draft = copied ?? routeDraft(nereden, nereye);
  return (
    <>
      {copied && (
        <p role="status" className="rounded-lg border bg-muted/40 p-4 text-sm">
          Bilgiler eski ilanınızdan dolduruldu. Yükleme tarihlerini kontrol edip yayınlayın.
        </p>
      )}
      <NewLoadForm provinces={await getLocations()} today={today} maxDay={maxDay} draft={draft} />
    </>
  );
}

/** Rota formundan gelen iller; listede olmayan değer yok sayılır (ilçe kullanıcı seçer). */
function routeDraft(from: unknown, to: unknown): LoadDraft | undefined {
  const province = (v: unknown) => (typeof v === "string" && TR_PROVINCES.some(([id]) => String(id) === v) ? { provinceId: Number(v) } : undefined);
  const origin = province(from), dest = province(to);
  return origin || dest ? { origin, dest } : undefined;
}

/**
 * Yalnız kendi ilanı kopyalanır: API yayındaki ilanı herkese döner, sahibine ayrıca bekleyen teklif sayısını ekler
 * (başkasının ilanını kopyalayıp yayınlamak sahte ilan üretmeyi kolaylaştırırdı). Bulunamazsa boş form; geçmiş tarihler bugüne çekilir.
 */
async function copyOf(id: string, today: string): Promise<LoadDraft | undefined> {
  let l: LoadDetail;
  try {
    l = await api<LoadDetail>(`/loads/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return undefined;
    throw e;
  }
  if (!("pendingOffers" in l)) return undefined;
  return {
    origin: { provinceId: l.origin.provinceId, districtId: l.origin.districtId },
    dest: { provinceId: l.dest.provinceId, districtId: l.dest.districtId },
    loadFrom: l.loadFrom < today ? today : l.loadFrom,
    loadTo: l.loadTo < today ? today : l.loadTo,
    cargoType: l.cargoType,
    weightTon: String(l.weightTon).replace(".", ","),
    vehicleType: l.vehicleType,
    bodyType: l.bodyType ?? "",
    priceType: l.priceType,
    price: l.price === null ? "" : String(l.price),
    note: l.note ?? "",
  };
}
