// Deney 2: dönüş planının (F4) boş km'ye etkisi.
import { writeFileSync } from "node:fs";
import { DEFAULT_MATCH_PARAMS, RETURN_PLAN_PARAMS } from "@nakliye/shared";
import {
  bosDonus,
  donusAdaylari,
  donusOlcutleri,
  donusOrnegi,
  enAzBosKm,
  kuresel,
  sistem,
  SISTEM_PARAMETRELERI,
  yalnizDonus,
  type DonusAdaylari,
  type DonusAtamasi,
  type DonusOrnegi,
  type DonusParametreleri,
} from "./lib/donus.js";
import { eslestirilmisFark, holm, ozet } from "./lib/istatistik.js";
import type { KonumVerisi } from "./lib/konum.js";
import type { Mesafe } from "./lib/mesafe.js";
import { tohumBirlestir } from "./lib/prng.js";
import type { RotaKaynagi } from "./lib/rota.js";
import { csvYaz, mdTablo, pDegeri, sayi, yuzde } from "./lib/tablo.js";
import { Uretici } from "./lib/uretici.js";
import { DENEY2, KOK_TOHUM, REFERANS_GUN } from "./parametreler.js";

export const YONTEMLER2: readonly { kod: "A" | "B" | "C" | "Ckm" | "Cmacar"; ad: string; f: (o: DonusOrnegi, a: DonusAdaylari) => DonusAtamasi }[] = [
  { kod: "A", ad: "Dönüş planı yok: boş döner", f: (o) => bosDonus(o) },
  { kod: "B", ad: "Yalnız dönüş yükleri (BR-20; elle boş araç ilanı açmanın karşılığı)", f: yalnizDonus },
  { kod: "C", ad: "Dönüş + rota üstü (F4, uygulamadaki sıra)", f: sistem },
  { kod: "Ckm", ad: "Aynı öneriler, en az boş km'yi seçen nakliyeci", f: enAzBosKm },
  { kod: "Cmacar", ad: "Aynı adaylarla küresel atama (tasarruf en çok; üst sınır)", f: kuresel },
];
type Kod2 = (typeof YONTEMLER2)[number]["kod"];

const OLCUTLER2 = [
  { k: "toplamBosKm", ad: "Toplam boş km" },
  { k: "donusBulmaOrani", ad: "Dönüş yükü bulma oranı" },
  { k: "bosKmOrani", ad: "Boş km oranı" },
] as const;

interface Satir2 {
  deney: "ana" | "duyarlilik";
  degisken: string;
  deger: string;
  is: number;
  pazar: number;
  tohum: number;
  yontem: Kod2;
  donusBulmaOrani: number;
  toplamBosKm: number;
  aracBasinaBosKm: number;
  bosKmOrani: number;
  rotaPayi: number;
  donusAdayOrt: number;
  rotaAdayOrt: number;
  sureMs: number;
}

/** Bir örnek için tüm (ya da verilen) yöntemler */
function calistir(o: DonusOrnegi, a: DonusAdaylari, kodlar: readonly Kod2[], ortak: Omit<Satir2, "yontem" | "donusBulmaOrani" | "toplamBosKm" | "aracBasinaBosKm" | "bosKmOrani" | "rotaPayi" | "sureMs">): Satir2[] {
  return YONTEMLER2.filter((y) => kodlar.includes(y.kod)).map((y) => {
    const t0 = performance.now();
    const at = y.f(o, a);
    const sureMs = performance.now() - t0;
    return { ...ortak, yontem: y.kod, ...donusOlcutleri(o, a, at), sureMs };
  });
}

const adayOrt = (a: DonusAdaylari, tur: "donus" | "rota") => a.secenekler.reduce((s, l) => s + l.filter((x) => x.tur === tur).length, 0) / a.secenekler.length;

/** Rota önbelleği için gereken (varış, ev) ilçe çiftleri: en büyük iş sayısında, her tohum (işler iç içe) */
export function deney2Ciftleri(k: KonumVerisi, mesafe: Mesafe, tohumSayisi: number): [number, number][] {
  const u = new Uretici(k, REFERANS_GUN);
  const enBuyuk = Math.max(...DENEY2.isSayilari);
  const out: [number, number][] = [];
  for (let s = 0; s < tohumSayisi; s++) for (const is of donusOrnegi(u, k, mesafe, isTohumu(s), 0, enBuyuk, 0).isler) out.push([is.varisIlce, is.kalkisIlce]);
  return out;
}
const isTohumu = (s: number) => tohumBirlestir(KOK_TOHUM, 21, s);
const pazarTohumu = (nIs: number, s: number) => tohumBirlestir(KOK_TOHUM, 22, nIs, s);

