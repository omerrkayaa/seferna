// Boş km ölçüsü için ilçe merkezleri arası karayolu mesafesi.
// Kaynak: yerel OSRM (table servisi) → veri/ altına bir kez önbelleğe yazılır. OSRM yoksa kuş uçuşu × 1,3 (API'deki
// RoutesService ile aynı yedek). NOT: eşleştirme UYGUNLUĞU bu katmanı kullanmaz; o shared matchLoadWithCapacity'nin
// kuş uçuşu (haversine) ölçüsüyle verilir (sistemde PostGIS ST_DWithin + shared kesin karar).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { haversineKm } from "@nakliye/shared";
import { ilceKonum, type KonumVerisi } from "./konum.js";

export const YOL_KATSAYISI = 1.3;
export const OSRM_URL = process.env.OSRM_URL ?? "http://localhost:5000";

const VERI_DIZINI = fileURLToPath(new URL("../veri/", import.meta.url));
const MATRIS_DOSYASI = `${VERI_DIZINI}osrm-ilce-matrisi.bin`;
const META_DOSYASI = `${VERI_DIZINI}osrm-ilce-matrisi.json`;

/** Matriste hm (100 m) cinsinden Uint16; rota yoksa bu değer */
const YOK = 0xffff;

export interface MatrisMeta {
  kaynak: "osrm";
  osrmUrl: string;
  olusturma: string;
  /** Matris satır/sütun sırası (ilçe kimlikleri) */
  ilceIdleri: number[];
  birim: "hektometre (100 m), Uint16 little-endian, satır = kaynak, sütun = hedef";
  rotaBulunamayan: number;
  sure_sn: number;
}

export interface Mesafe {
  tur: "osrm" | "haversine";
  aciklama: string;
  /** a ilçe merkezinden b ilçe merkezine yol km (yönlü) */
  km(a: number, b: number): number;
  /** OSRM'in rota bulamayıp haversine × 1,3'e düşülen çift sayısı (yalnız osrm) */
  yedekSayisi: number;
}

export function haversineMesafe(k: KonumVerisi): Mesafe {
  return {
    tur: "haversine",
    aciklama: `kuş uçuşu (haversine) × ${YOL_KATSAYISI}`,
    km: (a, b) => (a === b ? 0 : haversineKm(ilceKonum(k, a), ilceKonum(k, b)) * YOL_KATSAYISI),
    yedekSayisi: 0,
  };
}

function osrmMesafe(k: KonumVerisi, meta: MatrisMeta, veri: Uint16Array): Mesafe {
  const n = meta.ilceIdleri.length;
  const sira = new Map(meta.ilceIdleri.map((id, i) => [id, i]));
  const yedek = haversineMesafe(k);
  return {
    tur: "osrm",
    aciklama: `OSRM karayolu (${meta.osrmUrl}, ${meta.olusturma.slice(0, 10)} tarihli önbellek; rota bulunamayan ${meta.rotaBulunamayan} çift kuş uçuşu × ${YOL_KATSAYISI})`,
    km(a, b) {
      if (a === b) return 0;
      const i = sira.get(a);
      const j = sira.get(b);
      if (i === undefined || j === undefined) throw new Error(`Matriste olmayan ilçe: ${a} / ${b}`);
      const v = veri[i * n + j]!;
      return v === YOK ? yedek.km(a, b) : v / 10;
    },
    yedekSayisi: meta.rotaBulunamayan,
  };
}

