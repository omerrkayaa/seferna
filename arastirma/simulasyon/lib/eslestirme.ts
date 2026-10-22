// Deney 1'in eşleştirme yöntemleri. Uygunluk ve skor HER yöntemde aynı: shared matchLoadWithCapacity (BR-20, BR-21,
// araç büyüklüğü kuralı). Yöntemler yalnız uygun çiftler arasından kimin kime atanacağını seçer.
import { DEFAULT_MATCH_PARAMS, matchLoadWithCapacity, type MatchParams } from "@nakliye/shared";
import type { KonumVerisi } from "./konum.js";
import { tamKEslesmeEnAzMaliyet } from "./akis.js";
import { enCokEslesmeEnAzMaliyet } from "./macar.js";
import type { Mesafe } from "./mesafe.js";
import { aracEslestirmeGirdisi, yukEslestirmeGirdisi, type Ornek, type SentetikArac, type SentetikYuk } from "./uretici.js";

/** n × m aday matrisi (satır = yük, sütun = araç) */
export interface AdayMatrisi {
  n: number;
  m: number;
  /** BR-21 skoru; uygun değilse NaN */
  skor: Float64Array;
  /** Boş km (yalnız uygun çiftlerde anlamlı) */
  bosKm: Float64Array;
  uygunCiftSayisi: number;
}

/**
 * Boş km = aracın bulunduğu ilçeden yükün kalkışına yol km
 *        + (araç belli bir yöne gidiyorsa) yükün varışından aracın hedefine yol km; "her yer"de 0.
 * Yüklü taşınan km (yük kalkış → varış) dahil değildir: her yöntemde aynı yük için aynıdır.
 */
export function bosKm(y: SentetikYuk, a: SentetikArac, mesafe: Mesafe): number {
  const gidis = mesafe.km(a.bulunduguIlce, y.kalkisIlce);
  const donus = a.hedefIlce === null ? 0 : mesafe.km(y.varisIlce, a.hedefIlce);
  return gidis + donus;
}

export function adayMatrisiKur(
  k: KonumVerisi,
  o: Ornek,
  mesafe: Mesafe,
  p: MatchParams = DEFAULT_MATCH_PARAMS,
): AdayMatrisi {
  const n = o.yukler.length;
  const m = o.araclar.length;
  const skor = new Float64Array(n * m).fill(NaN);
  const km = new Float64Array(n * m).fill(NaN);
  const yg = o.yukler.map((y) => yukEslestirmeGirdisi(k, y));
  const ag = o.araclar.map((a) => aracEslestirmeGirdisi(k, a));
  let uygun = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      // Güven: yük tarafından bakılırken araç sahibinin skoru (shared imzasındaki açıklama)
      const r = matchLoadWithCapacity(yg[i]!, ag[j]!, o.araclar[j]!.guven, p);
      if (!r.candidate) continue;
      skor[i * m + j] = r.score;
      km[i * m + j] = bosKm(o.yukler[i]!, o.araclar[j]!, mesafe);
      uygun++;
    }
  }
  return { n, m, skor, bosKm: km, uygunCiftSayisi: uygun };
}

/** yük → araç (−1 = eşleşmedi) */
export type Atama = Int32Array;

/**
 * (a) Kural tabanlı (sistemin kendisi): yükler ilan sırasıyla gelir; her yük, henüz kimseye verilmemiş uygun araçlar
 * arasından BR-21 skoru en yüksek olana atanır; eşitlikte küçük araç kimliği. Varsayım: bildirim en iyi skorlu adaya
 * gider ve o aday yükü alır (kabul oranı, gecikme ve teklif pazarlığı modellenmez).
 */
export function kuralTabanli(a: AdayMatrisi): Atama {
  const { n, m, skor } = a;
  const atama = new Int32Array(n).fill(-1);
  const dolu = new Uint8Array(m);
  for (let i = 0; i < n; i++) {
    let enIyi = -1;
    let enIyiSkor = -Infinity;
    for (let j = 0; j < m; j++) {
      if (dolu[j]) continue;
      const s = skor[i * m + j]!;
      if (Number.isNaN(s)) continue;
      if (s > enIyiSkor) {
        enIyiSkor = s;
        enIyi = j;
      }
    }
    if (enIyi >= 0) {
      atama[i] = enIyi;
      dolu[enIyi] = 1;
    }
  }
  return atama;
}

