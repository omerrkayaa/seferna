// Deney 1: kural tabanlı eşleştirme ile Macar algoritması tabanlı küresel eşleştirmenin karşılaştırılması.
import { writeFileSync } from "node:fs";
import { adayMatrisiKur, ayniSayidaBosKm, ayniYuklerBosKm, kuralTabanli, macarBosKm, macarSkor, olcutler, type AdayMatrisi, type Atama } from "./lib/eslestirme.js";
import { eslestirilmisFark, holm, ozet } from "./lib/istatistik.js";
import type { KonumVerisi } from "./lib/konum.js";
import type { Mesafe } from "./lib/mesafe.js";
import { tohumBirlestir } from "./lib/prng.js";
import { csvYaz, mdTablo, pDegeri, sayi, yuzde } from "./lib/tablo.js";
import { Uretici } from "./lib/uretici.js";
import { DENEY1, KOK_TOHUM, REFERANS_GUN } from "./parametreler.js";

/** f'nin ikinci parametresi: (a)'nın ataması — yalnız (d) ve (e) kullanır; (a) her örnekte ilk çalışır */
export const YONTEMLER: readonly { kod: "a" | "b" | "c" | "d" | "e"; ad: string; f: (a: AdayMatrisi, kural: Atama) => Atama }[] = [
  { kod: "a", ad: "Kural tabanlı (sistem)", f: (a) => kuralTabanli(a) },
  { kod: "b", ad: "Macar – boş km en az", f: (a) => macarBosKm(a) },
  { kod: "c", ad: "Macar – skor en çok", f: (a) => macarSkor(a) },
  { kod: "d", ad: "(a)'nın yüklerine boş km en az araç ataması (karşılaştırma ölçütü)", f: (a, kural) => ayniYuklerBosKm(a, kural) },
  { kod: "e", ad: "(a) ile aynı eşleşme sayısında boş km en az (karşılaştırma ölçütü)", f: (a, kural) => ayniSayidaBosKm(a, eslesmeSayisi(kural)) },
];
type Kod = (typeof YONTEMLER)[number]["kod"];

const OLCUTLER = [
  { k: "eslesmeOrani", ad: "Eşleşme oranı", birim: "%" },
  { k: "toplamBosKm", ad: "Toplam boş km", birim: "km" },
  { k: "ortBosKm", ad: "Eşleşme başına boş km", birim: "km" },
  { k: "ortSkor", ad: "Ortalama BR-21 skoru", birim: "" },
] as const;
type OlcutKod = (typeof OLCUTLER)[number]["k"];

interface Satir {
  yuk: number;
  oran: number;
  arac: number;
  tohum: number;
  yontem: Kod;
  eslesme: number;
  eslesmeOrani: number;
  toplamBosKm: number;
  ortBosKm: number;
  ortSkor: number;
  sureMs: number;
  adayMatrisiMs: number;
  uygunCift: number;
}

const eslesmeSayisi = (at: Atama) => at.reduce((s, j) => s + (j >= 0 ? 1 : 0), 0);

function zamanla<T>(f: () => T): [T, number] {
  const t0 = performance.now();
  const r = f();
  return [r, performance.now() - t0];
}

