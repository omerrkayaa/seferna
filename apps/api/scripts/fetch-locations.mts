/**
 * İl/ilçe veri setini açık kaynaklardan üretir → src/db/seed/locations.json
 *
 * 1. Overpass (tek sorgu): Türkiye'deki admin_level=4 (il) ve admin_level=6 (ilçe) sınırları.
 * 2. Nominatim /lookup (50'lik gruplar): her sınırın bağlı olduğu il (ISO3166-2-lvl4 = TR-<plaka>)
 *    ve ilçe merkez noktası (bağlı yerleşim / admin_centre).
 * 3. Wikidata (tek sorgu): ilin başkenti (P36) koordinatı → il noktası. Nominatim il için geometrik
 *    orta nokta verir (İzmir'de ~22 km sapıyor). Başkent noktası, en yakın ilçesi aynı ile aitse kabul edilir;
 *    değilse "Merkez" ilçenin noktası, o da yoksa geometrik orta nokta kullanılır.
 *
 * Lisanslar: OSM verisi ODbL (© OpenStreetMap katkıcıları), Wikidata CC0. Servisler ücretsiz; Nominatim'e
 * saniyede en fazla 1 istek atılır. Yanıtlar scripts/.cache altında saklanır (yeniden çalıştırmada servise
 * gidilmez; tazelemek için klasörü sil). Çıktı repoya commit'lenir.
 *
 * Çalıştırma (apps/api içinden): node scripts/fetch-locations.mts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const UA = "seferna/0.1";
const OUT = new URL("../src/db/seed/locations.json", import.meta.url);
const CACHE = new URL("./.cache/", import.meta.url);
const EXPECTED = { provinces: 81, districts: 973 };

/** OSM'de ilçe (admin_level=6) olarak etiketlenmiş ama resmî ilçe olmayan sınırlar. */
const EXCLUDE: Record<number, string> = {
  19258534: "Kara Ada (Muğla/Bodrum açığında ada, resmî ilçe değil)",
};

type OsmRel = { id: number; tags: Record<string, string> };
type NomResult = { osm_id: number; lat: string; lon: string; address: Record<string, string> };
type Point = { lat: number; lon: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function km(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Aynı istek daha önce yapıldıysa diskten okur; ücretsiz servisleri gereksiz yere yormamak için.
 * `valid` geçmeyen yanıt önbelleğe yazılmaz (ör. Overpass yoğunken 200 + boş liste dönebiliyor).
 */
async function cached<T>(key: string, fn: () => Promise<T>, valid: (v: T) => boolean): Promise<T> {
  mkdirSync(CACHE, { recursive: true });
  const file = new URL(createHash("sha1").update(key).digest("hex") + ".json", CACHE);
  if (existsSync(file)) {
    const hit = JSON.parse(readFileSync(file, "utf8"));
    if (valid(hit)) return hit;
  }
  const value = await fn();
  if (!valid(value)) throw new Error(`Geçersiz yanıt (${key.slice(0, 80)}…): ${JSON.stringify(value).slice(0, 300)}`);
  writeFileSync(file, JSON.stringify(value));
  return value;
}

/** Ücretsiz sunucular yoğunken hata dönebiliyor: beklemeli tekrar dene. */
async function fetchJson(urls: string[], init: RequestInit = {}): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = urls[attempt % urls.length];
    try {
      const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...init.headers } });
      if (res.ok) return await res.json();
      console.log(`${new URL(url).host}: HTTP ${res.status}, tekrar denenecek`);
    } catch (e) {
      console.log(`${new URL(url).host}: ${(e as Error).message}, tekrar denenecek`);
    }
    await sleep(15_000 * (attempt + 1));
  }
  throw new Error(`Ulaşılamadı: ${urls.join(", ")}`);
}

/** Overpass sunucuları yoğunsa aynı sorgunun çıktısı dosyadan verilebilir: --overpass-file <yol> */
async function overpass(): Promise<OsmRel[]> {
  const q = `[out:json][timeout:180];area["ISO3166-1"="TR"][admin_level=2]->.tr;
(rel(area.tr)["boundary"="administrative"]["admin_level"="4"];rel(area.tr)["boundary"="administrative"]["admin_level"="6"];);out tags;`;
  const fileArg = process.argv.indexOf("--overpass-file");
  if (fileArg > 0) {
    console.log(`Overpass çıktısı dosyadan: ${process.argv[fileArg + 1]}`);
    return JSON.parse(readFileSync(process.argv[fileArg + 1], "utf8")).elements;
  }
  const data = await cached(
    q,
    () =>
      fetchJson(["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: q }),
      }),
    (v: any) => Array.isArray(v?.elements) && v.elements.length > 1000 && !v.remark,
  );
  return data.elements;
}

async function nominatimLookup(ids: number[]): Promise<NomResult[]> {
  const out: NomResult[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).map((id) => `R${id}`).join(",");
    const url = `https://nominatim.openstreetmap.org/lookup?osm_ids=${batch}&format=jsonv2&addressdetails=1&accept-language=tr`;
    let hit = true;
    const res = await cached(
      url,
      async () => ((hit = false), await fetchJson([url])),
      (v: NomResult[]) => Array.isArray(v) && v.length > 0,
    );
    out.push(...res);
    if (!hit) await sleep(1500);
  }
  return out;
}

