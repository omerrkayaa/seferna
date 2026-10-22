// Deney 3: teyit simülasyonu sistemin kurallarını (shared, varsayılan 24/6/4/12 saat) doğru uygular.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIRMATION_PARAMS, trDayEnd, trDayStart, type ConfirmationParams } from "@nakliye/shared";
import { VARSAYILAN_DAVRANIS, yapilandirmalar } from "../deney3.js";
import { tohumBirlestir } from "../lib/prng.js";
import { DK, ilanSimule, SAAT, teyitIlanlariUret, TIK_MS, uyanikZaman, type Davranis, type Senaryo, type TeyitIlani } from "../lib/teyit-sim.js";
import { Rastgele } from "../lib/prng.js";
import { DENEY3, REFERANS_GUN } from "../parametreler.js";

const tik = (x: number) => Math.ceil(x / TIK_MS) * TIK_MS;
const senaryo = (params: ConfirmationParams, teyit = true, br05 = false): Senaryo => ({ ad: "t", teyit, br05, params, tazelikPenceresiSaat: 24 });
const B = senaryo(DEFAULT_CONFIRMATION_PARAMS);
const hicCevapYok: Davranis = { ...VARSAYILAN_DAVRANIS, p: 0 };

test("varsayılan yapılandırma (24/4/12) shared DEFAULT_CONFIRMATION_PARAMS ile birebir aynı parametreleri kullanır", () => {
  const y = yapilandirmalar().find((x) => x.kod === "B_p0.7_a24_g12");
  assert.ok(y, "varsayılan B yapılandırması ızgarada olmalı");
  assert.equal(DEFAULT_CONFIRMATION_PARAMS.reminderIntervalH, 24);
  assert.equal(DEFAULT_CONFIRMATION_PARAMS.pendingGraceH, 12);
  assert.equal(DEFAULT_CONFIRMATION_PARAMS.answerWindowH, 4);
  assert.equal(DEFAULT_CONFIRMATION_PARAMS.loadDayIntervalH, 6);
});

/** Elle kurulmuş ilan: yükleme 3 gün sonra, yük hiç gitmiyor */
function ilan(verildi: number, loadFrom: string, loadTo: string, ek: Partial<TeyitIlani> = {}): TeyitIlani {
  return { id: 0, verildi, loadFrom, loadTo, gitti: Infinity, kendiligindenKapama: Infinity, sikayetler: [], cevapTohumu: 1, ...ek };
}

test("BR-02…04 (varsayılan): cevapsız ilan 24 sa sonra sorulur, +4 sa 'teyit bekliyor', +12 sa daha 'süresi doldu'", () => {
  const verildi = trDayStart(REFERANS_GUN).getTime() + 10 * SAAT; // Pazartesi 10:00 TR
  const r = ilanSimule(ilan(verildi, "2026-11-05", "2026-11-06"), B, hicCevapYok);
  const soru = tik(verildi + 24 * SAAT);
  assert.deepEqual(
    r.gecisler.map((g) => [g.durum, g.t]),
    [
      ["teyitli", verildi],
      ["teyit_bekliyor", tik(soru + 4 * SAAT)],
      ["suresi_doldu", tik(soru + 16 * SAAT)],
    ],
  );
  assert.equal(r.soru, 1);
  assert.equal(r.sms, 1, "30 dk cevapsız soru SMS'e düşer");
  assert.equal(r.bitis, "cevapsiz_dustu");
  assert.equal(r.yanlisDusme, true, "yük hiç gitmedi: geçerli ilan düştü");
  assert.equal(r.kayipGecerliMs, trDayEnd("2026-11-06").getTime() - r.bitisAni);
});

test("BR-02 yükleme günü: soru aralığı yükleme gününde 6 saate iner", () => {
  // Yükleme günü 00:00'dan önce son teyit; 24 saat yükleme gününe sarkıyor → yükleme günü 06:00'da sorulur
  const verildi = trDayStart("2026-11-03").getTime() + 15 * SAAT;
  const her: Davranis = { ...VARSAYILAN_DAVRANIS, p: 1, cevapMedyanDk: 0.001, cevapSigma: 0, uykuBaslangicSaat: 0, uykuBitisSaat: 0 };
  const r = ilanSimule(ilan(verildi, "2026-11-04", "2026-11-04"), B, her);
  const ilkSoru = trDayStart("2026-11-04").getTime() + 6 * SAAT;
  // Sorular yükleme gününde: 06:00, ~12:00, ~18:00 (cevaplar anında), gün bitince süresi doldu
  assert.ok(r.soru >= 3, `soru sayısı ${r.soru}`);
  const gecerliCevaplar = r.gecisler.filter((g) => g.neden === "cevap_gecerli").map((g) => g.t);
  assert.ok(gecerliCevaplar[0]! >= ilkSoru && gecerliCevaplar[0]! < ilkSoru + TIK_MS + DK);
  assert.equal(r.bitis, "tarih_bitti");
  assert.equal(r.gecisler.at(-1)!.t, tik(trDayEnd("2026-11-04").getTime() + 1));
});

