// Sentetik veri: tohumla belirlenir ve sistemin şemalarına/sınırlarına uyar.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BODY_TYPES,
  CARGO_TYPES,
  createCapacitySchema,
  createLoadSchema,
  createVehicleSchema,
  dateRangeError,
  loadDateError,
  trDayStart,
  VEHICLE_TYPES,
} from "@nakliye/shared";
import { konumlariYukle } from "../lib/konum.js";
import { tohumBirlestir } from "../lib/prng.js";
import { Uretici } from "../lib/uretici.js";
import { KAPASITE_ARALIGI, KORIDOR_ILLERI, REFERANS_GUN } from "../parametreler.js";

const k = konumlariYukle();
const u = new Uretici(k, REFERANS_GUN);

test("aynı tohum aynı veriyi, farklı tohum farklı veriyi üretir", () => {
  const a = u.ornek(42, 43, 200, 300);
  const b = new Uretici(k, REFERANS_GUN).ornek(42, 43, 200, 300);
  assert.deepEqual(a, b);
  const c = u.ornek(44, 43, 200, 300);
  assert.notDeepEqual(a.yukler, c.yukler);
  assert.deepEqual(a.araclar, c.araclar, "araç akışı yük tohumundan bağımsız");
});

test("araçlar iç içe: daha az araçlı örnek, çok araçlının ön ekidir (aynı tohum)", () => {
  const az = u.ornek(1, 2, 50, 25);
  const cok = u.ornek(1, 2, 50, 100);
  assert.deepEqual(az.araclar, cok.araclar.slice(0, 25));
  assert.deepEqual(az.yukler, cok.yukler);
});

test("üretilen ilanlar shared şemalarından ve tarih kurallarından geçer", () => {
  const simdi = trDayStart(REFERANS_GUN);
  for (let s = 0; s < 5; s++) {
    const o = u.ornek(tohumBirlestir(9, s), tohumBirlestir(10, s), 400, 400);
    for (const y of o.yukler) {
      const r = createLoadSchema.safeParse({
        originDistrictId: y.kalkisIlce,
        destDistrictId: y.varisIlce,
        loadFrom: y.loadFrom,
        loadTo: y.loadTo,
        cargoType: y.cargoType,
        weightTon: y.weightTon,
        vehicleType: y.vehicleType,
        bodyType: y.bodyType,
        priceType: "teklif",
        price: null,
      });
      assert.ok(r.success, JSON.stringify(y));
      assert.equal(loadDateError(y.loadFrom, y.loadTo, simdi), null);
      assert.notEqual(y.kalkisIlce, y.varisIlce);
      assert.ok(y.weightTon <= KAPASITE_ARALIGI[y.vehicleType][1], "istenen tipin en büyük aracı yükü taşıyabilmeli");
      assert.ok(y.vehicleType in VEHICLE_TYPES && y.cargoType in CARGO_TYPES && (y.bodyType === null || y.bodyType in BODY_TYPES));
    }
    for (const a of o.araclar) {
      assert.ok(createVehicleSchema.safeParse({ plate: "35ABC123", vehicleType: a.vehicle.type, bodyType: a.vehicle.bodyType, capacityTon: a.vehicle.capacityTon }).success);
      assert.ok(
        createCapacitySchema.safeParse({
          vehicleId: "00000000-0000-4000-8000-000000000000",
          originDistrictId: a.bulunduguIlce,
          destDistrictId: a.hedefIlce,
          availableFrom: a.availableFrom,
          availableTo: a.availableTo,
        }).success,
      );
      assert.equal(dateRangeError(a.availableFrom, a.availableTo, simdi, undefined, "Müsaitlik"), null);
      assert.ok(a.guven >= 0 && a.guven <= 1);
      assert.notEqual(a.bulunduguIlce, a.hedefIlce);
    }
  }
});

test("coğrafya: koridor illeri ağırlıklı (kalkışların yaklaşık %55'i)", () => {
  const koridor = new Set(KORIDOR_ILLERI.map((ad) => k.ilAdindan.get(ad)!.id));
  const o = u.ornek(5, 6, 5000, 0);
  const il = (id: number) => k.ilceler[k.ilceSirasi.get(id)!]!.provinceId;
  const pay = o.yukler.filter((y) => koridor.has(il(y.kalkisIlce))).length / o.yukler.length;
  assert.ok(pay > 0.51 && pay < 0.59, `koridor payı ${pay}`);
});