export async function osrmCalisiyorMu(url = OSRM_URL): Promise<boolean> {
  try {
    const r = await fetch(`${url}/table/v1/driving/27.84,37.85;27.14,38.42?annotations=distance`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    const j = (await r.json()) as { code?: string };
    return j.code === "Ok";
  } catch {
    return false;
  }
}

/**
 * 973 × 973 ilçe matrisini OSRM'den parça parça alır. osrm-routed'ın varsayılan tablo sınırı 100 koordinat olduğundan
 * her istek 50 kaynak + 50 hedef içerir (20 × 20 = 400 istek). Yalnız okuma (GET /table).
 */
export async function osrmMatrisiOlustur(k: KonumVerisi, url = OSRM_URL, blok = 50): Promise<MatrisMeta> {
  const basla = performance.now();
  const ids = k.ilceler.map((d) => d.id);
  const n = ids.length;
  const veri = new Uint16Array(n * n).fill(YOK);
  const koord = k.ilceler.map((d) => `${d.lon.toFixed(6)},${d.lat.toFixed(6)}`);
  let rotaYok = 0;

  const isler: [number, number][] = [];
  for (let i0 = 0; i0 < n; i0 += blok) for (let j0 = 0; j0 < n; j0 += blok) isler.push([i0, j0]);

  const birIs = async ([i0, j0]: [number, number]) => {
    const kaynak = koord.slice(i0, i0 + blok);
    const hedef = koord.slice(j0, j0 + blok);
    const tum = [...kaynak, ...hedef];
    const src = kaynak.map((_, i) => i).join(";");
    const dst = hedef.map((_, j) => kaynak.length + j).join(";");
    const adres = `${url}/table/v1/driving/${tum.join(";")}?sources=${src}&destinations=${dst}&annotations=distance`;
    for (let deneme = 1; ; deneme++) {
      try {
        const r = await fetch(adres, { signal: AbortSignal.timeout(60_000) });
        const j = (await r.json()) as { code: string; message?: string; distances?: (number | null)[][] };
        if (j.code !== "Ok" || !j.distances) throw new Error(`OSRM: ${j.code} ${j.message ?? ""}`);
        j.distances.forEach((satir, i) =>
          satir.forEach((m, jj) => {
            const ii = i0 + i;
            const jg = j0 + jj;
            if (m === null) {
              if (ii !== jg) rotaYok++;
              return;
            }
            veri[ii * n + jg] = Math.min(YOK - 1, Math.round(m / 100));
          }),
        );
        return;
      } catch (e) {
        if (deneme >= 3) throw e;
      }
    }
  };

  // Küçük eşzamanlılık: yerel sunucuyu boğmadan
  const ES_ZAMANLI = 4;
  let siradaki = 0;
  await Promise.all(
    Array.from({ length: ES_ZAMANLI }, async () => {
      while (siradaki < isler.length) {
        const is = isler[siradaki++]!;
        await birIs(is);
      }
    }),
  );

  const meta: MatrisMeta = {
    kaynak: "osrm",
    osrmUrl: url,
    olusturma: new Date().toISOString(),
    ilceIdleri: ids,
    birim: "hektometre (100 m), Uint16 little-endian, satır = kaynak, sütun = hedef",
    rotaBulunamayan: rotaYok,
    sure_sn: Math.round((performance.now() - basla) / 100) / 10,
  };
  mkdirSync(dirname(MATRIS_DOSYASI), { recursive: true });
  // Uint16Array platform bayt sırasını kullanır; x86/ARM little-endian. Okurken de aynı.
  writeFileSync(MATRIS_DOSYASI, Buffer.from(veri.buffer));
  writeFileSync(META_DOSYASI, JSON.stringify(meta, null, 1));
  return meta;
}

function onbellektenOku(k: KonumVerisi): Mesafe | null {
  if (!existsSync(MATRIS_DOSYASI) || !existsSync(META_DOSYASI)) return null;
  const meta = JSON.parse(readFileSync(META_DOSYASI, "utf8")) as MatrisMeta;
  const buf = readFileSync(MATRIS_DOSYASI);
  const n = meta.ilceIdleri.length;
  if (buf.byteLength !== n * n * 2) throw new Error("OSRM matris önbelleği bozuk (boyut tutmuyor); veri/ altındaki dosyaları silip yeniden oluşturun");
  const veri = new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (n !== k.ilceler.length) throw new Error("OSRM matris önbelleği ilçe listesiyle uyuşmuyor");
  return osrmMesafe(k, meta, veri);
}

/**
 * Mesafe kaynağını hazırlar: önbellek varsa onu, yoksa OSRM çalışıyorsa matrisi oluşturup, o da yoksa haversine × 1,3.
 * @param zorlaHaversine true ise OSRM hiç denenmez
 */
export async function mesafeHazirla(k: KonumVerisi, zorlaHaversine = false, log: (s: string) => void = () => {}): Promise<Mesafe> {
  if (zorlaHaversine) return haversineMesafe(k);
  const o = onbellektenOku(k);
  if (o) {
    log(`Mesafe: ${o.aciklama}`);
    return o;
  }
  if (await osrmCalisiyorMu()) {
    log(`OSRM matrisi oluşturuluyor (${k.ilceler.length} ilçe, ${OSRM_URL})…`);
    const meta = await osrmMatrisiOlustur(k);
    log(`OSRM matrisi hazır: ${meta.sure_sn} sn, rota bulunamayan çift: ${meta.rotaBulunamayan}`);
    const m = onbellektenOku(k);
    if (!m) throw new Error("OSRM matrisi yazıldı ama okunamadı");
    return m;
  }
  const h = haversineMesafe(k);
  log(`OSRM yok (${OSRM_URL}); mesafe: ${h.aciklama}`);
  return h;
}
