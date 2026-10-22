// Atama problemi: Kuhn–Munkres (Macar) algoritmasının kısa yol artırma (Jonker–Volgenant tarzı potansiyelli) sürümü.
// Karmaşıklık O(r² · c); r ≤ c olmalı. Kaynak fikir: klasik e-maxx "Hungarian algorithm O(n^3)" uygulaması.
// Yeni paket eklenmedi; doğruluk kaba kuvvetle test/macar.test.ts'te sınanır.

/**
 * Dikdörtgen (r ≤ c) maliyet matrisinde her satırı farklı bir sütuna atayan en az toplam maliyetli atama.
 * @param maliyet satır öncelikli r × c; Infinity = yasak çift (her satırın en az bir sonlu seçeneği OLMALI)
 * @returns satır → sütun
 */
export function kareDisiMacar(r: number, c: number, maliyet: Float64Array): Int32Array {
  if (r > c) throw new Error("Satır sayısı sütun sayısını aşamaz");
  if (maliyet.length !== r * c) throw new Error("Maliyet matrisi boyutu hatalı");
  // 1 tabanlı diziler (0 = sanal başlangıç sütunu)
  const u = new Float64Array(r + 1);
  const v = new Float64Array(c + 1);
  const p = new Int32Array(c + 1); // p[j] = j sütununa atanmış satır (1 tabanlı), 0 = boş
  const way = new Int32Array(c + 1);
  const minv = new Float64Array(c + 1);
  const used = new Uint8Array(c + 1);

  for (let i = 1; i <= r; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    used.fill(0);
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      const satir = (i0 - 1) * c;
      const ui0 = u[i0]!;
      let delta = Infinity;
      let j1 = -1;
      for (let j = 1; j <= c; j++) {
        if (used[j]) continue;
        const cur = maliyet[satir + j - 1]! - ui0 - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      if (j1 < 0 || delta === Infinity) throw new Error("Atama yok: bir satırın sonlu maliyetli seçeneği kalmadı");
      for (let j = 0; j <= c; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    // Artırma yolu boyunca atamaları kaydır
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const sonuc = new Int32Array(r).fill(-1);
  for (let j = 1; j <= c; j++) if (p[j]! > 0) sonuc[p[j]! - 1] = j - 1;
  return sonuc;
}

export interface AtamaSonucu {
  /** satır → sütun, eşleşmeyen −1 */
  satirdanSutuna: Int32Array;
  eslesmeSayisi: number;
  /** Eşleşen çiftlerin maliyet toplamı (ceza hariç) */
  toplamMaliyet: number;
}

/**
 * Kısmi atama, sözlüksel amaç: (1) eşleşme sayısı en çok, (2) bu sayıda toplam maliyet en az.
 *
 * Yöntem: her satıra, yalnız ona ait olmayan ortak bir "eşleşmeme" sütun kümesi eklenir (r adet sahte sütun, maliyet M).
 * M > r · (en büyük sonlu maliyet) seçilir. Gerekçe: k ve k+1 eşleşmeli iki atamada ceza farkı M, maliyet farkı ise
 * en fazla r · maxC < M olduğundan daha çok eşleşmeli atama her zaman daha ucuzdur; eşit eşleşme sayısında ceza sabittir
 * ve yalnız gerçek maliyet karşılaştırılır. Sahte sütunlar her satır için sonlu seçenek sağladığından atama hep vardır.
 * Satır > sütun ise matris devrilir (karmaşıklık küçük boyutun karesiyle büyür).
 *
 * @param maliyet satır öncelikli n × m, negatif olmayan; Infinity = uygun olmayan çift (atanamaz)
 */
export function enCokEslesmeEnAzMaliyet(n: number, m: number, maliyet: Float64Array): AtamaSonucu {
  if (maliyet.length !== n * m) throw new Error("Maliyet matrisi boyutu hatalı");
  let maxC = 0;
  for (let i = 0; i < maliyet.length; i++) {
    const x = maliyet[i]!;
    if (x < 0) throw new Error("Maliyetler negatif olamaz");
    if (x !== Infinity && x > maxC) maxC = x;
  }
  const devrik = n > m;
  const r = devrik ? m : n;
  const cGercek = devrik ? n : m;
  const c = cGercek + r;
  const M = (r + 1) * (maxC + 1);

  const a = new Float64Array(r * c);
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < cGercek; j++) a[i * c + j] = devrik ? maliyet[j * m + i]! : maliyet[i * m + j]!;
    for (let j = cGercek; j < c; j++) a[i * c + j] = M;
  }
  const atama = kareDisiMacar(r, c, a);

  const satirdanSutuna = new Int32Array(n).fill(-1);
  let eslesmeSayisi = 0;
  let toplamMaliyet = 0;
  for (let i = 0; i < r; i++) {
    const j = atama[i]!;
    if (j < 0 || j >= cGercek) continue;
    const [yi, yj] = devrik ? [j, i] : [i, j];
    satirdanSutuna[yi] = yj;
    eslesmeSayisi++;
    toplamMaliyet += maliyet[yi * m + yj]!;
  }
  return { satirdanSutuna, eslesmeSayisi, toplamMaliyet };
}