/** İl Wikidata kimliği → başkent koordinatları (bazı başkentlerde birden fazla koordinat kayıtlı). */
async function wikidataCapitals(qids: string[]): Promise<Map<string, Point[]>> {
  const q = `SELECT ?p ?coord WHERE { VALUES ?p { ${qids.map((q) => "wd:" + q).join(" ")} } ?p wdt:P36 ?cap. ?cap wdt:P625 ?coord. }`;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`;
  const data = await cached(
    url,
    () => fetchJson([url], { headers: { Accept: "application/sparql-results+json" } }),
    (v: any) => Array.isArray(v?.results?.bindings) && v.results.bindings.length > 0,
  );
  const out = new Map<string, Point[]>();
  for (const b of data.results.bindings) {
    const qid = b.p.value.split("/").pop();
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
    if (m) out.set(qid, [...(out.get(qid) ?? []), { lon: Number(m[1]), lat: Number(m[2]) }]);
  }
  return out;
}

/** Resmî kullanım: Hakkâri → Hakkari, Elâzığ → Elazığ */
const provinceName = (s: string) => s.replace(/â/g, "a").replace(/Â/g, "A");

/** Büyükşehir olmayan illerin merkez ilçesi resmî listede "Merkez" adıyla geçer. */
function districtName(name: string, province: string): string {
  const n = name.trim();
  if (n === province || n.endsWith(" Merkez")) return "Merkez";
  return n;
}

// ── 1–2. Sınırlar ve bağlı oldukları il ──────────────────────────────
const rels = (await overpass()).filter((r) => !(r.id in EXCLUDE));
console.log(`Overpass: ${rels.length} sınır. Hariç tutulan: ${Object.values(EXCLUDE).join("; ")}`);
const byId = new Map(rels.map((r) => [r.id, r]));
const nom = await nominatimLookup(rels.map((r) => r.id));

const provinces = new Map<number, { id: number; name: string; lat: number; lon: number; qid: string }>();
const rawDistricts: { provinceId: number; name: string; lat: number; lon: number; osmId: number }[] = [];
const skipped: string[] = [];

for (const r of nom) {
  const rel = byId.get(r.osm_id);
  const iso = r.address["ISO3166-2-lvl4"] ?? "";
  if (!rel || r.address.country_code !== "tr" || !/^TR-\d{2}$/.test(iso)) {
    skipped.push(`${rel?.tags.name ?? r.osm_id} (${r.address.country_code ?? "?"} ${iso})`);
    continue;
  }
  const plate = Number(iso.slice(3));
  const point = { lat: round(Number(r.lat)), lon: round(Number(r.lon)) };
  if (rel.tags.admin_level === "4") {
    const name = provinceName(rel.tags["name:tr"] ?? rel.tags.name);
    provinces.set(plate, { id: plate, name, qid: rel.tags.wikidata, ...point });
  } else {
    rawDistricts.push({ provinceId: plate, name: rel.tags["name:tr"] ?? rel.tags.name, osmId: rel.id, ...point });
  }
}
if (skipped.length) console.log(`Atlanan (Türkiye dışı / il bilgisi yok): ${skipped.join(", ")}`);

// İlçe kimliği: plaka × 100 + il içindeki alfabetik sıra (ör. İzmir/Aliağa = 3501). JSON repoda saklandığı için kalıcıdır.
const districts = [...provinces.values()]
  .sort((a, b) => a.id - b.id)
  .flatMap((p) =>
    rawDistricts
      .filter((d) => d.provinceId === p.id)
      .map((d) => ({ ...d, name: districtName(d.name, p.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"))
      .map((d, i) => ({ id: p.id * 100 + i + 1, ...d })),
  );

// ── 3. İl noktası = il merkezi (başkent) ─────────────────────────────
const problems: string[] = [];
const capitals = await wikidataCapitals([...provinces.values()].map((p) => p.qid).filter(Boolean));
const nearestProvince = (pt: Point) => rawDistricts.reduce((best, d) => (km(pt, d) < km(pt, best) ? d : best)).provinceId;
const fallback: string[] = [];
for (const p of provinces.values()) {
  const cap = (capitals.get(p.qid) ?? []).find((c) => nearestProvince(c) === p.id);
  const merkez = districts.find((d) => d.provinceId === p.id && d.name === "Merkez");
  const chosen = cap ?? merkez;
  if (!cap) fallback.push(`${p.name} (${merkez ? "Merkez ilçe" : "geometrik orta nokta"})`);
  if (chosen) {
    p.lat = round(chosen.lat);
    p.lon = round(chosen.lon);
  }
}
if (fallback.length) console.log(`Başkent koordinatı kullanılamayan il: ${fallback.join(", ")}`);

// ── Doğrulama ────────────────────────────────────────────────────────
if (provinces.size !== EXPECTED.provinces) problems.push(`il sayısı ${provinces.size} ≠ ${EXPECTED.provinces}`);
if (districts.length !== EXPECTED.districts) problems.push(`ilçe sayısı ${districts.length} ≠ ${EXPECTED.districts}`);
const orphan = rawDistricts.filter((d) => !provinces.has(d.provinceId));
if (orphan.length) problems.push(`ili bulunamayan ilçe: ${orphan.map((d) => d.name).join(", ")}`);
for (const p of provinces.values()) {
  const names = districts.filter((d) => d.provinceId === p.id).map((d) => d.name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) problems.push(`${p.name}: tekrar eden ilçe adı ${dup.join(", ")}`);
}

if (problems.length) {
  console.error("HATA — dosya yazılmadı:\n- " + problems.join("\n- "));
  process.exit(1);
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: "OpenStreetMap (Overpass + Nominatim), il merkezleri Wikidata",
      license: "ODbL — © OpenStreetMap contributors; Wikidata CC0",
      generatedAt: new Date().toISOString().slice(0, 10),
      provinces: [...provinces.values()].sort((a, b) => a.id - b.id).map(({ qid, ...p }) => p),
      districts,
    },
    null,
    1,
  ) + "\n",
);
console.log(`Yazıldı: ${provinces.size} il, ${districts.length} ilçe → src/db/seed/locations.json`);