export function deney2(k: KonumVerisi, mesafe: Mesafe, rotalar: RotaKaynagi, tohumSayisi: number, ciktiDizini: string, log: (s: string) => void) {
  const u = new Uretici(k, REFERANS_GUN);
  const satirlar: Satir2[] = [];
  const t0 = performance.now();
  const tum = YONTEMLER2.map((y) => y.kod);

  for (const nIs of DENEY2.isSayilari) {
    for (const oran of DENEY2.pazarOranlari) {
      for (let s = 0; s < tohumSayisi; s++) {
        // Aynı tohumda işler iş sayıları arasında iç içe; pazar yükleri oranlar arasında iç içe
        const o = donusOrnegi(u, k, mesafe, isTohumu(s), pazarTohumu(nIs, s), nIs, Math.round(nIs * oran));
        const a = donusAdaylari(k, o, mesafe, rotalar);
        satirlar.push(...calistir(o, a, tum, { deney: "ana", degisken: "-", deger: "-", is: nIs, pazar: oran, tohum: s, donusAdayOrt: adayOrt(a, "donus"), rotaAdayOrt: adayOrt(a, "rota") }));
      }
      log(`  Deney 2: ${nIs} iş × pazar ${oran} bitti (${((performance.now() - t0) / 1000).toFixed(1)} sn)`);
    }
  }

  // Duyarlılık: bir parametre değişir, diğerleri sistem değerinde
  const { is: dIs, pazar: dPazar } = DENEY2.duyarlilik;
  const varyantlar: { degisken: string; deger: string; p: DonusParametreleri }[] = [
    ...DENEY2.pencereGunleri.map((g) => ({ degisken: "pencere_gun", deger: String(g), p: { ...SISTEM_PARAMETRELERI, plan: { ...RETURN_PLAN_PARAMS, windowDays: g } } })),
    ...DENEY2.sapmaKmleri.map((km) => ({ degisken: "sapma_km", deger: String(km), p: { ...SISTEM_PARAMETRELERI, plan: { ...RETURN_PLAN_PARAMS, routeMaxDeviationKm: km } } })),
    ...DENEY2.yaricaplar.map(([ok, dk]) => ({ degisken: "yaricap_km", deger: `${ok}/${dk}`, p: { ...SISTEM_PARAMETRELERI, eslesme: { ...DEFAULT_MATCH_PARAMS, originRadiusKm: ok, destRadiusKm: dk } } })),
  ];
  for (const v of varyantlar) {
    for (let s = 0; s < tohumSayisi; s++) {
      const o = donusOrnegi(u, k, mesafe, isTohumu(s), pazarTohumu(dIs, s), dIs, Math.round(dIs * dPazar));
      const a = donusAdaylari(k, o, mesafe, rotalar, v.p);
      satirlar.push(
        ...calistir(o, a, ["A", "B", "C", "Cmacar"], { deney: "duyarlilik", degisken: v.degisken, deger: v.deger, is: dIs, pazar: dPazar, tohum: s, donusAdayOrt: adayOrt(a, "donus"), rotaAdayOrt: adayOrt(a, "rota") }),
      );
    }
  }
  log(`  Deney 2: duyarlılık bitti (${((performance.now() - t0) / 1000).toFixed(1)} sn)`);

  csvYaz(`${ciktiDizini}/deney2_ham.csv`, satirlar.map((r) => ({ ...r })));

  // ── Özet ve eşleştirilmiş farklar (ana deney) ──
  const grup = (n: number, oran: number, y: Kod2, deney: "ana" | "duyarlilik" = "ana", degisken = "-", deger = "-") =>
    satirlar.filter((r) => r.deney === deney && r.degisken === degisken && r.deger === deger && r.is === n && r.pazar === oran && r.yontem === y).sort((p, q) => p.tohum - q.tohum);
  const ozetSatir: Record<string, string | number>[] = [];
  const farkSatir: (Record<string, string | number> & { pT: number; pW: number })[] = [];
  const KARSILASTIRMALAR: [Kod2, Kod2][] = [
    ["A", "B"],
    ["A", "C"],
    ["B", "C"],
    ["C", "Ckm"],
    ["C", "Cmacar"],
  ];
  for (const n of DENEY2.isSayilari)
    for (const oran of DENEY2.pazarOranlari) {
      for (const y of YONTEMLER2)
        for (const ol of [...OLCUTLER2.map((x) => x.k), "aracBasinaBosKm", "rotaPayi", "donusAdayOrt", "rotaAdayOrt", "sureMs"] as const) {
          const z = ozet(grup(n, oran, y.kod).map((r) => r[ol]));
          ozetSatir.push({ is: n, pazar: oran, yontem: y.kod, olcut: ol, n: z.n, ort: z.ort, ss: z.ss, gaAlt: z.gaAlt, gaUst: z.gaUst });
        }
      for (const [x, yk] of KARSILASTIRMALAR)
        for (const ol of OLCUTLER2) {
          const f = eslestirilmisFark(
            grup(n, oran, x).map((r) => r[ol.k]),
            grup(n, oran, yk).map((r) => r[ol.k]),
          );
          farkSatir.push({ is: n, pazar: oran, fark: `${yk}-${x}`, olcut: ol.k, n: f.n, ortFark: f.ort, ss: f.ss, gaAlt: f.gaAlt, gaUst: f.gaUst, t: f.tDegeri, pT: f.pT, wilcoxonW: f.wilcoxonW, wilcoxonN: f.wilcoxonN, pW: f.pWilcoxon });
        }
    }
  const hT = holm(farkSatir.map((r) => r.pT));
  const hW = holm(farkSatir.map((r) => r.pW));
  farkSatir.forEach((r, i) => {
    r.pT_holm = hT[i]!;
    r.pW_holm = hW[i]!;
  });
  csvYaz(`${ciktiDizini}/deney2_ozet.csv`, ozetSatir);
  csvYaz(`${ciktiDizini}/deney2_farklar.csv`, farkSatir);
  writeFileSync(`${ciktiDizini}/deney2.md`, rapor(satirlar, ozetSatir, farkSatir, tohumSayisi, mesafe, rotalar, varyantlar.map((v) => [v.degisken, v.deger] as const), grup), "utf8");
  return { satirlar, sureSn: (performance.now() - t0) / 1000 };
}