export function deney1(k: KonumVerisi, mesafe: Mesafe, tohumSayisi: number, ciktiDizini: string, log: (s: string) => void) {
  const u = new Uretici(k, REFERANS_GUN);

  // Isınma (JIT): sonuçlara girmez
  {
    const o = u.ornek(1, 2, 100, 100);
    const a = adayMatrisiKur(k, o, mesafe);
    const kural = kuralTabanli(a);
    for (const y of YONTEMLER) y.f(a, kural);
  }

  const satirlar: Satir[] = [];
  const t0 = performance.now();
  for (const nYuk of DENEY1.yukSayilari) {
    for (const oran of DENEY1.aracYukOranlari) {
      const nArac = Math.round(nYuk * oran);
      for (let s = 0; s < tohumSayisi; s++) {
        // Aynı (yük sayısı, tohum) için yükler oranlar arasında aynı; araçlar iç içe (oran 1'in araçları oran 2'nin ilk yarısı)
        const o = u.ornek(tohumBirlestir(KOK_TOHUM, 1, nYuk, s), tohumBirlestir(KOK_TOHUM, 2, nYuk, s), nYuk, nArac);
        const [a, adayMs] = zamanla<AdayMatrisi>(() => adayMatrisiKur(k, o, mesafe));
        let kural: Atama = new Int32Array(0);
        for (const y of YONTEMLER) {
          const [atama, ms] = zamanla<Atama>(() => y.f(a, kural));
          const ol = olcutler(a, atama);
          if (y.kod === "a") kural = atama;
          else if ((y.kod === "d" || y.kod === "e") && ol.eslesme !== eslesmeSayisi(kural)) throw new Error(`(${y.kod}) eşleşme sayısı (a) ile aynı olmalı`);
          satirlar.push({
            yuk: nYuk,
            oran,
            arac: nArac,
            tohum: s,
            yontem: y.kod,
            ...ol,
            sureMs: ms,
            adayMatrisiMs: adayMs,
            uygunCift: a.uygunCiftSayisi,
          });
        }
      }
      log(`  Deney 1: ${nYuk} yük × oran ${oran} bitti (${((performance.now() - t0) / 1000).toFixed(1)} sn)`);
    }
  }

  csvYaz(
    `${ciktiDizini}/deney1_ham.csv`,
    satirlar.map((r) => ({ ...r })),
  );

  // ── Özet ve eşleştirilmiş farklar ──
  const grup = (n: number, oran: number, y: Kod) =>
    satirlar.filter((r) => r.yuk === n && r.oran === oran && r.yontem === y).sort((p, q) => p.tohum - q.tohum);

  const ozetSatir: Record<string, string | number>[] = [];
  const farkSatir: (Record<string, string | number> & { pT: number; pW: number })[] = [];
  const KARSILASTIRMALAR: [Kod, Kod][] = [
    ["a", "b"],
    ["a", "c"],
    ["c", "b"],
    ["a", "d"],
    ["a", "e"],
    ["e", "b"],
  ];

  for (const n of DENEY1.yukSayilari) {
    for (const oran of DENEY1.aracYukOranlari) {
      for (const y of YONTEMLER) {
        const g = grup(n, oran, y.kod);
        for (const ol of [...OLCUTLER.map((x) => x.k), "sureMs", "adayMatrisiMs", "uygunCift"] as const) {
          const z = ozet(g.map((r) => r[ol]));
          ozetSatir.push({ yuk: n, oran, yontem: y.kod, olcut: ol, n: z.n, ort: z.ort, ss: z.ss, gaAlt: z.gaAlt, gaUst: z.gaUst });
        }
      }
      for (const [x, yk] of KARSILASTIRMALAR) {
        const gx = grup(n, oran, x);
        const gy = grup(n, oran, yk);
        for (const ol of OLCUTLER) {
          const f = eslestirilmisFark(
            gx.map((r) => r[ol.k]),
            gy.map((r) => r[ol.k]),
          );
          farkSatir.push({
            yuk: n,
            oran,
            fark: `${yk}-${x}`,
            olcut: ol.k,
            n: f.n,
            ortFark: f.ort,
            ss: f.ss,
            gaAlt: f.gaAlt,
            gaUst: f.gaUst,
            t: f.tDegeri,
            pT: f.pT,
            wilcoxonW: f.wilcoxonW,
            wilcoxonN: f.wilcoxonN,
            pW: f.pWilcoxon,
          });
        }
      }
    }
  }
  // Holm düzeltmesi: Deney 1'deki tüm eşleştirilmiş testler tek aile
  const hT = holm(farkSatir.map((r) => r.pT));
  const hW = holm(farkSatir.map((r) => r.pW));
  farkSatir.forEach((r, i) => {
    r.pT_holm = hT[i]!;
    r.pW_holm = hW[i]!;
  });
  csvYaz(`${ciktiDizini}/deney1_ozet.csv`, ozetSatir);
  csvYaz(`${ciktiDizini}/deney1_farklar.csv`, farkSatir);

  writeFileSync(`${ciktiDizini}/deney1.md`, rapor(satirlar, ozetSatir, farkSatir, tohumSayisi, mesafe), "utf8");
  return { satirlar, sureSn: (performance.now() - t0) / 1000 };
}

