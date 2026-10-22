// Deney 2: örnek, adaylar shared kurallarıyla birebir aynı, atama yöntemlerinin temel özellikleri ve rota kodlaması.
import assert from "node:assert/strict";
import { test } from "node:test";
import { estimatedArrivalDay, fitRejectReason, matchLoadWithCapacity, onRouteMatch, returnCapacity, returnWindow, vehicleCanCarry } from "@nakliye/shared";
import { bosDonus, donusAdaylari, donusOlcutleri, donusOrnegi, enAzBosKm, kuresel, sistem, yalnizDonus, type DonusAdaylari, type DonusOrnegi } from "../lib/donus.js";
import { ilce, ilceKonum, konumlariYukle } from "../lib/konum.js";
import { haversineMesafe } from "../lib/mesafe.js";
import { tohumBirlestir } from "../lib/prng.js";
import { cizgiCoz, cizgiKodla, dogruCizgiRotalar } from "../lib/rota.js";
import { Uretici, yukEslestirmeGirdisi } from "../lib/uretici.js";
import { REFERANS_GUN } from "../parametreler.js";

const k = konumlariYukle();
const u = new Uretici(k, REFERANS_GUN);
const mesafe = haversineMesafe(k);
const rotalar = dogruCizgiRotalar(k);
const ornek = (s: number, nIs: number, nPazar: number) => donusOrnegi(u, k, mesafe, tohumBirlestir(7, s), tohumBirlestir(8, s), nIs, nPazar);

test("örnek: aynı tohum aynı veri; işler iç içe, il dışı, aracı yükünü taşır; varış shared estimatedArrivalDay", () => {
  const a = ornek(1, 60, 120);
  assert.deepEqual(a, ornek(1, 60, 120));
  const kucuk = ornek(1, 30, 120);
  assert.deepEqual(kucuk.isler, a.isler.slice(0, 30));
  for (const is of a.isler) {
    assert.notEqual(ilce(k, is.kalkisIlce).provinceId, ilce(k, is.varisIlce).provinceId);
    assert.equal(is.varisGunu, estimatedArrivalDay({ loadFrom: is.loadFrom, roadKm: is.yukluKm, deliveredDay: null }, REFERANS_GUN));
    assert.ok(is.varisGunu > is.loadFrom || is.yukluKm === 0);
    assert.ok(vehicleCanCarry(is.vehicle.type, is.vehicle.type) && is.vehicle.capacityTon > 0);
  }
});

test("adaylar: dönüş = shared matchLoadWithCapacity (sanal araç ilanı); rota = fitRejectReason boş + onRouteMatch; boş km azaltır", () => {
  let donus = 0;
  let rota = 0;
  for (let s = 0; s < 3; s++) {
    const o = ornek(s, 80, 400);
    const a = donusAdaylari(k, o, mesafe, rotalar);
    o.isler.forEach((is, i) => {
      const cap = returnCapacity({ origin: ilceKonum(k, is.kalkisIlce), dest: ilceKonum(k, is.varisIlce), vehicle: is.vehicle }, returnWindow(is.varisGunu));
      const cizgi = rotalar.cizgi(is.varisIlce, is.kalkisIlce);
      const bos0 = mesafe.km(is.varisIlce, is.kalkisIlce);
      assert.equal(a.bosDonusKm[i], bos0);
      const bulunan = new Map(a.secenekler[i]!.map((x) => [x.yuk, x]));
      o.pazar.forEach((y, j) => {
        const load = yukEslestirmeGirdisi(k, y);
        const m = matchLoadWithCapacity(load, cap, y.sahipGuven);
        const r = !m.candidate && !fitRejectReason(load, cap) ? onRouteMatch(load, cizgi) : null;
        const bosKm = mesafe.km(is.varisIlce, y.kalkisIlce) + mesafe.km(y.varisIlce, is.kalkisIlce);
        const beklenen = (m.candidate || r?.candidate) && bosKm < bos0;
        const x = bulunan.get(j);
        assert.equal(!!x, !!beklenen, `iş ${i} yük ${j}`);
        if (x) {
          assert.equal(x.tur, m.candidate ? "donus" : "rota");
          assert.equal(x.skor, m.candidate ? m.score : r!.candidate ? r!.score : NaN);
          assert.ok(Math.abs(x.bosKm - bosKm) < 1e-9);
          if (x.tur === "donus") donus++;
          else rota++;
        }
      });
    });
  }
  assert.ok(donus > 20 && rota > 20, `aday çok az: dönüş ${donus}, rota ${rota}`);
});