function rapor(
  satirlar: Satir2[],
  oz: Record<string, string | number>[],
  fk: Record<string, string | number>[],
  tohumSayisi: number,
  mesafe: Mesafe,
  rotalar: RotaKaynagi,
  varyantlar: readonly (readonly [string, string])[],
  grup: (n: number, oran: number, y: Kod2, deney?: "ana" | "duyarlilik", degisken?: string, deger?: string) => Satir2[],
): string {
  const bul = (n: number, oran: number, y: string, ol: string) => {
    const r = oz.find((x) => x.is === n && x.pazar === oran && x.yontem === y && x.olcut === ol);
    if (!r) throw new Error(`özet yok ${n} ${oran} ${y} ${ol}`);
    return r as unknown as { ort: number; gaAlt: number; gaUst: number };
  };
  const farkBul = (n: number, oran: number, fark: string, ol: string) => {
    const r = fk.find((x) => x.is === n && x.pazar === oran && x.fark === fark && x.olcut === ol);
    if (!r) throw new Error(`fark yok ${n} ${oran} ${fark} ${ol}`);
    return r as unknown as { ortFark: number; gaAlt: number; gaUst: number; pT_holm: number; pW_holm: number };
  };
  const ga = (o: { ort: number; gaAlt: number; gaUst: number }, d: number, carp = 1) => `${sayi(o.ort * carp, d)} [${sayi(o.gaAlt * carp, d)}; ${sayi(o.gaUst * carp, d)}]`;
  // A'ya göre göreli boş km azalması (tohum başına (A − x)/A × 100)
  const azalma = (g: (y: Kod2) => Satir2[], x: Kod2) => {
    const a = g("A");
    const b = g(x);
    return ozet(a.map((r, i) => ((r.toplamBosKm - b[i]!.toplamBosKm) / r.toplamBosKm) * 100));
  };

  const s: string[] = [];
  s.push(`# Deney 2 sonuçları — dönüş planının (F4) boş km'ye etkisi`);
  s.push("");
  s.push(
    `Her hücre ${tohumSayisi} bağımsız tohumun ortalaması; köşeli parantezde %95 güven aralığı (t dağılımı). Boş km: **${mesafe.aciklama}**. Rota üstü için dönüş yolu: **${rotalar.aciklama}**` +
      `${rotalar.yedekSayisi ? ` (bu çalıştırmada doğru çizgiye düşülen çift: ${rotalar.yedekSayisi})` : ""}. ` +
      `Her araç bir il dışı gidiş işi taşır; ev = işin kalkış ilçesi. Varışta: (A) boş döner; (B) yalnız dönüş yükleri (BR-20, sanal boş araç ilanı: varıştan eve, tahmini varış … +2 gün) — nakliyecinin varışta elle boş araç ilanı açmasının karşılığı; ` +
      `(C) dönüş + rota üstü ara yükler (F4: önce dönüş listesi, yoksa rota üstü; skor sırası); (C-km) aynı öneriler, boş km'si en az olanı seçen nakliyeci; (C-Macar) aynı adaylarla küresel atama (toplam tasarruf en çok; merkezi planlayıcı üst sınırı). ` +
      `B, C, C-km'de işler varış gününe göre sırayla seçer (önce varan önce alır), bir yükü tek araç alır. Kabul [T]: nakliyeci yalnız boş km'sini azaltan yükü alır.`,
  );
  s.push("");
  s.push(`**Okuma:** C − B farkı F4'e özgü katkıdır (rota üstü). B − A farkı "dönüşte platformdan yük bulma"nın etkisidir; F4 bunu otomatikleştirir ama BR-20 eşleştirmesi F4 olmadan da (elle boş araç ilanıyla) vardır.`);
  s.push("");
  s.push(
    `Oranların GA alt sınırı küçük örneklerde sıfırın altına düşebilir (t aralığı simetriktir); bu yalnız belirsizliğin büyüklüğünü gösterir. ` +
      `"Rota üstü payı" yalnız dönüş yükü bulan araçlar üzerinden hesaplanır.`,
  );
  s.push("");

  s.push(`## 1. Örnek yapısı`);
  s.push("");
  s.push(
    mdTablo(
      ["İş", "Pazar/iş", "Pazar yükü", "İş başına dönüş yükü adayı", "İş başına rota üstü aday", "Araç başına boş dönüş km (A)"],
      DENEY2.isSayilari.flatMap((n) =>
        DENEY2.pazarOranlari.map((oran) => [String(n), sayi(oran, 0), String(n * oran), sayi(bul(n, oran, "A", "donusAdayOrt").ort, 2), sayi(bul(n, oran, "A", "rotaAdayOrt").ort, 2), sayi(bul(n, oran, "A", "aracBasinaBosKm").ort, 0)]),
      ),
    ),
  );
  s.push("");
  s.push(`Aday: kabul kuralını (boş km'yi azaltır) geçen, araç/tarih/yarıçap uyan pazar yükü; başka araçlarla rekabet atamada çözülür.`);
  s.push("");

  s.push(`## 2. Yöntemlere göre ölçütler`);
  s.push("");
  const satir2: string[][] = [];
  for (const n of DENEY2.isSayilari)
    for (const oran of DENEY2.pazarOranlari)
      for (const y of YONTEMLER2)
        satir2.push([
          String(n),
          sayi(oran, 0),
          y.kod,
          ga(bul(n, oran, y.kod, "donusBulmaOrani"), 1, 100),
          ga(bul(n, oran, y.kod, "aracBasinaBosKm"), 0),
          ga(bul(n, oran, y.kod, "bosKmOrani"), 1, 100),
          y.kod === "A" || y.kod === "B" ? "—" : yuzde(bul(n, oran, y.kod, "rotaPayi").ort),
          y.kod === "A" ? "—" : ga(azalma((yy) => grup(n, oran, yy), y.kod), 1),
        ]);
  s.push(mdTablo(["İş", "Pazar/iş", "Yöntem", "Dönüş yükü bulma, %", "Araç başına boş km", "Boş km oranı, %", "Rota üstü payı, %", "Boş km azalması (A'ya göre), %"], satir2));
  s.push("");
  s.push(`"Boş km oranı" = boş / (boş + yüklü), gidiş ve dönüş birlikte. "Rota üstü payı": dönüş yükü bulan araçlarda yükün rota üstü (BR-23) listesinden gelme oranı.`);
  s.push("");

  s.push(`## 3. Eşleştirilmiş farklar (aynı örnekler üzerinde)`);
  s.push("");
  s.push(`Fark = ikinci − birinci yöntem. p: eşleştirilmiş t / Wilcoxon, Deney 2 ana deneyindeki ${fk.length} testin tamamı üzerinde Holm düzeltmeli. Tam liste: \`deney2_farklar.csv\`.`);
  s.push("");
  const farkTablo = (ol: string, baslik: string, d: number, carp = 1) => {
    s.push(`### ${baslik}`);
    s.push("");
    const farklar = ["B-A", "C-A", "C-B", "Ckm-C", "Cmacar-C"];
    const sat: string[][] = [];
    for (const n of DENEY2.isSayilari)
      for (const oran of DENEY2.pazarOranlari) {
        const r: string[] = [String(n), sayi(oran, 0)];
        for (const f of farklar) {
          const x = farkBul(n, oran, f, ol);
          r.push(`${sayi(x.ortFark * carp, d)} [${sayi(x.gaAlt * carp, d)}; ${sayi(x.gaUst * carp, d)}]`, `${pDegeri(x.pT_holm)} / ${pDegeri(x.pW_holm)}`);
        }
        sat.push(r);
      }
    s.push(mdTablo(["İş", "Pazar/iş", ...farklar.flatMap((f) => [f.replace("-", "−"), "p (t / W)"])], sat));
    s.push("");
  };
  farkTablo("toplamBosKm", "Toplam boş km farkı", 0);
  farkTablo("donusBulmaOrani", "Dönüş yükü bulma oranı farkı (yüzde puanı)", 2, 100);
  farkTablo("bosKmOrani", "Boş km oranı farkı (yüzde puanı)", 2, 100);

  s.push(`## 4. Duyarlılık (${DENEY2.duyarlilik.is} iş, pazar/iş ${DENEY2.duyarlilik.pazar})`);
  s.push("");
  s.push(`Bir parametre değişir, diğerleri sistem değerinde (pencere 2 gün, sapma 30 km, yarıçap 50/80 km). Kalın satır sistem değeri.`);
  s.push("");
  const { is: dIs, pazar: dPazar } = DENEY2.duyarlilik;
  const sistemDeger: Record<string, string> = { pencere_gun: "2", sapma_km: "30", yaricap_km: "50/80" };
  const adlar: Record<string, string> = { pencere_gun: "Dönüş penceresi (gün)", sapma_km: "Rota üstü sapma (km)", yaricap_km: "Dönüş yarıçapı kalkış/varış (km)" };
  const sat4: string[][] = [];
  for (const [degisken, deger] of varyantlar) {
    const g = (y: Kod2) => grup(dIs, dPazar, y, "duyarlilik", degisken, deger);
    const kal = (x: string) => (sistemDeger[degisken] === deger ? `**${x}**` : x);
    const ort = (y: Kod2, ol: "donusBulmaOrani" | "aracBasinaBosKm") => ozet(g(y).map((r) => r[ol]));
    sat4.push([
      kal(adlar[degisken]!),
      kal(deger),
      kal(ga(ort("B", "donusBulmaOrani"), 1, 100)),
      kal(ga(ort("C", "donusBulmaOrani"), 1, 100)),
      kal(ga(azalma(g, "B"), 1)),
      kal(ga(azalma(g, "C"), 1)),
      kal(ga(azalma(g, "Cmacar"), 1)),
    ]);
  }
  s.push(mdTablo(["Parametre", "Değer", "B bulma, %", "C bulma, %", "B azalma, %", "C azalma, %", "C-Macar azalma, %"], sat4));
  s.push("");

  s.push(`## 5. Çalışma süresi (ms, atama adımı, bu makinede)`);
  s.push("");
  const sat5: string[][] = [];
  for (const n of DENEY2.isSayilari)
    for (const oran of DENEY2.pazarOranlari) sat5.push([String(n), sayi(oran, 0), ga(bul(n, oran, "C", "sureMs"), 2), ga(bul(n, oran, "Ckm", "sureMs"), 2), ga(bul(n, oran, "Cmacar", "sureMs"), 1)]);
  s.push(mdTablo(["İş", "Pazar/iş", "C", "C-km", "C-Macar"], sat5));
  s.push("");
  s.push(`Ham satır sayısı: ${satirlar.length}.`);
  s.push("");
  return s.join("\n");
}
