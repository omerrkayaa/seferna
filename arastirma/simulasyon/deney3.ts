// Deney 3: canlı ilan teyidinin (BR-02…05) ilan tazeliğine etkisi ve duyarlılık analizi.
import { writeFileSync } from "node:fs";
import { DEFAULT_CONFIRMATION_PARAMS, type ConfirmationParams } from "@nakliye/shared";
import { eslestirilmisFark, holm, ozet } from "./lib/istatistik.js";
import { tohumBirlestir } from "./lib/prng.js";
import { csvYaz, mdTablo, pDegeri, sayi } from "./lib/tablo.js";
import { calistir, teyitIlanlariUret, type CalismaOlcutleri, type Davranis, type Senaryo } from "./lib/teyit-sim.js";
import { DENEY3, KOK_TOHUM, REFERANS_GUN } from "./parametreler.js";

export const VARSAYILAN_DAVRANIS: Davranis = {
  p: DENEY3.cevapP,
  cevapMedyanDk: DENEY3.cevapMedyanDk,
  cevapSigma: DENEY3.cevapSigma,
  q: DENEY3.kendiligindenKapamaQ,
  kapamaMedyanSaat: DENEY3.kapamaMedyanSaat,
  kapamaSigma: DENEY3.kapamaSigma,
  gitmeMedyanSaat: DENEY3.gitmeMedyanSaat,
  gitmeSigma: DENEY3.gitmeSigma,
  uykuBaslangicSaat: DENEY3.uykuBaslangicSaat,
  uykuBitisSaat: DENEY3.uykuBitisSaat,
  uyanmaGecikmesiDk: DENEY3.uyanmaGecikmesiDk,
  bayatSikayetOraniSaatte: DENEY3.bayatSikayetOraniSaatte,
  yersizSikayetOraniSaatte: DENEY3.yersizSikayetOraniSaatte,
};

const URETIM = {
  referansGun: REFERANS_GUN,
  gunSayisi: DENEY3.gunSayisi,
  gunlukIlan: DENEY3.gunlukIlan,
  ilanSaatiAgirligi: DENEY3.ilanSaatiAgirligi,
  yuklemeOfsetGun: DENEY3.yuklemeOfsetGun,
  yuklemeAralikGun: DENEY3.yuklemeAralikGun,
};

const OLCUTLER: { k: keyof CalismaOlcutleri; ad: string; yuzdeMi: boolean; d: number }[] = [
  { k: "bayatOrani", ad: "Bayat ilan-saat payı, %", yuzdeMi: true, d: 2 },
  { k: "bayatTeyitliOrani", ad: "Bayat ve \"teyitli\" görünen pay, %", yuzdeMi: true, d: 2 },
  { k: "ilanBasinaBayatSaat", ad: "İlan başına bayat saat", yuzdeMi: false, d: 2 },
  { k: "tazelik", ad: "İlan tazeliği (son 24 saatte teyitli), %", yuzdeMi: true, d: 1 },
  { k: "bekliyorPayi", ad: "\"Teyit bekliyor\" payı, %", yuzdeMi: true, d: 1 },
  { k: "yanlisDusmeOrani", ad: "Yanlışlıkla düşen geçerli ilan, %", yuzdeMi: true, d: 2 },
  { k: "ilanBasinaKayipGecerliSaat", ad: "İlan başına kaybedilen geçerli saat", yuzdeMi: false, d: 2 },
  { k: "cevapsizDusmeOrani", ad: "Cevapsızlıktan düşen (tümü), %", yuzdeMi: true, d: 1 },
  { k: "ilanBasinaSoru", ad: "İlan başına soru (push)", yuzdeMi: false, d: 2 },
  { k: "ilanBasinaSms", ad: "İlan başına SMS", yuzdeMi: false, d: 2 },
  { k: "br05TetikOrani", ad: "BR-05 tetiklenen ilan, %", yuzdeMi: true, d: 2 },
];

interface Yapilandirma {
  kod: string;
  senaryo: "A" | "B" | "B+BR05";
  p: number;
  q: number;
  soruAraligi: number;
  bekliyorSuresi: number;
  /** Şikayet oranlarının çarpanı (yalnız BR-05 varyantlarında anlamlı) */
  sikayetCarpani: number;
}

