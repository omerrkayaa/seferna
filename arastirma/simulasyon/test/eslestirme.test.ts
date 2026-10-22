// Uygunluk ve skor shared ile birebir aynı; yöntemlerin temel özellikleri tutarlı.
import assert from "node:assert/strict";
import { test } from "node:test";
import { haversineKm, matchLoadWithCapacity } from "@nakliye/shared";
import { adayMatrisiKur, ayniSayidaBosKm, ayniYuklerBosKm, bosKm, kuralTabanli, macarBosKm, macarSkor, olcutler } from "../lib/eslestirme.js";
import { ilceKonum, konumlariYukle } from "../lib/konum.js";
import { haversineMesafe, YOL_KATSAYISI } from "../lib/mesafe.js";
import { tohumBirlestir } from "../lib/prng.js";
import { aracEslestirmeGirdisi, Uretici, yukEslestirmeGirdisi } from "../lib/uretici.js";
import { REFERANS_GUN } from "../parametreler.js";

const k = konumlariYukle();
const u = new Uretici(k, REFERANS_GUN);
const mesafe = haversineMesafe(k);

test("aday matrisi: her çiftte uygunluk ve skor doğrudan shared matchLoadWithCapacity ile aynı", () => {
  let uygun = 0;
  for (let s = 0; s < 3; s++) {
    const o = u.ornek(tohumBirlestir(1, s), tohumBirlestir(2, s), 120, 240);
    const a = adayMatrisiKur(k, o, mesafe);
    for (let i = 0; i < a.n; i++)
      for (let j = 0; j < a.m; j++) {
        const r = matchLoadWithCapacity(
          { origin: ilceKonum(k, o.yukler[i]!.kalkisIlce), dest: ilceKonum(k, o.yukler[i]!.varisIlce), loadFrom: o.yukler[i]!.loadFrom, loadTo: o.yukler[i]!.loadTo, weightTon: o.yukler[i]!.weightTon, vehicleType: o.yukler[i]!.vehicleType, bodyType: o.yukler[i]!.bodyType },
          aracEslestirmeGirdisi(k, o.araclar[j]!),
          o.araclar[j]!.guven,
        );
        const sk = a.skor[i * a.m + j]!;
        if (r.candidate) {
          uygun++;
          assert.equal(sk, r.score);
        } else assert.ok(Number.isNaN(sk));
      }
  }
  assert.ok(uygun > 100, `uygun çift çok az: ${uygun}`);
});

test("girdi dönüşümü: JSON 'lon' → shared 'lng'", () => {
  const o = u.ornek(3, 4, 1, 1);
  const g = yukEslestirmeGirdisi(k, o.yukler[0]!);
  const d = k.ilceler[k.ilceSirasi.get(o.yukler[0]!.kalkisIlce)!]!;
  assert.deepEqual(g.origin, { lat: d.lat, lng: d.lon });
});

test("boş km: her yer → yalnız gidiş; yönlü → gidiş + varıştan hedefe", () => {
  const o = u.ornek(7, 8, 1, 30);
  const y = o.yukler[0]!;
  for (const a of o.araclar) {
    const gidis = haversineKm(ilceKonum(k, a.bulunduguIlce), ilceKonum(k, y.kalkisIlce)) * YOL_KATSAYISI;
    const donus = a.hedefIlce === null ? 0 : haversineKm(ilceKonum(k, y.varisIlce), ilceKonum(k, a.hedefIlce)) * YOL_KATSAYISI;
    assert.ok(Math.abs(bosKm(y, a, mesafe) - gidis - donus) < 1e-9);
  }
});

test("kural tabanlı: her yük, sırası geldiğinde boştaki en yüksek skorlu uygun araca (eşitlikte küçük kimlik) atanır", () => {
  const o = u.ornek(11, 12, 150, 150);
  const a = adayMatrisiKur(k, o, mesafe);
  const at = kuralTabanli(a);
  const dolu = new Set<number>();
  for (let i = 0; i < a.n; i++) {
    let beklenen = -1;
    let enIyi = -Infinity;
    for (let j = 0; j < a.m; j++) {
      const s = a.skor[i * a.m + j]!;
      if (!dolu.has(j) && !Number.isNaN(s) && s > enIyi) {
        enIyi = s;
        beklenen = j;
      }
    }
    assert.equal(at[i], beklenen);
    if (beklenen >= 0) dolu.add(beklenen);
  }
});

test("yöntemler arası tutarlılık: Macar en çok eşleşmeyi bulur; (b) boş km'de, (c) skorda, (d) aynı yüklerde, (e) aynı sayıda boş km'de kendi amacında en iyidir", () => {
  for (let s = 0; s < 10; s++) {
    const o = u.ornek(tohumBirlestir(21, s), tohumBirlestir(22, s), 100, 150);
    const a = adayMatrisiKur(k, o, mesafe);
    const oa = olcutler(a, kuralTabanli(a));
    const ob = olcutler(a, macarBosKm(a));
    const oc = olcutler(a, macarSkor(a));
    const kural = kuralTabanli(a);
    const dAt = ayniYuklerBosKm(a, kural);
    const od = olcutler(a, dAt);
    const oe = olcutler(a, ayniSayidaBosKm(a, oa.eslesme));
    for (let i = 0; i < a.n; i++) assert.equal(dAt[i]! >= 0, kural[i]! >= 0, "(d) tam olarak (a)'nın yüklerini eşleştirir");
    assert.equal(oe.eslesme, oa.eslesme, "(e) kural tabanlıyla aynı sayıda eşleştirir");
    assert.ok(od.toplamBosKm <= oa.toplamBosKm + 1e-6, "(d) aynı yüklerde en az boş km");
    assert.ok(oe.toplamBosKm <= od.toplamBosKm + 1e-6, "(e) yük seçimi serbest: (d)'den kötü olamaz");
    assert.ok(ob.eslesme >= oa.eslesme);
    assert.equal(ob.eslesme, oc.eslesme);
    assert.ok(ob.toplamBosKm <= oc.toplamBosKm + 1e-6);
    assert.ok(oc.ortSkor * oc.eslesme >= ob.ortSkor * ob.eslesme - 1e-9);
    if (oa.eslesme === ob.eslesme) {
      assert.ok(ob.toplamBosKm <= oa.toplamBosKm + 1e-6);
      assert.ok(oc.ortSkor * oc.eslesme >= oa.ortSkor * oa.eslesme - 1e-9);
    }
  }
});
