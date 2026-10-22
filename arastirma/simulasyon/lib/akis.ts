// Tam k eşleşmeli en az maliyetli atama: ardışık en kısa yollar (successive shortest paths) ile en az maliyetli akış.
// Kaynak → yükler (kapasite 1, maliyet 0) → uygun araçlar (kapasite 1, maliyet c) → hedef (kapasite 1, maliyet 0).
// Bilinen özellik: her adımda en kısa artırma yolu kullanılırsa, j adım sonundaki akış j birimlik akışlar arasında en
// ucuzudur. Bu yüzden k adımda durmak "tam k eşleşme ile en az toplam maliyet" sorusunu kesin çözer. Dijkstra, Johnson
// potansiyelleriyle negatif olmayan indirgenmiş maliyetler üzerinde çalışır (başlangıçta tüm maliyetler ≥ 0).
// Deney 1'de (d) yöntemi için: kural tabanlı yöntemin eşleşme sayısı sabit tutulup boş km en aza indirilir; böylece
// "daha çok eşleşme" etkisi ile "aynı eşleşmede daha az boş km" etkisi ayrılır. Doğruluk kaba kuvvetle test edilir.
import type { AtamaSonucu } from "./macar.js";

class IkiliYigin {
  private d: number[] = [];
  private v: number[] = [];
  get bos() {
    return this.d.length === 0;
  }
  ekle(dist: number, dugum: number) {
    const d = this.d;
    const v = this.v;
    let i = d.length;
    d.push(dist);
    v.push(dugum);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[p]! <= dist) break;
      d[i] = d[p]!;
      v[i] = v[p]!;
      i = p;
    }
    d[i] = dist;
    v[i] = dugum;
  }
  /** [mesafe, düğüm] */
  al(): [number, number] {
    const d = this.d;
    const v = this.v;
    const sonuc: [number, number] = [d[0]!, v[0]!];
    const sd = d.pop()!;
    const sv = v.pop()!;
    if (d.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= d.length) break;
        const r = l + 1;
        const c = r < d.length && d[r]! < d[l]! ? r : l;
        if (d[c]! >= sd) break;
        d[i] = d[c]!;
        v[i] = v[c]!;
        i = c;
      }
      d[i] = sd;
      v[i] = sv;
    }
    return sonuc;
  }
}

/**
 * @param maliyet satır öncelikli n × m, negatif olmayan; Infinity = uygun olmayan çift
 * @param k istenen eşleşme sayısı; en büyük eşleşmeden fazlaysa en büyük eşleşmede durulur
 */
export function tamKEslesmeEnAzMaliyet(n: number, m: number, maliyet: Float64Array, k: number): AtamaSonucu {
  if (maliyet.length !== n * m) throw new Error("Maliyet matrisi boyutu hatalı");
  const S = n + m;
  const T = n + m + 1;
  const V = n + m + 2;
  // İleri yıldız kenar listesi; her kenarın tersi (e ^ 1)
  const to: number[] = [];
  const cap: number[] = [];
  const cost: number[] = [];
  const next: number[] = [];
  const head = new Int32Array(V).fill(-1);
  const kenar = (u: number, v: number, c: number) => {
    for (const [a, b, kap, mal] of [
      [u, v, 1, c],
      [v, u, 0, -c],
    ] as const) {
      to.push(b);
      cap.push(kap);
      cost.push(mal);
      next.push(head[a]!);
      head[a] = to.length - 1;
    }
  };
  for (let i = 0; i < n; i++) kenar(S, i, 0);
  for (let j = 0; j < m; j++) kenar(n + j, T, 0);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      const c = maliyet[i * m + j]!;
      if (c === Infinity) continue;
      if (c < 0) throw new Error("Maliyetler negatif olamaz");
      kenar(i, n + j, c);
    }

  const pot = new Float64Array(V);
  const dist = new Float64Array(V);
  const onceki = new Int32Array(V);
  let akis = 0;
  while (akis < k) {
    dist.fill(Infinity);
    onceki.fill(-1);
    dist[S] = 0;
    const y = new IkiliYigin();
    y.ekle(0, S);
    while (!y.bos) {
      const [du, u] = y.al();
      if (du > dist[u]!) continue;
      for (let e = head[u]!; e !== -1; e = next[e]!) {
        if (cap[e]! <= 0) continue;
        const v = to[e]!;
        const nd = du + cost[e]! + pot[u]! - pot[v]!;
        if (nd < dist[v]! - 1e-9) {
          dist[v] = nd;
          onceki[v] = e;
          y.ekle(nd, v);
        }
      }
    }
    if (dist[T] === Infinity) break; // en büyük eşleşmeye ulaşıldı
    for (let v = 0; v < V; v++) if (dist[v]! < Infinity) pot[v] = pot[v]! + dist[v]!;
    for (let v = T; v !== S; ) {
      const e = onceki[v]!;
      cap[e] = cap[e]! - 1;
      cap[e ^ 1] = cap[e ^ 1]! + 1;
      v = to[e ^ 1]!;
    }
    akis++;
  }

  const satirdanSutuna = new Int32Array(n).fill(-1);
  let toplamMaliyet = 0;
  for (let i = 0; i < n; i++)
    for (let e = head[i]!; e !== -1; e = next[e]!) {
      const v = to[e]!;
      // İleri atama kenarı (çift indeksli) doymuşsa eşleşme
      if ((e & 1) === 0 && v >= n && v < n + m && cap[e] === 0) {
        satirdanSutuna[i] = v - n;
        toplamMaliyet += maliyet[i * m + (v - n)]!;
      }
    }
  return { satirdanSutuna, eslesmeSayisi: akis, toplamMaliyet };
}