/** Kaba kuvvet: her işe (yok | bir aday) atayıp tek kullanım kısıtıyla en az toplam boş km */
function kabaKuvvet(o: DonusOrnegi, a: DonusAdaylari): number {
  let en = Infinity;
  const git = (i: number, kullanilan: Set<number>, toplam: number) => {
    if (i === o.isler.length) {
      en = Math.min(en, toplam);
      return;
    }
    git(i + 1, kullanilan, toplam + a.bosDonusKm[i]!);
    for (const x of a.secenekler[i]!) {
      if (kullanilan.has(x.yuk)) continue;
      kullanilan.add(x.yuk);
      git(i + 1, kullanilan, toplam + x.bosKm);
      kullanilan.delete(x.yuk);
    }
  };
  git(0, new Set(), 0);
  return en;
}

test("küresel atama: küçük örneklerde kaba kuvvetle aynı en az toplam boş km; her yöntemden kötü değil", () => {
  let sinanan = 0;
  for (let s = 0; s < 400 && sinanan < 60; s++) {
    // Yoğun küçük pazar: aynı kalkış bölgesinden çok iş (rekabetli adaylar)
    const o = ornek(100 + s, 6, 40);
    const a = donusAdaylari(k, o, mesafe, rotalar);
    if (a.secenekler.filter((l) => l.length > 0).length < 2) continue;
    if (a.secenekler.reduce((p, l) => p * (l.length + 1), 1) > 200_000) continue;
    sinanan++;
    const kk = donusOlcutleri(o, a, kuresel(o, a)).toplamBosKm;
    assert.ok(Math.abs(kk - kabaKuvvet(o, a)) < 1e-6, `tohum ${s}`);
    for (const f of [bosDonus, yalnizDonus, sistem, enAzBosKm]) assert.ok(kk <= donusOlcutleri(o, a, f(o, a)).toplamBosKm + 1e-6);
  }
  assert.ok(sinanan >= 20, `sınanabilen örnek az: ${sinanan}`);
});

test("yöntemler: bir yük tek araca; B yalnız dönüş yükü; C dönüş varken rota seçmez; A'da boş km = boş dönüşlerin toplamı", () => {
  const o = ornek(5, 150, 600);
  const a = donusAdaylari(k, o, mesafe, rotalar);
  const A = donusOlcutleri(o, a, bosDonus(o));
  assert.equal(A.donusBulmaOrani, 0);
  assert.ok(Math.abs(A.toplamBosKm - a.bosDonusKm.reduce((x, y) => x + y, 0)) < 1e-6);
  const B = yalnizDonus(o, a);
  assert.ok(B.every((x) => !x || x.tur === "donus"));
  const C = sistem(o, a);
  // C'de rota seçen iş, seçim anında dönüş adayı kalmamış olmalı: varış sırasıyla yeniden oynat
  const alinan = new Set<number>();
  for (const is of [...o.isler].sort((p, q) => (p.varisGunu < q.varisGunu ? -1 : p.varisGunu > q.varisGunu ? 1 : p.id - q.id))) {
    const x = C[is.id];
    if (x?.tur === "rota") assert.ok(!a.secenekler[is.id]!.some((y) => y.tur === "donus" && !alinan.has(y.yuk)));
    if (x) alinan.add(x.yuk);
  }
  for (const at of [B, C, enAzBosKm(o, a), kuresel(o, a)]) {
    const m = donusOlcutleri(o, a, at); // aynı yük iki kez → hata fırlatır
    assert.ok(m.toplamBosKm <= A.toplamBosKm + 1e-6);
  }
});

test("rota kodlaması: kodla → çöz 1e-5 hassasiyetle aynı; doğru çizgi yedeği iki nokta", () => {
  const n = [
    { lat: 41.01, lng: 28.97 },
    { lat: 40.19123, lng: 29.06045 },
    { lat: -12.5, lng: -77.03 },
  ];
  const c = cizgiCoz(cizgiKodla(n));
  assert.equal(c.length, 3);
  c.forEach((p, i) => {
    assert.ok(Math.abs(p.lat - n[i]!.lat) < 1e-5 && Math.abs(p.lng - n[i]!.lng) < 1e-5);
  });
  assert.equal(cizgiKodla([{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]), "_p~iF~ps|U_ulLnnqC_mqNvxq`@"); // Google örneği
  const ist = k.ilAdindan.get("İstanbul")!.id;
  const d = k.ilIlceleri.get(ist)!;
  assert.equal(rotalar.cizgi(d[0]!, d[1]!).length, 2);
});
