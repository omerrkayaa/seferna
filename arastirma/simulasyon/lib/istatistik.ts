// Betimsel istatistik, t dağılımı, eşleştirilmiş t testi, Wilcoxon işaretli sıralar testi, Holm düzeltmesi.
// Dış paket yok; sayısal yöntemler: düzenlenmiş eksik beta (Lentz sürekli kesri), normal dağılım için erfc yaklaşımı.

export const ortalama = (x: readonly number[]) => x.reduce((s, v) => s + v, 0) / x.length;

/** Örneklem standart sapması (n − 1) */
export function standartSapma(x: readonly number[]): number {
  if (x.length < 2) return NaN;
  const o = ortalama(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - o) ** 2, 0) / (x.length - 1));
}

function lnGamma(z: number): number {
  // Lanczos (g = 7, n = 9)
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999185,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let a = c[0]!;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaSurekliKesir(a: number, b: number, x: number): number {
  const MAX = 300;
  const EPS = 3e-16;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Düzenlenmiş eksik beta fonksiyonu I_x(a, b) */
export function eksikBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaSurekliKesir(a, b, x)) / a : 1 - (bt * betaSurekliKesir(b, a, 1 - x)) / b;
}

/** Student t dağılımı birikimli dağılım fonksiyonu */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const kuyruk = 0.5 * eksikBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - kuyruk : kuyruk;
}

/** t dağılımı ters CDF (ikiye bölme; p ∈ (0, 1)) */
export function tQuantile(p: number, df: number): number {
  let lo = -1000;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Standart normal CDF (erfc, Numerical Recipes Chebyshev yaklaşımı, bağıl hata < 1,2e-7) */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc =
    t *
    Math.exp(
      -x * x -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return z >= 0 ? 1 - erfc / 2 : erfc / 2;
}

export interface Ozet {
  n: number;
  ort: number;
  ss: number;
  /** %95 güven aralığı (t dağılımı) */
  gaAlt: number;
  gaUst: number;
}

export function ozet(x: readonly number[], guven = 0.95): Ozet {
  const v = x.filter((d) => Number.isFinite(d));
  const n = v.length;
  const o = n > 0 ? ortalama(v) : NaN;
  const s = standartSapma(v);
  const yari = n >= 2 ? tQuantile(1 - (1 - guven) / 2, n - 1) * (s / Math.sqrt(n)) : NaN;
  return { n, ort: o, ss: s, gaAlt: o - yari, gaUst: o + yari };
}

export interface EslestirilmisSonuc extends Ozet {
  /** Eşleştirilmiş t testi, iki yönlü p */
  tDegeri: number;
  pT: number;
  /** Wilcoxon işaretli sıralar testi (normal yaklaşım, süreklilik ve bağ düzeltmeli; sıfır farklar atılır), iki yönlü p */
  wilcoxonW: number;
  wilcoxonN: number;
  pWilcoxon: number;
}

/** fark = b − a, aynı örnekler (tohumlar) üzerinde. NaN içeren çiftler atılır. */
export function eslestirilmisFark(a: readonly number[], b: readonly number[]): EslestirilmisSonuc {
  if (a.length !== b.length) throw new Error("Eşleştirilmiş dizilerin boyu farklı");
  const d: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = b[i]! - a[i]!;
    if (Number.isFinite(x)) d.push(x);
  }
  const oz = ozet(d);
  const se = oz.ss / Math.sqrt(oz.n);
  let tDegeri: number;
  let pT: number;
  if (oz.n < 2) {
    tDegeri = NaN;
    pT = NaN;
  } else if (se === 0) {
    tDegeri = oz.ort === 0 ? 0 : Math.sign(oz.ort) * Infinity;
    pT = oz.ort === 0 ? 1 : 0;
  } else {
    tDegeri = oz.ort / se;
    pT = 2 * (1 - tCdf(Math.abs(tDegeri), oz.n - 1));
  }
  const w = wilcoxon(d);
  return { ...oz, tDegeri, pT, wilcoxonW: w.w, wilcoxonN: w.n, pWilcoxon: w.p };
}

/** Wilcoxon işaretli sıralar: W = pozitif farkların sıra toplamı; z normal yaklaşım (n_sıfırdışı ≥ 10 önerilir). */
export function wilcoxon(d: readonly number[]): { w: number; n: number; p: number } {
  // Kayan nokta gürültüsünü sıfır saymak için göreli tolerans
  const olcek = Math.max(1e-12, ...d.map((x) => Math.abs(x)));
  const nz = d.filter((x) => Math.abs(x) > 1e-12 * olcek);
  const n = nz.length;
  if (n === 0) return { w: 0, n: 0, p: 1 };
  const sirali = nz.map((x) => ({ x, abs: Math.abs(x) })).sort((p, q) => p.abs - q.abs);
  const siralar = new Float64Array(n);
  let bagDuzeltme = 0;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && Math.abs(sirali[j + 1]!.abs - sirali[i]!.abs) <= 1e-12 * olcek) j++;
    const ortSira = (i + j + 2) / 2;
    for (let q = i; q <= j; q++) siralar[q] = ortSira;
    const t = j - i + 1;
    bagDuzeltme += t ** 3 - t;
    i = j + 1;
  }
  let w = 0;
  for (let i = 0; i < n; i++) if (sirali[i]!.x > 0) w += siralar[i]!;
  const beklenen = (n * (n + 1)) / 4;
  const varyans = (n * (n + 1) * (2 * n + 1)) / 24 - bagDuzeltme / 48;
  if (varyans <= 0) return { w, n, p: 1 };
  const z = (Math.abs(w - beklenen) - 0.5) / Math.sqrt(varyans);
  const p = Math.min(1, 2 * (1 - normalCdf(Math.max(0, z))));
  return { w, n, p };
}

/** Holm–Bonferroni düzeltilmiş p değerleri (aynı sırada döner) */
export function holm(p: readonly number[]): number[] {
  const idx = p.map((v, i) => ({ v: Number.isNaN(v) ? 1 : v, i })).sort((a, b) => a.v - b.v);
  const m = idx.length;
  const sonuc = new Array<number>(m).fill(1);
  let enBuyuk = 0;
  idx.forEach(({ v, i }, k) => {
    enBuyuk = Math.max(enBuyuk, Math.min(1, (m - k) * v));
    sonuc[i] = enBuyuk;
  });
  return sonuc;
}