function senaryoKur(y: Yapilandirma): { s: Senaryo; d: Davranis } {
  const params: ConfirmationParams = {
    ...DEFAULT_CONFIRMATION_PARAMS,
    reminderIntervalH: y.soruAraligi,
    pendingGraceH: y.bekliyorSuresi,
  };
  return {
    s: { ad: y.kod, teyit: y.senaryo !== "A", br05: y.senaryo === "B+BR05", params, tazelikPenceresiSaat: DENEY3.tazelikPenceresiSaat },
    d: {
      ...VARSAYILAN_DAVRANIS,
      p: y.p,
      q: y.q,
      bayatSikayetOraniSaatte: VARSAYILAN_DAVRANIS.bayatSikayetOraniSaatte * y.sikayetCarpani,
      yersizSikayetOraniSaatte: VARSAYILAN_DAVRANIS.yersizSikayetOraniSaatte * y.sikayetCarpani,
    },
  };
}

export function yapilandirmalar(): Yapilandirma[] {
  const v = DEFAULT_CONFIRMATION_PARAMS;
  const q0 = DENEY3.kendiligindenKapamaQ;
  const l: Yapilandirma[] = [];
  for (const q of DENEY3.qDegerleri) l.push({ kod: `A_q${q}`, senaryo: "A", p: DENEY3.cevapP, q, soruAraligi: v.reminderIntervalH, bekliyorSuresi: v.pendingGraceH, sikayetCarpani: 1 });
  for (const p of DENEY3.pDegerleri)
    for (const ar of DENEY3.soruAraligiDegerleri)
      for (const gr of DENEY3.bekliyorSuresiDegerleri) l.push({ kod: `B_p${p}_a${ar}_g${gr}`, senaryo: "B", p, q: q0, soruAraligi: ar, bekliyorSuresi: gr, sikayetCarpani: 1 });
  for (const p of DENEY3.pDegerleri)
    l.push({ kod: `BR05_p${p}`, senaryo: "B+BR05", p, q: q0, soruAraligi: v.reminderIntervalH, bekliyorSuresi: v.pendingGraceH, sikayetCarpani: 1 });
  l.push({
    kod: `BR05yogun_p${DENEY3.cevapP}`,
    senaryo: "B+BR05",
    p: DENEY3.cevapP,
    q: q0,
    soruAraligi: v.reminderIntervalH,
    bekliyorSuresi: v.pendingGraceH,
    sikayetCarpani: DENEY3.br05YogunCarpan,
  });
  return l;
}

