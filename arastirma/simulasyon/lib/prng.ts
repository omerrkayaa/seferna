// Tohumlu, deterministik rastgele sayı üreteci. Aynı tohum → aynı dizi (Node sürümünden bağımsız: yalnız 32 bit tamsayı işlemleri).

/** mulberry32: 32 bit durumlu, hızlı ve simülasyon için yeterli kalitede PRNG. [0, 1) döndürür. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Birden çok tamsayıyı tek bir 32 bit tohuma karıştırır (splitmix32 benzeri).
 * Deney yapılandırması + tohum + ilan sırası gibi bileşenlerden bağımsız alt akışlar türetmek için.
 */
export function tohumBirlestir(...parcalar: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parcalar) {
    h = (h ^ (p >>> 0)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h;
}

export class Rastgele {
  private readonly r: () => number;

  constructor(tohum: number) {
    this.r = mulberry32(tohum);
  }

  /** [0, 1) */
  sayi(): number {
    return this.r();
  }

  /** [a, b) aralığında düzgün */
  duzgun(a: number, b: number): number {
    return a + (b - a) * this.r();
  }

  /** [a, b] aralığında tamsayı */
  tamsayi(a: number, b: number): number {
    return a + Math.floor(this.r() * (b - a + 1));
  }

  bernoulli(p: number): boolean {
    return this.r() < p;
  }

  /** Ağırlıklı seçim; ağırlıklar negatif olmamalı, toplamı > 0 olmalı. */
  agirlikli<T>(secenekler: readonly (readonly [T, number])[]): T {
    let toplam = 0;
    for (const [, w] of secenekler) toplam += w;
    let x = this.r() * toplam;
    for (const [d, w] of secenekler) {
      x -= w;
      if (x < 0) return d;
    }
    // Kayan nokta artığı: son pozitif ağırlıklı seçenek
    for (let i = secenekler.length - 1; i >= 0; i--) if (secenekler[i]![1] > 0) return secenekler[i]![0];
    throw new Error("Ağırlıkların toplamı sıfır");
  }

  /** Standart normal (Box–Muller; her çağrıda iki düzgün sayı tüketir, dizinin öngörülebilirliği için ikinci değer atılır) */
  normal(): number {
    let u = this.r();
    while (u <= Number.EPSILON) u = this.r();
    const v = this.r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Log-normal: medyan ve log ölçekte standart sapma (σ) ile */
  lognormal(medyan: number, sigma: number): number {
    return medyan * Math.exp(sigma * this.normal());
  }

  /** Üstel dağılım, verilen ortalamayla */
  ustel(ortalama: number): number {
    let u = this.r();
    while (u <= Number.EPSILON) u = this.r();
    return -Math.log(u) * ortalama;
  }
}