test("cevap 'geçerli' son teyidi yeniler; yük gittikten sonraki cevap ilanı kapatır", () => {
  const verildi = trDayStart(REFERANS_GUN).getTime() + 9 * SAAT;
  const her: Davranis = { ...VARSAYILAN_DAVRANIS, p: 1, cevapMedyanDk: 60, cevapSigma: 0, uyanmaGecikmesiDk: 0 };
  const gitti = verildi + 40 * SAAT;
  const r = ilanSimule(ilan(verildi, "2026-11-06", "2026-11-06", { gitti }), B, her);
  const soru1 = tik(verildi + 24 * SAAT);
  const cevap1 = soru1 + 60 * DK;
  assert.deepEqual(r.gecisler[1], { t: cevap1, durum: "teyitli", neden: "cevap_gecerli" });
  const soru2 = tik(cevap1 + 24 * SAAT);
  assert.deepEqual(r.gecisler[2], { t: soru2 + 60 * DK, durum: "kapandi", neden: "cevap_gitti" });
  assert.equal(r.bitis, "sahip_kapatti_soruyla");
  assert.equal(r.bayatMs, soru2 + 60 * DK - gitti);
  assert.equal(r.sms, 2, "cevap 60 dk'da: her soruda 30 dk'lık SMS yedeği gider");
});

test("senaryo A: soru yok; ilan yükleme aralığı bitene kadar listede kalır", () => {
  const verildi = trDayStart(REFERANS_GUN).getTime() + 9 * SAAT;
  const gitti = verildi + 5 * SAAT;
  const r = ilanSimule(ilan(verildi, "2026-11-04", "2026-11-05", { gitti }), senaryo(DEFAULT_CONFIRMATION_PARAMS, false), VARSAYILAN_DAVRANIS);
  assert.equal(r.soru, 0);
  assert.equal(r.bitis, "tarih_bitti");
  const son = tik(trDayEnd("2026-11-05").getTime() + 1);
  assert.equal(r.bitisAni, son);
  assert.equal(r.bayatMs, son - gitti);
  assert.equal(r.tazeMs, 24 * SAAT);
});

test("BR-05: iki şikayet teyitli ilanı anında 'teyit bekliyor'a çeker; 12 saat cevapsızsa düşer", () => {
  const verildi = trDayStart(REFERANS_GUN).getTime() + 9 * SAAT;
  const gitti = verildi + 2 * SAAT;
  const sik = [verildi + 3 * SAAT, verildi + 5 * SAAT];
  const r = ilanSimule(ilan(verildi, "2026-11-06", "2026-11-06", { gitti, sikayetler: sik }), senaryo(DEFAULT_CONFIRMATION_PARAMS, true, true), hicCevapYok);
  assert.deepEqual(r.gecisler[1], { t: sik[1], durum: "teyit_bekliyor", neden: "br05" });
  assert.deepEqual(r.gecisler[2]!.durum, "suresi_doldu");
  assert.equal(r.gecisler[2]!.t, tik(sik[1]! + 12 * SAAT));
  assert.equal(r.soru, 1);
  assert.equal(r.yanlisDusme, false, "yük gitmişti: doğru düşme");
});

test("uyku saatleri: gece 02:00'deki cevap 07:00'ye (+ gecikme) kayar, gündüz değişmez", () => {
  const d: Davranis = { ...VARSAYILAN_DAVRANIS, uyanmaGecikmesiDk: 0 };
  const gece = trDayStart(REFERANS_GUN).getTime() + 2 * SAAT;
  assert.equal(uyanikZaman(gece, d, new Rastgele(1)), trDayStart(REFERANS_GUN).getTime() + 7 * SAAT);
  const gece23 = trDayStart(REFERANS_GUN).getTime() + 23.5 * SAAT;
  assert.equal(uyanikZaman(gece23, d, new Rastgele(1)), trDayStart("2026-11-03").getTime() + 7 * SAAT);
  const gunduz = trDayStart(REFERANS_GUN).getTime() + 12 * SAAT;
  assert.equal(uyanikZaman(gunduz, d, new Rastgele(1)), gunduz);
});

test("hız için atlanan zamanlayıcı turları sonucu değiştirmez: her 5 dakikada tur atan sürümle birebir aynı", () => {
  const davranislar: Davranis[] = [
    VARSAYILAN_DAVRANIS,
    { ...VARSAYILAN_DAVRANIS, p: 0.4, bayatSikayetOraniSaatte: 0.5, yersizSikayetOraniSaatte: 0.05 },
  ];
  const senaryolar: Senaryo[] = [
    senaryo(DEFAULT_CONFIRMATION_PARAMS, false),
    B,
    senaryo({ ...DEFAULT_CONFIRMATION_PARAMS, reminderIntervalH: 12, pendingGraceH: 6 }),
    senaryo({ ...DEFAULT_CONFIRMATION_PARAMS, reminderIntervalH: 48, pendingGraceH: 24 }, true, true),
    senaryo(DEFAULT_CONFIRMATION_PARAMS, true, true),
  ];
  const cfg = {
    referansGun: REFERANS_GUN,
    gunSayisi: 3,
    gunlukIlan: 20,
    ilanSaatiAgirligi: DENEY3.ilanSaatiAgirligi,
    yuklemeOfsetGun: DENEY3.yuklemeOfsetGun,
    yuklemeAralikGun: DENEY3.yuklemeAralikGun,
  };
  let karsilastirma = 0;
  let br05 = 0;
  for (const d of davranislar) {
    const ilanlar = teyitIlanlariUret(tohumBirlestir(99, d.p * 10), d, cfg);
    for (const s of senaryolar)
      for (const il of ilanlar) {
        const hizli = ilanSimule(il, s, d);
        const yavas = ilanSimule(il, s, d, true);
        assert.deepEqual(hizli, yavas, `ilan ${il.id}`);
        karsilastirma++;
        br05 += hizli.br05Tetik;
      }
  }
  assert.ok(karsilastirma >= 600);
  assert.ok(br05 > 0, "BR-05 yolu da sınanmalı");
});