export function deney3(tohumSayisi: number, ciktiDizini: string, log: (s: string) => void) {
  const t0 = performance.now();
  const ys = yapilandirmalar();
  /** sonuc[kod][tohum] */
  const sonuc = new Map<string, CalismaOlcutleri[]>();
  for (const y of ys) sonuc.set(y.kod, []);

  for (let s = 0; s < tohumSayisi; s++) {
    const tohum = tohumBirlestir(KOK_TOHUM, 3, s);
    // İlanlar q'ya ve şikayet oranlarına bağlı; aynı tohumda aynı temel rastgele sayılar kullanılır
    const ilanOnbellek = new Map<string, ReturnType<typeof teyitIlanlariUret>>();
    for (const y of ys) {
      const { s: sen, d } = senaryoKur(y);
      const anahtar = `${y.q}_${y.sikayetCarpani}`;
      let ilanlar = ilanOnbellek.get(anahtar);
      if (!ilanlar) {
        ilanlar = teyitIlanlariUret(tohum, d, URETIM);
        ilanOnbellek.set(anahtar, ilanlar);
      }
      sonuc.get(y.kod)!.push(calistir(ilanlar, sen, d));
    }
    if ((s + 1) % 5 === 0) log(`  Deney 3: ${s + 1}/${tohumSayisi} tohum (${((performance.now() - t0) / 1000).toFixed(1)} sn)`);
  }

  // ── Ham ve özet ──
  const ham: Record<string, string | number>[] = [];
  for (const y of ys)
    sonuc.get(y.kod)!.forEach((r, i) => ham.push({ kod: y.kod, senaryo: y.senaryo, p: y.p, q: y.q, soruAraligi: y.soruAraligi, bekliyorSuresi: y.bekliyorSuresi, sikayetCarpani: y.sikayetCarpani, tohum: i, ...r }));
  csvYaz(`${ciktiDizini}/deney3_ham.csv`, ham);

  const oz = (kod: string, k: keyof CalismaOlcutleri) => ozet(sonuc.get(kod)!.map((r) => r[k]));
  const ozetSatir: Record<string, string | number>[] = [];
  for (const y of ys)
    for (const o of OLCUTLER) {
      const z = oz(y.kod, o.k);
      ozetSatir.push({ kod: y.kod, senaryo: y.senaryo, p: y.p, q: y.q, soruAraligi: y.soruAraligi, bekliyorSuresi: y.bekliyorSuresi, olcut: o.k, n: z.n, ort: z.ort, ss: z.ss, gaAlt: z.gaAlt, gaUst: z.gaUst });
    }
  csvYaz(`${ciktiDizini}/deney3_ozet.csv`, ozetSatir);

  // ── Eşleştirilmiş karşılaştırmalar (aynı tohum = aynı ilanlar ve davranış) ──
  const q0 = DENEY3.kendiligindenKapamaQ;
  const v = DEFAULT_CONFIRMATION_PARAMS;
  const varsayilanB = (p: number) => `B_p${p}_a${v.reminderIntervalH}_g${v.pendingGraceH}`;
  const KARS: [string, string, string][] = [];
  for (const p of DENEY3.pDegerleri) KARS.push([`A_q${q0}`, varsayilanB(p), `B(p=${p}, 24/4/12) − A(q=${q0})`]);
  for (const p of DENEY3.pDegerleri) KARS.push([varsayilanB(p), `BR05_p${p}`, `B+BR-05 − B (p=${p})`]);
  KARS.push([varsayilanB(DENEY3.cevapP), `BR05yogun_p${DENEY3.cevapP}`, `B+BR-05 (${DENEY3.br05YogunCarpan}× şikayet) − B (p=${DENEY3.cevapP})`]);
  const farkSatir: (Record<string, string | number> & { pT: number; pW: number })[] = [];
  for (const [a, b, ad] of KARS)
    for (const o of OLCUTLER) {
      const f = eslestirilmisFark(
        sonuc.get(a)!.map((r) => r[o.k]),
        sonuc.get(b)!.map((r) => r[o.k]),
      );
      farkSatir.push({ karsilastirma: ad, birinci: a, ikinci: b, olcut: o.k, n: f.n, ortFark: f.ort, gaAlt: f.gaAlt, gaUst: f.gaUst, t: f.tDegeri, pT: f.pT, wilcoxonW: f.wilcoxonW, pW: f.pWilcoxon });
    }
  const hT = holm(farkSatir.map((r) => r.pT));
  const hW = holm(farkSatir.map((r) => r.pW));
  farkSatir.forEach((r, i) => {
    r.pT_holm = hT[i]!;
    r.pW_holm = hW[i]!;
  });
  csvYaz(`${ciktiDizini}/deney3_farklar.csv`, farkSatir);

  writeFileSync(`${ciktiDizini}/deney3.md`, rapor(ys, oz, farkSatir, tohumSayisi, sonuc.get(ys[0]!.kod)![0]!.ilan), "utf8");
  return { sureSn: (performance.now() - t0) / 1000, oz };
}

