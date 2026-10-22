// Dönüş yolu geometrisi (Deney 2, F4 rota üstü / BR-23). API'deki RoutesService.routeLine ile aynı istek: OSRM route
// servisi, overview=simplified&geometries=geojson. İlçe çifti başına bir kez alınır, veri/osrm-rotalar.json.gz'ye yazılır
// (kodlanmış çoklu çizgi, Google polyline, 1e-5 hassasiyet ≈ 1 m). OSRM yoksa ya da rota bulamazsa kuş uçuşu doğru çizgi
// (API'deki yedekle aynı). NOT: boş km ölçüsü bu katmanı değil, mesafe.ts'teki OSRM ilçe matrisini kullanır.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import type { LatLng } from "@nakliye/shared";
import { ilceKonum, type KonumVerisi } from "./konum.js";
import { OSRM_URL, osrmCalisiyorMu } from "./mesafe.js";

const ROTA_DOSYASI = fileURLToPath(new URL("../veri/osrm-rotalar.json.gz", import.meta.url));

export interface RotaKaynagi {
  tur: "osrm" | "kus_ucusu";
  aciklama: string;
  /** a ilçe merkezinden b ilçe merkezine yol çizgisi (en az 2 nokta) */
  cizgi(a: number, b: number): LatLng[];
  /** Kuş uçuşu doğru çizgiye düşülen çift sayısı (OSRM rota bulamadı ya da ulaşılamadı) */
  yedekSayisi: number;
}

interface Onbellek {
  osrmUrl: string;
  olusturma: string;
  /** "a-b" → kodlanmış çizgi; null = OSRM rota bulamadı */
  rotalar: Record<string, string | null>;
}

// ── Google polyline kodlaması (enlem, boylam; 1e-5) ─────────────────

