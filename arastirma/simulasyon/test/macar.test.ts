// Macar algoritması kaba kuvvetle karşılaştırılır: küçük rastgele örneklerde (n, m ≤ 7) aynı optimum bulunmalı.
import assert from "node:assert/strict";
import { test } from "node:test";
import { enCokEslesmeEnAzMaliyet, kareDisiMacar } from "../lib/macar.js";
import { Rastgele } from "../lib/prng.js";

/** Kısmi atamada sözlüksel optimum (en çok eşleşme, sonra en az maliyet) — tüm olasılıkları dener */
function kabaKuvvet(n: number, m: number, c: Float64Array): { sayi: number; maliyet: number } {
  let enIyi = { sayi: -1, maliyet: Infinity };
  const kullanilan = new Uint8Array(m);
  const gez = (i: number, sayi: number, maliyet: number) => {
    if (i === n) {
      if (sayi > enIyi.sayi || (sayi === enIyi.sayi && maliyet < enIyi.maliyet - 1e-9)) enIyi = { sayi, maliyet };
      return;
    }
    gez(i + 1, sayi, maliyet); // i eşleşmesin
    for (let j = 0; j < m; j++) {
      const x = c[i * m + j]!;
      if (kullanilan[j] || x === Infinity) continue;
      kullanilan[j] = 1;
      gez(i + 1, sayi + 1, maliyet + x);
      kullanilan[j] = 0;
    }
  };
  gez(0, 0, 0);
  return enIyi;
}

/** Tam atama (r ≤ c, tüm satırlar atanır) için kaba kuvvet */
function kabaKuvvetTam(r: number, c: number, a: Float64Array): number {
  let enIyi = Infinity;
  const kullanilan = new Uint8Array(c);
  const gez = (i: number, top: number) => {
    if (top >= enIyi) return;
    if (i === r) {
      enIyi = top;
      return;
    }
    for (let j = 0; j < c; j++) {
      if (kullanilan[j]) continue;
      kullanilan[j] = 1;
      gez(i + 1, top + a[i * c + j]!);
      kullanilan[j] = 0;
    }
  };
  gez(0, 0);
  return enIyi;
}

test("tam atama (kare ve dikdörtgen, r ≤ c): 300 rastgele örnekte kaba kuvvetle aynı en az maliyet", () => {
  const r = new Rastgele(12345);
  for (let k = 0; k < 300; k++) {
    const satir = r.tamsayi(1, 7);
    const sutun = r.tamsayi(satir, 7);
    const tam = r.bernoulli(0.5); // yarısı tamsayı (bol eşitlik), yarısı ondalıklı maliyet
    const a = new Float64Array(satir * sutun).map(() => (tam ? r.tamsayi(0, 5) : r.duzgun(0, 1000)));
    const atama = kareDisiMacar(satir, sutun, a);
    assert.equal(new Set(atama).size, satir, "her satır farklı sütuna");
    const top = Array.from(atama).reduce((s, j, i) => s + a[i * sutun + j]!, 0);
    assert.ok(Math.abs(top - kabaKuvvetTam(satir, sutun, a)) < 1e-6, `örnek ${k}: ${top}`);
  }
});

test("kısmi atama (uygunsuz çiftli, kare ve dikdörtgen, n > m dahil): 400 örnekte en çok eşleşme ve en az maliyet kaba kuvvetle aynı", () => {
  const r = new Rastgele(777);
  let devrikSayisi = 0;
  let bosSatirli = 0;
  for (let k = 0; k < 400; k++) {
    const n = r.tamsayi(1, 7);
    const m = r.tamsayi(1, 7);
    if (n > m) devrikSayisi++;
    const yasakOrani = r.duzgun(0, 0.9);
    const tam = r.bernoulli(0.5);
    const c = new Float64Array(n * m).map(() => (r.bernoulli(yasakOrani) ? Infinity : tam ? r.tamsayi(0, 4) : r.duzgun(0, 500)));
    // Bazı örneklerde bir satır tamamen uygunsuz olsun
    if (r.bernoulli(0.2)) {
      const i = r.tamsayi(0, n - 1);
      for (let j = 0; j < m; j++) c[i * m + j] = Infinity;
      bosSatirli++;
    }
    const s = enCokEslesmeEnAzMaliyet(n, m, c);
    const b = kabaKuvvet(n, m, c);
    assert.equal(s.eslesmeSayisi, b.sayi, `örnek ${k}: eşleşme sayısı`);
    assert.ok(Math.abs(s.toplamMaliyet - b.maliyet) < 1e-6, `örnek ${k}: maliyet ${s.toplamMaliyet} ≠ ${b.maliyet}`);
    // Atama geçerli mi: uygunsuz çift yok, sütun tekrarı yok
    const sutunlar = Array.from(s.satirdanSutuna).filter((j) => j >= 0);
    assert.equal(new Set(sutunlar).size, sutunlar.length);
    s.satirdanSutuna.forEach((j, i) => {
      if (j >= 0) assert.notEqual(c[i * m + j], Infinity);
    });
  }
  assert.ok(devrikSayisi > 50 && bosSatirli > 30, "örnek çeşitliliği yetersiz");
});

test("tamamen uygunsuz matris: hiç eşleşme yok", () => {
  const s = enCokEslesmeEnAzMaliyet(3, 4, new Float64Array(12).fill(Infinity));
  assert.equal(s.eslesmeSayisi, 0);
  assert.deepEqual(Array.from(s.satirdanSutuna), [-1, -1, -1]);
});

test("eşleşme sayısı maliyetten önce gelir: pahalı ama iki eşleşmeli çözüm, ucuz tek eşleşmeliye tercih edilir", () => {
  // 0–0 ucuz (1) ama 1. satırın tek seçeneği de 0. sütun; 0–1 pahalı (1000)
  const I = Infinity;
  const c = new Float64Array([1, 1000, 1, I]);
  const s = enCokEslesmeEnAzMaliyet(2, 2, c);
  assert.equal(s.eslesmeSayisi, 2);
  assert.deepEqual(Array.from(s.satirdanSutuna), [1, 0]);
});