function rapor(
  ys: Yapilandirma[],
  oz: (kod: string, k: keyof CalismaOlcutleri) => ReturnType<typeof ozet>,
  fk: Record<string, string | number>[],
  tohumSayisi: number,
  ilanSayisi: number,
): string {
  const hucre = (kod: string, o: (typeof OLCUTLER)[number]) => {
    const z = oz(kod, o.k);
    const c = o.yuzdeMi ? 100 : 1;
    return `${sayi(z.ort * c, o.d)} [${sayi(z.gaAlt * c, o.d)}; ${sayi(z.gaUst * c, o.d)}]`;
  };
  const olc = (k: keyof CalismaOlcutleri) => OLCUTLER.find((o) => o.k === k)!;
  const v = DEFAULT_CONFIRMATION_PARAMS;
  const q0 = DENEY3.kendiligindenKapamaQ;
  const s: string[] = [];
  s.push(`# Deney 3 sonuçları — canlı ilan teyidinin ilan tazeliğine etkisi`);
  s.push("");
  s.push(
    `Her yapılandırmada ${tohumSayisi} tohum; her tohumda ${DENEY3.gunSayisi} gün boyunca gelen ${ilanSayisi} ilan, yayından kalkana kadar izlenir. ` +
      `Hücreler: tohum ortalaması [%95 GA]. Aynı tohumda tüm senaryolar aynı ilanları ve aynı insan davranışı rastgele sayılarını kullanır (ortak rastgele sayılar).`,
  );
  s.push("");

  s.push(`## 1. Teyitsiz (A) ve sistemin varsayılanları (B: 24 / 4 / 12 saat)`);
  s.push("");
  const ana = [
    ...DENEY3.qDegerleri.map((q) => ({ kod: `A_q${q}`, ad: `A — teyit yok (q=${sayi(q, 1)})` })),
    ...DENEY3.pDegerleri.map((p) => ({ kod: `B_p${p}_a${v.reminderIntervalH}_g${v.pendingGraceH}`, ad: `B — sistem (p=${sayi(p, 1)})` })),
    ...DENEY3.pDegerleri.map((p) => ({ kod: `BR05_p${p}`, ad: `B + BR-05 (p=${sayi(p, 1)})` })),
    { kod: `BR05yogun_p${DENEY3.cevapP}`, ad: `B + BR-05, ${DENEY3.br05YogunCarpan}× şikayet (p=${sayi(DENEY3.cevapP, 1)})` },
  ];
  const anaOlc = ["bayatOrani", "ilanBasinaBayatSaat", "tazelik", "yanlisDusmeOrani", "ilanBasinaSoru", "ilanBasinaSms"] as const;
  s.push(
    mdTablo(
      ["Senaryo", ...anaOlc.map((k) => olc(k).ad)],
      ana.map((a) => [a.ad, ...anaOlc.map((k) => hucre(a.kod, olc(k)))]),
    ),
  );
  s.push("");
  s.push(
    `A'da p kullanılmaz (soru yok); B'de q = ${sayi(q0, 1)}. BR-05 satırlarında bayat ilana saatte ${sayi(DENEY3.bayatSikayetOraniSaatte, 3)}, geçerli ilana ${sayi(DENEY3.yersizSikayetOraniSaatte, 3)} "yük yok" şikayeti varsayılır [T]; "yoğun" satırda ikisi de ${DENEY3.br05YogunCarpan} katıdır.`,
  );
  s.push("");

  s.push(`## 2. Eşleştirilmiş farklar`);
  s.push("");
  const farkOlc = ["bayatOrani", "ilanBasinaBayatSaat", "tazelik", "yanlisDusmeOrani", "ilanBasinaKayipGecerliSaat"] as const;
  const kars = [...new Set(fk.map((r) => String(r.karsilastirma)))];
  const sat2: string[][] = [];
  for (const kr of kars) {
    const r: string[] = [kr];
    for (const k of farkOlc) {
      const x = fk.find((f) => f.karsilastirma === kr && f.olcut === k) as { ortFark: number; gaAlt: number; gaUst: number; pT_holm: number; pW_holm: number };
      const o = olc(k);
      const c = o.yuzdeMi ? 100 : 1;
      r.push(`${sayi(x.ortFark * c, o.d)} [${sayi(x.gaAlt * c, o.d)}; ${sayi(x.gaUst * c, o.d)}] (p ${pDegeri(x.pT_holm)} / ${pDegeri(x.pW_holm)})`);
    }
    sat2.push(r);
  }
  s.push(
    mdTablo(
      ["Karşılaştırma", ...farkOlc.map((k) => olc(k).ad + (olc(k).yuzdeMi ? " (puan)" : ""))],
      sat2,
    ),
  );
  s.push("");
  s.push(`p: eşleştirilmiş t / Wilcoxon, Deney 3'teki ${fk.length} testin tamamı üzerinde Holm düzeltmeli. Tam liste: \`deney3_farklar.csv\`.`);
  s.push("");

  s.push(`## 3. Duyarlılık: soru aralığı × "teyit bekliyor" süresi × cevap olasılığı p`);
  s.push("");
  s.push(`Cevap penceresi (BR-03) 4 saat ve yükleme günü aralığı 6 saat sabit; q = ${sayi(q0, 1)}.`);
  s.push("");
  const duyOlc = ["bayatOrani", "tazelik", "yanlisDusmeOrani", "ilanBasinaKayipGecerliSaat", "ilanBasinaSoru", "ilanBasinaSms"] as const;
  const sat3: string[][] = ys
    .filter((y) => y.senaryo === "B")
    .map((y) => [sayi(y.p, 1), String(y.soruAraligi), String(y.bekliyorSuresi), ...duyOlc.map((k) => hucre(y.kod, olc(k)))]);
  s.push(mdTablo(["p", "Soru aralığı (sa)", "Bekliyor→düşme (sa)", ...duyOlc.map((k) => olc(k).ad)], sat3));
  s.push("");

  s.push(`## 4. Ek ölçütler (tüm yapılandırmalar)`);
  s.push("");
  const ekOlc = ["bayatTeyitliOrani", "bekliyorPayi", "cevapsizDusmeOrani", "br05TetikOrani"] as const;
  s.push(
    mdTablo(
      ["Yapılandırma", ...ekOlc.map((k) => olc(k).ad)],
      ys.map((y) => [y.kod, ...ekOlc.map((k) => hucre(y.kod, olc(k)))]),
    ),
  );
  s.push("");
  return s.join("\n");
}