export function cizgiKodla(noktalar: readonly LatLng[]): string {
  let s = "";
  let pLat = 0;
  let pLng = 0;
  const kod = (d: number) => {
    let v = d < 0 ? ~(d << 1) : d << 1;
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    s += String.fromCharCode(v + 63);
  };
  for (const n of noktalar) {
    const lat = Math.round(n.lat * 1e5);
    const lng = Math.round(n.lng * 1e5);
    kod(lat - pLat);
    kod(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return s;
}

export function cizgiCoz(s: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const oku = () => {
    let sonuc = 0;
    let kaydir = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      sonuc |= (b & 0x1f) << kaydir;
      kaydir += 5;
    } while (b >= 0x20);
    return sonuc & 1 ? ~(sonuc >> 1) : sonuc >> 1;
  };
  while (i < s.length) {
    lat += oku();
    lng += oku();
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

const anahtar = (a: number, b: number) => `${a}-${b}`;

/** OSRM'siz yedek: ilçe merkezleri arası doğru çizgi (API'de OSRM yokken de böyle) */
export function dogruCizgiRotalar(k: KonumVerisi): RotaKaynagi {
  return {
    tur: "kus_ucusu",
    aciklama: "kuş uçuşu doğru çizgi (OSRM rotası yok)",
    cizgi: (a, b) => [ilceKonum(k, a), ilceKonum(k, b)],
    yedekSayisi: 0,
  };
}

function onbellekOku(): Onbellek | null {
  if (!existsSync(ROTA_DOSYASI)) return null;
  return JSON.parse(gunzipSync(readFileSync(ROTA_DOSYASI)).toString("utf8")) as Onbellek;
}

function onbellekYaz(o: Onbellek) {
  mkdirSync(dirname(ROTA_DOSYASI), { recursive: true });
  // Anahtar sırası sabit: aynı veri aynı dosya (git farkı yalnız yeni rotalar)
  const sirali: Record<string, string | null> = {};
  for (const k of Object.keys(o.rotalar).sort()) sirali[k] = o.rotalar[k]!;
  writeFileSync(ROTA_DOSYASI, gzipSync(JSON.stringify({ ...o, rotalar: sirali }), { level: 9 }));
}

async function osrmRota(k: KonumVerisi, a: number, b: number, url: string): Promise<string | null> {
  const p = ilceKonum(k, a);
  const q = ilceKonum(k, b);
  const adres = `${url}/route/v1/driving/${p.lng.toFixed(6)},${p.lat.toFixed(6)};${q.lng.toFixed(6)},${q.lat.toFixed(6)}?overview=simplified&geometries=geojson`;
  for (let deneme = 1; ; deneme++) {
    try {
      const r = await fetch(adres, { signal: AbortSignal.timeout(20_000) });
      const j = (await r.json()) as { code: string; routes?: { geometry?: { coordinates: [number, number][] } }[] };
      if (j.code === "NoRoute") return null;
      const c = j.code === "Ok" ? j.routes?.[0]?.geometry?.coordinates : undefined;
      if (!c || c.length < 2) throw new Error(`OSRM: ${j.code}`);
      return cizgiKodla(c.map(([lng, lat]) => ({ lat, lng })));
    } catch (e) {
      if (deneme >= 3) throw e;
    }
  }
}

/**
 * Verilen ilçe çiftleri için rota kaynağını hazırlar: önbellekte olmayan çiftler OSRM çalışıyorsa alınır (yalnız okuma,
 * GET /route) ve önbelleğe eklenir. OSRM yoksa eksik çiftler kuş uçuşu doğru çizgiye düşer (sayısı raporlanır).
 * @param zorlaKusUcusu true ise önbellek ve OSRM kullanılmaz
 */
export async function rotalarHazirla(
  k: KonumVerisi,
  ciftler: Iterable<readonly [number, number]>,
  zorlaKusUcusu = false,
  log: (s: string) => void = () => {},
): Promise<RotaKaynagi> {
  if (zorlaKusUcusu) return dogruCizgiRotalar(k);
  const o: Onbellek = onbellekOku() ?? { osrmUrl: OSRM_URL, olusturma: new Date().toISOString(), rotalar: {} };
  const eksik = [...new Set([...ciftler].filter(([a, b]) => a !== b).map(([a, b]) => anahtar(a, b)))].filter((x) => !(x in o.rotalar));
  if (eksik.length > 0) {
    if (await osrmCalisiyorMu()) {
      log(`OSRM rotaları alınıyor: ${eksik.length} ilçe çifti (${OSRM_URL})…`);
      const t0 = performance.now();
      const ES_ZAMANLI = 6;
      let siradaki = 0;
      await Promise.all(
        Array.from({ length: ES_ZAMANLI }, async () => {
          while (siradaki < eksik.length) {
            const x = eksik[siradaki++]!;
            const [a, b] = x.split("-").map(Number) as [number, number];
            o.rotalar[x] = await osrmRota(k, a, b, OSRM_URL);
          }
        }),
      );
      onbellekYaz(o);
      log(`OSRM rotaları hazır: ${((performance.now() - t0) / 1000).toFixed(1)} sn`);
    } else {
      log(`OSRM yok (${OSRM_URL}); önbellekte olmayan ${eksik.length} çift kuş uçuşu doğru çizgiye düşecek`);
    }
  }
  const cozulmus = new Map<string, LatLng[]>();
  let yedek = 0;
  const sayilan = new Set<string>();
  const dogru = dogruCizgiRotalar(k);
  const kaynak: RotaKaynagi = {
    tur: "osrm",
    aciklama: "",
    cizgi(a, b) {
      const x = anahtar(a, b);
      const hazir = cozulmus.get(x);
      if (hazir) return hazir;
      const kod = o.rotalar[x];
      let c: LatLng[];
      if (typeof kod === "string") c = cizgiCoz(kod);
      else {
        c = dogru.cizgi(a, b);
        if (!sayilan.has(x)) {
          sayilan.add(x);
          yedek++;
          kaynak.yedekSayisi = yedek;
        }
      }
      cozulmus.set(x, c);
      return c;
    },
    yedekSayisi: 0,
  };
  const bulunamayan = Object.values(o.rotalar).filter((v) => v === null).length;
  kaynak.aciklama = `OSRM rota geometrisi (${o.osrmUrl}, overview=simplified; önbellekte ${Object.keys(o.rotalar).length} çift, rota bulunamayan ${bulunamayan}; eksik/bulunamayan çift kuş uçuşu doğru çizgi)`;
  return kaynak;
}