function rapor(
  satirlar: Satir[],
  oz: Record<string, string | number>[],
  fk: Record<string, string | number>[],
  tohumSayisi: number,
  mesafe: Mesafe,
): string {
  const bul = (n: number, oran: number, y: string, ol: string) => {
    const r = oz.find((x) => x.yuk === n && x.oran === oran && x.yontem === y && x.olcut === ol);
    if (!r) throw new Error(`özet yok ${n} ${oran} ${y} ${ol}`);
    return r as { ort: number; ss: number; gaAlt: number; gaUst: number };
  };
  const farkBul = (n: number, oran: number, fark: string, ol: string) => {
    const r = fk.find((x) => x.yuk === n && x.oran === oran && x.fark === fark && x.olcut === ol);
    if (!r) throw new Error(`fark yok ${n} ${oran} ${fark} ${ol}`);
    return r as { ortFark: number; gaAlt: number; gaUst: number; pT_holm: number; pW_holm: number };
  };
  const ga = (o: { ort: number; gaAlt: number; gaUst: number }, d: number, carp = 1) =>
    `${sayi(o.ort * carp, d)} [${sayi(o.gaAlt * carp, d)}; ${sayi(o.gaUst * carp, d)}]`;

  const s: string[] = [];
  s.push(`# Deney 1 sonuçları — kural tabanlı ve Macar algoritması eşleştirmesi`);
  s.push("");
  s.push(
    `Her hücre ${tohumSayisi} bağımsız tohumun ortalaması; köşeli parantezde %95 güven aralığı (t dağılımı). Boş km kaynağı: **${mesafe.aciklama}**. ` +
      `Yöntemler: (a) kural tabanlı (sistem), (b) Macar – önce eşleşme sayısı en çok, sonra toplam boş km en az, (c) Macar – önce eşleşme sayısı en çok, sonra BR-21 skor toplamı en çok, ` +
      `ve iki karşılaştırma ölçütü: (d) (a)'nın eşleştirdiği yüklerin aynısına, hepsi eşleşecek biçimde toplam boş km'si en az araç ataması (alt matriste Macar); ` +
      `(e) (a) ile aynı sayıda eşleşme yapan, hangi yüklerin eşleşeceğini de serbestçe seçen, toplam boş km'si en az atama (en az maliyetli akış). ` +
      `(b)−(a) boş km farkı "daha çok yük eşleşti" etkisiyle karışır; bu yüzden: (d)−(a) = aynı yüklere daha iyi araç seçiminin kazancı, ` +
      `(e)−(d) = aynı sayıda ama farklı (daha kolay) yükleri seçmenin ek kazancı, (b)−(e) = fazladan eşleştirilen yüklerin getirdiği boş km.`,
  );
  s.push("");
  s.push(
    `"Eşleşme başına" ölçütler ve ortalama skor yalnız en az bir eşleşme olan tohumlar üzerinden hesaplanır (geçerli tohum sayısı: \`deney1_ozet.csv\`, n sütunu). ` +
      `Oranların GA alt sınırı küçük örneklerde sıfırın altına düşebilir (t aralığı simetriktir); bu yalnız belirsizliğin büyüklüğünü gösterir.`,
  );
  s.push("");

  s.push(`## 1. Örnek yapısı`);
  s.push("");
  s.push(
    mdTablo(
      ["Yük", "Araç/yük", "Araç", "Uygun çift (ort.)", "Yük başına uygun araç", "En çok eşleşme oranı, %"],
      DENEY1.yukSayilari.flatMap((n) =>
        DENEY1.aracYukOranlari.map((oran) => {
          const u = bul(n, oran, "a", "uygunCift");
          const enCok = bul(n, oran, "b", "eslesmeOrani");
          return [String(n), sayi(oran, 1), String(Math.round(n * oran)), sayi(u.ort, 0), sayi(u.ort / n, 2), yuzde(enCok.ort)];
        }),
      ),
    ),
  );
  s.push("");
  s.push(`"En çok eşleşme oranı" (b) ve (c)'nin bulduğu en büyük eşleşme sayısıdır (uygunluk kısıtı altında ulaşılabilecek üst sınır).`);
  s.push("");

  s.push(`## 2. Yöntemlere göre ölçütler`);
  s.push("");
  const satir2: string[][] = [];
  for (const n of DENEY1.yukSayilari)
    for (const oran of DENEY1.aracYukOranlari)
      for (const y of YONTEMLER)
        satir2.push([
          String(n),
          sayi(oran, 1),
          y.kod,
          ga(bul(n, oran, y.kod, "eslesmeOrani"), 1, 100),
          ga(bul(n, oran, y.kod, "ortBosKm"), 1),
          ga(bul(n, oran, y.kod, "toplamBosKm"), 0),
          ga(bul(n, oran, y.kod, "ortSkor"), 3),
        ]);
  s.push(mdTablo(["Yük", "Araç/yük", "Yöntem", "Eşleşme oranı, %", "Eşleşme başına boş km", "Toplam boş km", "Ort. skor"], satir2));
  s.push("");

  s.push(`## 3. Eşleştirilmiş farklar (aynı örnekler üzerinde)`);
  s.push("");
  s.push(
    `Fark = ikinci − birinci yöntem (ör. "b−a": Macar boş km − kural tabanlı). Köşeli parantez: farkın %95 GA'sı. p: eşleştirilmiş t testi ve Wilcoxon işaretli sıralar testi, ` +
      `Deney 1'deki ${fk.length} testin tamamı üzerinde Holm düzeltmeli. Tam liste: \`deney1_farklar.csv\`.`,
  );
  s.push("");
  const farkTablo = (ol: OlcutKod, baslik: string, d: number, carp = 1, farklar = ["b-a", "c-a", "b-c"]) => {
    s.push(`### ${baslik}`);
    s.push("");
    const sat: string[][] = [];
    for (const n of DENEY1.yukSayilari)
      for (const oran of DENEY1.aracYukOranlari) {
        const r: string[] = [String(n), sayi(oran, 1)];
        for (const f of farklar) {
          const x = farkBul(n, oran, f, ol);
          r.push(`${sayi(x.ortFark * carp, d)} [${sayi(x.gaAlt * carp, d)}; ${sayi(x.gaUst * carp, d)}]`, `${pDegeri(x.pT_holm)} / ${pDegeri(x.pW_holm)}`);
        }
        sat.push(r);
      }
    s.push(mdTablo(["Yük", "Araç/yük", ...farklar.flatMap((f) => [f.replace("-", "−"), "p (t / W)"])], sat));
    s.push("");
  };
  farkTablo("eslesmeOrani", "Eşleşme oranı farkı (yüzde puanı)", 2, 100);
  farkTablo("toplamBosKm", "Toplam boş km farkı", 0, 1, ["d-a", "e-a", "b-e", "b-a"]);
  farkTablo("ortBosKm", "Eşleşme başına boş km farkı", 1, 1, ["d-a", "e-a", "b-a", "c-a"]);
  farkTablo("ortSkor", "Ortalama skor farkı", 4, 1, ["b-a", "c-a", "d-a", "b-c"]);

  s.push(`### Göreli toplam boş km farkı (kural tabanlıya göre, %)`);
  s.push("");
  s.push(
    `Her tohumda (x − a) / a × 100, sonra tohumlar üzerinden ortalama [%95 GA]; (a)'nın hiç eşleşmediği tohumlar hariç. ` +
      `(d) ve (e) (a) ile aynı sayıda yük eşleştirir; (b) daha çok yük eşleştirdiği için doğrudan "tasarruf" olarak okunmamalıdır.`,
  );
  s.push("");
  const goreli = (n: number, oran: number, x: Kod) => {
    const ga_ = satirlar.filter((r) => r.yuk === n && r.oran === oran && r.yontem === "a").sort((p, q) => p.tohum - q.tohum);
    const gx = satirlar.filter((r) => r.yuk === n && r.oran === oran && r.yontem === x).sort((p, q) => p.tohum - q.tohum);
    return ozet(ga_.map((r, i) => (r.toplamBosKm > 0 ? ((gx[i]!.toplamBosKm - r.toplamBosKm) / r.toplamBosKm) * 100 : NaN)));
  };
  const satG: string[][] = [];
  for (const n of DENEY1.yukSayilari)
    for (const oran of DENEY1.aracYukOranlari) satG.push([String(n), sayi(oran, 1), ga(goreli(n, oran, "d"), 1), ga(goreli(n, oran, "e"), 1), ga(goreli(n, oran, "b"), 1), ga(goreli(n, oran, "c"), 1)]);
  s.push(mdTablo(["Yük", "Araç/yük", "(d) aynı yükler", "(e) aynı sayı", "(b) Macar km", "(c) Macar skor"], satG));
  s.push("");

  s.push(`## 4. Çalışma süresi (ms, bu makinede)`);
  s.push("");
  s.push(
    `"Aday matrisi": tüm yük × araç çiftleri için shared \`matchLoadWithCapacity\` + boş km hesabı; tüm yöntemlerde ortaktır (sistemde bu adım PostGIS ön süzgeciyle yapılır). ` +
      `Yöntem süreleri aday matrisi hazırken atama adımının süresidir. Ölçüm tek iş parçacığında \`performance.now()\` ile, ısınma turundan sonra alınmıştır; makineye bağlıdır, mutlak değil göreli okunmalıdır.`,
  );
  s.push("");
  const sat4: string[][] = [];
  for (const n of DENEY1.yukSayilari)
    for (const oran of DENEY1.aracYukOranlari)
      sat4.push([
        String(n),
        sayi(oran, 1),
        ga(bul(n, oran, "a", "adayMatrisiMs"), 1),
        ga(bul(n, oran, "a", "sureMs"), 2),
        ga(bul(n, oran, "b", "sureMs"), 1),
        ga(bul(n, oran, "c", "sureMs"), 1),
        ga(bul(n, oran, "d", "sureMs"), 1),
        ga(bul(n, oran, "e", "sureMs"), 1),
      ]);
  s.push(mdTablo(["Yük", "Araç/yük", "Aday matrisi", "(a) kural", "(b) Macar km", "(c) Macar skor", "(d) aynı yükler", "(e) aynı sayı"], sat4));
  s.push("");
  s.push(`Ham satır sayısı: ${satirlar.length}.`);
  s.push("");
  return s.join("\n");
}
