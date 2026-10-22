// İstatistik yardımcıları bilinen değerlerle sınanır (tablo değerleri: standart t ve normal tabloları).
import assert from "node:assert/strict";
import { test } from "node:test";
import { eslestirilmisFark, holm, normalCdf, ozet, tCdf, tQuantile, wilcoxon } from "../lib/istatistik.js";

const yakin = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

test("t ve normal dağılım: tablo değerleri", () => {
  yakin(tQuantile(0.975, 29), 2.04523, 1e-4);
  yakin(tQuantile(0.975, 1), 12.7062, 1e-3);
  yakin(tQuantile(0.975, 9), 2.26216, 1e-4);
  yakin(tCdf(0, 5), 0.5, 1e-12);
  yakin(normalCdf(1.959964), 0.975, 1e-6);
  yakin(normalCdf(-1), 0.158655, 1e-6);
});

test("özet: ortalama, örneklem standart sapması, %95 GA", () => {
  const z = ozet([2, 4, 4, 4, 5, 5, 7, 9]);
  yakin(z.ort, 5, 1e-12);
  yakin(z.ss, Math.sqrt(32 / 7), 1e-12);
  yakin(z.gaUst - z.ort, tQuantile(0.975, 7) * (Math.sqrt(32 / 7) / Math.sqrt(8)), 1e-9);
});

test("eşleştirilmiş t testi: elle hesaplanan değer", () => {
  const a = [10, 12, 9, 11, 13];
  const b = [12, 13, 11, 12, 16];
  // farklar 2,1,2,1,3 → ort 1,8, ss = sqrt(0,7), t = 1,8 / (sqrt(0,7)/sqrt(5)) = 4,8107
  const f = eslestirilmisFark(a, b);
  yakin(f.ort, 1.8, 1e-12);
  yakin(f.tDegeri, 4.81070, 1e-4);
  yakin(f.pT, 2 * (1 - tCdf(4.8107, 4)), 1e-6);
  assert.ok(f.pT > 0.008 && f.pT < 0.009); // t(4) için iki yönlü p ≈ 0,0086
});

test("Wilcoxon: W ve normal yaklaşım", () => {
  // Farklar: 1..10 hepsi pozitif → W = 55, z = (55 − 27,5 − 0,5) / sqrt(96,25)
  const w = wilcoxon([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(w.w, 55);
  yakin(w.p, 2 * (1 - normalCdf(27 / Math.sqrt(96.25))), 1e-9);
  // Sıfırlar atılır, bağlar ortalama sıra alır
  const v = wilcoxon([0, 1, -1, 2, 2]);
  assert.equal(v.n, 4);
  assert.equal(v.w, 1.5 + 3.5 + 3.5);
});

test("Holm düzeltmesi", () => {
  assert.deepEqual(holm([0.01, 0.04, 0.03]), [0.03, 0.06, 0.06]);
});
