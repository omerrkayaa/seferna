// Tam k eşleşmeli en az maliyetli atama: her k için kaba kuvvetle aynı optimum; k = en büyükte Macar ile aynı.
import assert from "node:assert/strict";
import { test } from "node:test";
import { tamKEslesmeEnAzMaliyet } from "../lib/akis.js";
import { enCokEslesmeEnAzMaliyet } from "../lib/macar.js";
import { Rastgele } from "../lib/prng.js";

/** Her eşleşme sayısı için en az maliyet (indeks = eşleşme sayısı) */
function kabaKuvvetHerK(n: number, m: number, c: Float64Array): number[] {
  const enIyi: number[] = new Array(Math.min(n, m) + 1).fill(Infinity);
  const kullanilan = new Uint8Array(m);
  const gez = (i: number, sayi: number, mal: number) => {
    if (i === n) {
      if (mal < enIyi[sayi]!) enIyi[sayi] = mal;
      return;
    }
    gez(i + 1, sayi, mal);
    for (let j = 0; j < m; j++) {
      const x = c[i * m + j]!;
      if (kullanilan[j] || x === Infinity) continue;
      kullanilan[j] = 1;
      gez(i + 1, sayi + 1, mal + x);
      kullanilan[j] = 0;
    }
  };
  gez(0, 0, 0);
  return enIyi;
}

test("tam k eşleşme: 300 rastgele örnekte (n, m ≤ 7, uygunsuz çiftli) her k için kaba kuvvetle aynı en az maliyet", () => {
  const r = new Rastgele(4242);
  let sinanan = 0;
  for (let ornek = 0; ornek < 300; ornek++) {
    const n = r.tamsayi(1, 7);
    const m = r.tamsayi(1, 7);
    const yasak = r.duzgun(0, 0.8);
    const tam = r.bernoulli(0.5);
    const c = new Float64Array(n * m).map(() => (r.bernoulli(yasak) ? Infinity : tam ? r.tamsayi(0, 4) : r.duzgun(0, 300)));
    const b = kabaKuvvetHerK(n, m, c);
    const enBuyuk = b.reduce((s, v, i) => (v < Infinity ? i : s), 0);
    for (let k = 0; k <= enBuyuk; k++) {
      const s = tamKEslesmeEnAzMaliyet(n, m, c, k);
      assert.equal(s.eslesmeSayisi, k);
      assert.ok(Math.abs(s.toplamMaliyet - b[k]!) < 1e-6, `örnek ${ornek}, k=${k}: ${s.toplamMaliyet} ≠ ${b[k]}`);
      const sutunlar = Array.from(s.satirdanSutuna).filter((j) => j >= 0);
      assert.equal(sutunlar.length, k);
      assert.equal(new Set(sutunlar).size, k);
      s.satirdanSutuna.forEach((j, i) => j >= 0 && assert.notEqual(c[i * m + j], Infinity));
      sinanan++;
    }
    // Fazla k istenirse en büyük eşleşmede durur ve Macar'ın sözlüksel optimumuyla aynıdır
    const fazla = tamKEslesmeEnAzMaliyet(n, m, c, 99);
    const macar = enCokEslesmeEnAzMaliyet(n, m, c);
    assert.equal(fazla.eslesmeSayisi, macar.eslesmeSayisi);
    assert.ok(Math.abs(fazla.toplamMaliyet - macar.toplamMaliyet) < 1e-6);
  }
  assert.ok(sinanan > 600);
});
