// Simülasyonları çalıştırır ve sonuclar/ altına yazar.
//   npx tsx arastirma/simulasyon/calistir.ts                 # tümü (Deney 1, 2, 3)
//   npx tsx arastirma/simulasyon/calistir.ts --deney=1       # yalnız Deney 1 (ya da --deney=2, --deney=3)
//   npx tsx arastirma/simulasyon/calistir.ts --tohum=5       # hızlı deneme (varsayılan 30)
//   npx tsx arastirma/simulasyon/calistir.ts --haversine     # OSRM'i hiç deneme, kuş uçuşu × 1,3 (Deney 2'de rota: doğru çizgi)
// Çıktı dizini --tohum verilince sonuclar/deneme-<n>/ olur (asıl sonuçların üzerine yazmasın diye).
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deney1 } from "./deney1.js";
import { deney2, deney2Ciftleri } from "./deney2.js";
import { deney3 } from "./deney3.js";
import { konumlariYukle } from "./lib/konum.js";
import { mesafeHazirla, type Mesafe } from "./lib/mesafe.js";
import { rotalarHazirla } from "./lib/rota.js";
import { KOK_TOHUM, TOHUM_SAYISI } from "./parametreler.js";

const arg = (ad: string) => process.argv.find((a) => a === `--${ad}` || a.startsWith(`--${ad}=`));
const deger = (ad: string) => arg(ad)?.split("=")[1];

const tohumSayisi = deger("tohum") ? Number(deger("tohum")) : TOHUM_SAYISI;
if (!Number.isInteger(tohumSayisi) || tohumSayisi < 2) throw new Error("--tohum en az 2 olmalı");
const deney = deger("deney");
const zorlaHaversine = !!arg("haversine");

const kok = fileURLToPath(new URL("./sonuclar/", import.meta.url));
const cikti = deger("tohum") || zorlaHaversine ? `${kok}deneme-${tohumSayisi}${zorlaHaversine ? "-haversine" : ""}` : kok.replace(/[\\/]$/, "");
mkdirSync(cikti, { recursive: true });

const log = (s: string) => console.log(s);
const basla = performance.now();
const bilgi: Record<string, unknown> = {
  tarih: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  kokTohum: KOK_TOHUM,
  tohumSayisi,
};

const k = konumlariYukle();
log(`Konum verisi: ${k.iller.length} il, ${k.ilceler.length} ilçe`);

let mesafe: Mesafe | null = null;
const mesafeAl = async () => {
  if (!mesafe) {
    mesafe = await mesafeHazirla(k, zorlaHaversine, log);
    bilgi.mesafeKaynagi = mesafe.tur;
    bilgi.mesafeAciklama = mesafe.aciklama;
  }
  return mesafe;
};

if (!deney || deney === "1") {
  const mesafe = await mesafeAl();
  log(`Deney 1 başlıyor (${tohumSayisi} tohum)…`);
  const r = deney1(k, mesafe, tohumSayisi, cikti, log);
  bilgi.deney1Sn = Math.round(r.sureSn);
  log(`Deney 1 bitti: ${r.sureSn.toFixed(1)} sn`);
}

if (!deney || deney === "2") {
  const m = await mesafeAl();
  const rotalar = await rotalarHazirla(k, deney2Ciftleri(k, m, tohumSayisi), zorlaHaversine, log);
  bilgi.rotaKaynagi = rotalar.tur;
  bilgi.rotaAciklama = rotalar.aciklama;
  log(`Deney 2 başlıyor (${tohumSayisi} tohum)…`);
  const r = deney2(k, m, rotalar, tohumSayisi, cikti, log);
  bilgi.rotaYedekSayisi = rotalar.yedekSayisi;
  bilgi.deney2Sn = Math.round(r.sureSn);
  log(`Deney 2 bitti: ${r.sureSn.toFixed(1)} sn`);
}

if (!deney || deney === "3") {
  log(`Deney 3 başlıyor (${tohumSayisi} tohum)…`);
  const r = deney3(tohumSayisi, cikti, log);
  bilgi.deney3Sn = Math.round(r.sureSn);
  log(`Deney 3 bitti: ${r.sureSn.toFixed(1)} sn`);
}

bilgi.toplamSn = Math.round((performance.now() - basla) / 1000);
writeFileSync(`${cikti}/calisma_bilgisi${deney ? `_deney${deney}` : ""}.json`, JSON.stringify(bilgi, null, 2) + "\n", "utf8");
log(`Sonuçlar: ${cikti} (toplam ${bilgi.toplamSn} sn)`);