/** (b) Macar, boş km en aza: önce eşleşme sayısı en çok, sonra toplam boş km en az. */
export function macarBosKm(a: AdayMatrisi): Atama {
  const c = new Float64Array(a.n * a.m);
  for (let x = 0; x < c.length; x++) c[x] = Number.isNaN(a.skor[x]!) ? Infinity : a.bosKm[x]!;
  return enCokEslesmeEnAzMaliyet(a.n, a.m, c).satirdanSutuna;
}

/**
 * (c) Macar, skor toplamı en çoğa: önce eşleşme sayısı en çok, sonra toplam BR-21 skoru en çok.
 * Maliyet = 1 − skor (skor ∈ [0, 1]); eşleşme sayısı sabitken Σ(1 − s) en az ⇔ Σs en çok.
 */
export function macarSkor(a: AdayMatrisi): Atama {
  const c = new Float64Array(a.n * a.m);
  for (let x = 0; x < c.length; x++) c[x] = Number.isNaN(a.skor[x]!) ? Infinity : Math.max(0, 1 - a.skor[x]!);
  return enCokEslesmeEnAzMaliyet(a.n, a.m, c).satirdanSutuna;
}

/**
 * (d) Kural tabanlının eşleştirdiği AYNI yükler, bu yüklerin hepsi eşleşecek biçimde, toplam boş km en az araç ataması
 * (alt matriste Macar). (b) − (a) boş km farkı, (b)'nin daha çok yük eşleştirmesiyle karışır; (d) − (a) yalnız
 * "aynı yüklere hangi araç" kararının verimini ölçer. Karşılaştırma ölçütüdür, ayrı bir ürün önerisi değildir.
 */
export function ayniYuklerBosKm(a: AdayMatrisi, kural: Atama): Atama {
  const satirlar: number[] = [];
  for (let i = 0; i < a.n; i++) if (kural[i]! >= 0) satirlar.push(i);
  const c = new Float64Array(satirlar.length * a.m);
  satirlar.forEach((i, r) => {
    for (let j = 0; j < a.m; j++) {
      const x = i * a.m + j;
      c[r * a.m + j] = Number.isNaN(a.skor[x]!) ? Infinity : a.bosKm[x]!;
    }
  });
  const alt = enCokEslesmeEnAzMaliyet(satirlar.length, a.m, c);
  if (alt.eslesmeSayisi !== satirlar.length) throw new Error("Aynı yüklerin hepsi eşleşmeliydi (kural tabanlı atama bunun mümkün olduğunu gösteriyor)");
  const atama = new Int32Array(a.n).fill(-1);
  satirlar.forEach((i, r) => (atama[i] = alt.satirdanSutuna[r]!));
  return atama;
}

/**
 * (e) Kural tabanlıyla AYNI eşleşme SAYISINDA (k) toplam boş km en az: en az maliyetli akış (lib/akis.ts).
 * (d)'den farkı: hangi k yükün eşleşeceğini de serbestçe seçer (aynı hizmet düzeyinde ulaşılabilecek alt sınır).
 */
export function ayniSayidaBosKm(a: AdayMatrisi, k: number): Atama {
  const c = new Float64Array(a.n * a.m);
  for (let x = 0; x < c.length; x++) c[x] = Number.isNaN(a.skor[x]!) ? Infinity : a.bosKm[x]!;
  return tamKEslesmeEnAzMaliyet(a.n, a.m, c, k).satirdanSutuna;
}

export interface AtamaOlcutleri {
  eslesme: number;
  eslesmeOrani: number;
  toplamBosKm: number;
  /** Eşleşme başına boş km (eşleşme yoksa NaN) */
  ortBosKm: number;
  ortSkor: number;
}

export function olcutler(a: AdayMatrisi, atama: Atama): AtamaOlcutleri {
  let e = 0;
  let km = 0;
  let s = 0;
  const kullanilan = new Set<number>();
  for (let i = 0; i < a.n; i++) {
    const j = atama[i]!;
    if (j < 0) continue;
    const sk = a.skor[i * a.m + j]!;
    if (Number.isNaN(sk)) throw new Error(`Uygun olmayan çift atanmış: yük ${i} → araç ${j}`);
    if (kullanilan.has(j)) throw new Error(`Araç iki kez atanmış: ${j}`);
    kullanilan.add(j);
    e++;
    km += a.bosKm[i * a.m + j]!;
    s += sk;
  }
  return { eslesme: e, eslesmeOrani: e / a.n, toplamBosKm: km, ortBosKm: e > 0 ? km / e : NaN, ortSkor: e > 0 ? s / e : NaN };
}
