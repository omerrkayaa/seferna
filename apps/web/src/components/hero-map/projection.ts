// Tanıtım haritasının izdüşümü (SVG yedeği ve 3B sahne aynı koordinatları kullanır). Türkiye ölçeğinde eşdikdörtgen
// izdüşüm yeterli: boylam, orta enlemin kosinüsüyle daraltılır. Birim: harita genişliği ~10.
const LON0 = 35.3;
const LAT0 = 38.9;
const K = Math.cos((LAT0 * Math.PI) / 180);
export const SCALE = 0.68;

/** [doğu, kuzey] düzlem koordinatı */
export const project = (lon: number, lat: number): [number, number] => [(lon - LON0) * K * SCALE, (lat - LAT0) * SCALE];

export interface HeroMapData {
  source: string;
  outline: [number, number][][];
  hubs: { slug: string; name: string; lon: number; lat: number }[];
  routes: { from: string; to: string; km: number; points: [number, number][] }[];
  districts: [number, number][];
}

// Sitenin renkleri (globals.css: --primary, --brand-accent) ve uygulamadaki ilan durumu renkleri
export const COLORS = {
  primary: "#17325b",
  accent: "#f3680f",
  confirmed: "#16a34a",
  pending: "#eab308",
  expired: "#94a3b8",
} as const;
