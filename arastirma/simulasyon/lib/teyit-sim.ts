// Deney 3: canlı ilan teyidinin (F1, BR-01…05) ilan tazeliğine etkisi — ilan başına ayrık olay simülasyonu.
//
// Sistem davranışı shared'dan ve API'deki zamanlayıcıdan (apps/api/src/loads/confirmation.service.ts) alınmıştır:
//  - Zamanlayıcı her 5 dakikada bir tur atar; turda sıra: durum düşürme (evaluateLoadStatus) → yeni sorular
//    (status = teyitli, reminderSentAt boş, nextReminderAt ≤ şimdi) → SMS yedeği (soru 30 dk cevapsız).
//  - Cevap (uygulama/SMS) anında işlenir: "geçerli" → teyitli, lastConfirmedAt = şimdi, nextReminderAt = nextReminderAt(…).
//  - BR-05: "teyitli" ilanda son teyitten sonraki şikayet sayısı eşiğe ulaşınca durum "teyit bekliyor",
//    reminderSentAt = şimdi − cevap penceresi; açık soru yoksa yeni soru açılır.
// Kurallar shared'daki fonksiyonların kendisidir (parametre alırlar; kopya gerekmedi). İlanlar birbirinden bağımsızdır,
// bu yüzden her ilan ayrı simüle edilir. Hız için zamanlayıcının "hiçbir şeyin değişmeyeceği" turları atlanır; bunun
// her turu tek tek çalıştırmakla birebir aynı sonucu verdiği test/teyit.test.ts'te sınanır (herTik seçeneği).
import {
  applyConfirmationAnswer,
  evaluateLoadStatus,
  nextReminderAt,
  shouldForceReconfirm,
  shouldSendSmsFallback,
  trDay,
  trDayEnd,
  trDayStart,
  type ConfirmationParams,
  type LoadStatus,
} from "@nakliye/shared";
import { gunEkle } from "./uretici.js";
import { Rastgele, tohumBirlestir } from "./prng.js";

export const DK = 60_000;
export const SAAT = 3_600_000;
const GUN = 24 * SAAT;
const TR_OFSET = 3 * SAAT;
/** PeriodicScheduler turu (apps/api) */
export const TIK_MS = 5 * DK;

export interface Davranis {
  /** Soruya cevap verme olasılığı */
  p: number;
  cevapMedyanDk: number;
  cevapSigma: number;
  /** Yük gidince sorulmadan kapatma olasılığı */
  q: number;
  kapamaMedyanSaat: number;
  kapamaSigma: number;
  gitmeMedyanSaat: number;
  gitmeSigma: number;
  uykuBaslangicSaat: number;
  uykuBitisSaat: number;
  uyanmaGecikmesiDk: number;
  bayatSikayetOraniSaatte: number;
  yersizSikayetOraniSaatte: number;
}

export interface Senaryo {
  ad: string;
  /** false = Senaryo A (teyit sorusu yok; ilan sahibi kapatana ya da yükleme aralığı bitene kadar listede) */
  teyit: boolean;
  /** BR-05 şikayetle anında teyit */
  br05: boolean;
  params: ConfirmationParams;
  /** docs/03 §8 ilan tazeliği penceresi */
  tazelikPenceresiSaat: number;
}

export interface TeyitIlani {
  id: number;
  verildi: number;
  loadFrom: string;
  loadTo: string;
  /** Yükün gerçekte gittiği an (araç bulundu ya da vazgeçildi); bundan sonra ilan bayattır */
  gitti: number;
  /** Sahibin sorulmadan kapattığı an (yoksa Infinity) */
  kendiligindenKapama: number;
  /** Sırayla kullanılacak "yük yok" şikayet anları (geçerliyken yersiz, gittikten sonra yerinde) */
  sikayetler: number[];
  /** Cevap davranışı alt akışının tohumu */
  cevapTohumu: number;
}

export type Bitis = "sahip_kapatti_soruyla" | "sahip_kapatti_kendiliginden" | "cevapsiz_dustu" | "tarih_bitti";

export interface IlanSonucu {
  gorunurMs: number;
  bayatMs: number;
  /** Bayat ve hâlâ "teyitli" (sarı rozetsiz, üstte) görünen süre */
  bayatTeyitliMs: number;
  tazeMs: number;
  bekliyorMs: number;
  soru: number;
  sms: number;
  br05Tetik: number;
  bitis: Bitis;
  bitisAni: number;
  /** Yük hâlâ geçerliyken cevapsızlıktan düştü */
  yanlisDusme: boolean;
  /** Yanlış düşmede: ilanın düşmeseydi geçerli olarak listede kalacağı süre */
  kayipGecerliMs: number;
  gecisler: { t: number; durum: LoadStatus; neden: string }[];
}

/** Uyku saatlerine düşen insan eylemini uyanma anına (+ rastgele gecikme) kaydırır. Her çağrıda tam bir sayı tüketir. */
export function uyanikZaman(t: number, d: Davranis, r: Rastgele): number {
  const ek = r.duzgun(0, d.uyanmaGecikmesiDk) * DK;
  const tr = t + TR_OFSET;
  const gunBasi = Math.floor(tr / GUN) * GUN;
  const saat = (tr - gunBasi) / SAAT;
  const uykuda =
    d.uykuBaslangicSaat > d.uykuBitisSaat
      ? saat >= d.uykuBaslangicSaat || saat < d.uykuBitisSaat
      : saat >= d.uykuBaslangicSaat && saat < d.uykuBitisSaat;
  if (!uykuda) return t;
  let uyanmaTr = gunBasi + d.uykuBitisSaat * SAAT;
  if (uyanmaTr <= tr) uyanmaTr += GUN;
  return uyanmaTr - TR_OFSET + ek;
}

/** Tek soruya verilecek cevap: her soruda aynı sayıda rastgele sayı tüketilir (senaryolar arası ortak rastgele sayılar). */
function cevapCek(sorulduAni: number, d: Davranis, r: Rastgele): number {
  const cevapVar = r.bernoulli(d.p);
  const gecikme = r.lognormal(d.cevapMedyanDk, d.cevapSigma) * DK;
  const an = uyanikZaman(sorulduAni + gecikme, d, r);
  return cevapVar ? an : Infinity;
}

const tikSonra = (x: number, t: number) => Math.ceil(Math.max(x, t + 1) / TIK_MS) * TIK_MS;

/**
 * Bir ilanı yayından kalkana kadar simüle eder.
 * @param herTik true ise zamanlayıcı her 5 dakikada bir çalıştırılır (yavaş; doğrulama için)
 */
export function ilanSimule(ilan: TeyitIlani, s: Senaryo, d: Davranis, herTik = false): IlanSonucu {
  const p = s.params;
  const rc = new Rastgele(ilan.cevapTohumu);
  const lfs = trDayStart(ilan.loadFrom).getTime();
  const lte = trDayEnd(ilan.loadTo).getTime();
  const tazelikMs = s.tazelikPenceresiSaat * SAAT;

  let t = ilan.verildi;
  let durum: LoadStatus = "teyitli"; // BR-01
  let sonTeyit = t;
  /** load_posts.reminder_sent_at */
  let soruAni: number | null = null;
  let sonrakiSoru = s.teyit ? nextReminderAt(new Date(t), new Date(lfs), p).getTime() : Infinity;
  /** load_confirmations: açık sorunun soruluş anı, cevap anı, SMS durumu */
  let acikSoruSoruldu: number | null = null;
  let cevapAni = Infinity;
  let smsGitti = false;
  let sikayetIdx = 0;
  let sikayetSayaci = 0;

  const o: IlanSonucu = {
    gorunurMs: 0,
    bayatMs: 0,
    bayatTeyitliMs: 0,
    tazeMs: 0,
    bekliyorMs: 0,
    soru: 0,
    sms: 0,
    br05Tetik: 0,
    bitis: "tarih_bitti",
    bitisAni: t,
    yanlisDusme: false,
    kayipGecerliMs: 0,
    gecisler: [{ t, durum, neden: "yayin" }],
  };
  const gec = (yeni: LoadStatus, neden: string) => {
    durum = yeni;
    o.gecisler.push({ t, durum, neden });
  };

  const soruAc = () => {
    acikSoruSoruldu = t;
    smsGitti = false;
    o.soru++;
    cevapAni = cevapCek(t, d, rc);
  };

  const biriktir = (a: number, b: number) => {
    if (b <= a) return;
    const sure = b - a;
    o.gorunurMs += sure;
    if (durum === "teyit_bekliyor") o.bekliyorMs += sure;
    const bayat = Math.max(0, b - Math.max(a, ilan.gitti));
    o.bayatMs += bayat;
    if (durum === "teyitli") o.bayatTeyitliMs += bayat;
    o.tazeMs += Math.max(0, Math.min(b, sonTeyit + tazelikMs) - a);
  };

  const sonrakiTik = (): number => {
    if (herTik) return tikSonra(t + 1, t);
    let x = tikSonra(lte + 1, t); // yükleme aralığı bitti → süresi doldu
    if (s.teyit && durum === "teyitli" && soruAni === null) x = Math.min(x, tikSonra(sonrakiSoru, t));
    if (soruAni !== null) {
      if (durum === "teyitli") x = Math.min(x, tikSonra(soruAni + p.answerWindowH * SAAT, t));
      x = Math.min(x, tikSonra(soruAni + (p.answerWindowH + p.pendingGraceH) * SAAT, t));
    }
    if (acikSoruSoruldu !== null && !smsGitti) x = Math.min(x, tikSonra(acikSoruSoruldu + p.smsFallbackMin * DK, t));
    return x;
  };

  for (let guvenlik = 0; ; guvenlik++) {
    if (guvenlik > 1_000_000) throw new Error(`İlan ${ilan.id}: olay döngüsü bitmedi`);
    const tTik = sonrakiTik();
    const tSik = s.br05 ? (ilan.sikayetler[sikayetIdx] ?? Infinity) : Infinity;
    const tNext = Math.min(tTik, cevapAni, ilan.kendiligindenKapama, tSik);
    biriktir(t, tNext);
    t = tNext;

    // İnsan eylemleri zamanlayıcı turundan önce (aynı milisaniyeye denk gelmesi pratikte olmaz)
    if (t === ilan.kendiligindenKapama) {
      gec(applyConfirmationAnswer("arac_bulundu"), "sahip_kapatti");
      o.bitis = "sahip_kapatti_kendiliginden";
      break;
    }
    if (t === cevapAni) {
      cevapAni = Infinity;
      acikSoruSoruldu = null;
      if (t >= ilan.gitti) {
        gec(applyConfirmationAnswer("arac_bulundu"), "cevap_gitti");
        o.bitis = "sahip_kapatti_soruyla";
        break;
      }
      // API: yükleme tarihi geçmişse "geçerli" kabul edilmez (ilan bir sonraki turda zaten düşer)
      if (ilan.loadTo < trDay(new Date(t))) continue;
      gec(applyConfirmationAnswer("gecerli"), "cevap_gecerli");
      sonTeyit = t;
      soruAni = null;
      sonrakiSoru = nextReminderAt(new Date(t), new Date(lfs), p).getTime();
      sikayetSayaci = 0;
      continue;
    }
    if (t === tSik) {
      sikayetIdx++;
      sikayetSayaci++;
      if (durum === "teyitli" && shouldForceReconfirm(sikayetSayaci, p)) {
        o.br05Tetik++;
        gec("teyit_bekliyor", "br05");
        soruAni = t - p.answerWindowH * SAAT;
        if (acikSoruSoruldu === null) soruAc();
      }
      continue;
    }

    // Zamanlayıcı turu: 1) durum düşürme
    const yeni = evaluateLoadStatus(
      {
        status: durum,
        lastConfirmedAt: new Date(sonTeyit),
        reminderSentAt: soruAni === null ? null : new Date(soruAni),
        loadFromStart: new Date(lfs),
        loadToEnd: new Date(lte),
      },
      new Date(t),
      p,
    );
    if (yeni !== durum) {
      gec(yeni, "zamanlayici");
      if (yeni === "suresi_doldu") {
        o.bitis = t > lte ? "tarih_bitti" : "cevapsiz_dustu";
        break;
      }
    }
    // 2) "Hâlâ geçerli mi?" sorusu (BR-02)
    if (s.teyit && durum === "teyitli" && soruAni === null && sonrakiSoru <= t) {
      soruAni = t;
      soruAc();
    }
    // 3) SMS yedeği: soru açık ve push açılmadı (cevap = push açıldı varsayımı)
    if (acikSoruSoruldu !== null && !smsGitti && shouldSendSmsFallback(new Date(acikSoruSoruldu), false, new Date(t), p)) {
      smsGitti = true;
      o.sms++;
    }
  }

  o.bitisAni = t;
  if (o.bitis === "cevapsiz_dustu" && ilan.gitti > t) {
    o.yanlisDusme = true;
    o.kayipGecerliMs = Math.min(ilan.gitti, lte) - t;
  }
  return o;
}

/**
 * Bir tohum için ilan kümesi. Her ilanın kendi alt akışları vardır (temel özellikler / cevaplar / şikayetler);
 * böylece senaryolar aynı ilanlar ve aynı insan davranışı üzerinde karşılaştırılır (ortak rastgele sayılar).
 */
export function teyitIlanlariUret(
  tohum: number,
  d: Davranis,
  cfg: {
    referansGun: string;
    gunSayisi: number;
    gunlukIlan: number;
    ilanSaatiAgirligi: readonly number[];
    yuklemeOfsetGun: readonly (readonly [number, number])[];
    yuklemeAralikGun: readonly (readonly [number, number])[];
  },
): TeyitIlani[] {
  const n = cfg.gunSayisi * cfg.gunlukIlan;
  const saatler = cfg.ilanSaatiAgirligi.map((w, h) => [h, w] as const);
  const ilanlar: TeyitIlani[] = [];
  for (let i = 0; i < n; i++) {
    const r = new Rastgele(tohumBirlestir(tohum, i, 1));
    const gun = gunEkle(cfg.referansGun, Math.floor(i / cfg.gunlukIlan));
    const saat = r.agirlikli(saatler);
    const verildi = trDayStart(gun).getTime() + saat * SAAT + Math.floor(r.duzgun(0, 60)) * DK;
    const loadFrom = gunEkle(gun, r.agirlikli(cfg.yuklemeOfsetGun));
    const loadTo = gunEkle(loadFrom, r.agirlikli(cfg.yuklemeAralikGun));
    const gitti = verildi + r.lognormal(d.gitmeMedyanSaat, d.gitmeSigma) * SAAT;
    const qCek = r.sayi();
    const kapamaGecikme = r.lognormal(d.kapamaMedyanSaat, d.kapamaSigma) * SAAT;
    const kapamaAni = uyanikZaman(gitti + kapamaGecikme, d, r);
    const kendiligindenKapama = qCek < d.q ? kapamaAni : Infinity;

    // Şikayetler: geçerli dönemde yersiz, gittikten sonra yerinde; homojen Poisson süreçleri
    const rs = new Rastgele(tohumBirlestir(tohum, i, 3));
    const lte = trDayEnd(loadTo).getTime();
    const sikayetler: number[] = [];
    const surec = (bas: number, son: number, oranSaatte: number) => {
      if (oranSaatte <= 0) return;
      for (let x = bas + rs.ustel(SAAT / oranSaatte); x < son; x += rs.ustel(SAAT / oranSaatte)) sikayetler.push(x);
    };
    surec(verildi, Math.min(gitti, lte), d.yersizSikayetOraniSaatte);
    surec(gitti, lte, d.bayatSikayetOraniSaatte);

    ilanlar.push({ id: i, verildi, loadFrom, loadTo, gitti, kendiligindenKapama, sikayetler, cevapTohumu: tohumBirlestir(tohum, i, 2) });
  }
  return ilanlar;
}

export interface CalismaOlcutleri {
  ilan: number;
  /** Görünen ilan-saatlerinin bayat payı */
  bayatOrani: number;
  /** Bayat ve hâlâ "teyitli" görünen ilan-saat payı */
  bayatTeyitliOrani: number;
  ilanBasinaBayatSaat: number;
  /** docs/03 §8: görünen ilan-saatlerinin son 24 saatte teyitli payı (zaman ortalaması) */
  tazelik: number;
  bekliyorPayi: number;
  yanlisDusmeOrani: number;
  ilanBasinaKayipGecerliSaat: number;
  cevapsizDusmeOrani: number;
  ilanBasinaSoru: number;
  ilanBasinaSms: number;
  br05TetikOrani: number;
}

export function calistir(ilanlar: readonly TeyitIlani[], s: Senaryo, d: Davranis): CalismaOlcutleri {
  let gorunur = 0,
    bayat = 0,
    bayatTeyitli = 0,
    taze = 0,
    bekliyor = 0,
    yanlis = 0,
    kayip = 0,
    cevapsiz = 0,
    soru = 0,
    sms = 0,
    br05 = 0;
  for (const il of ilanlar) {
    const r = ilanSimule(il, s, d);
    gorunur += r.gorunurMs;
    bayat += r.bayatMs;
    bayatTeyitli += r.bayatTeyitliMs;
    taze += r.tazeMs;
    bekliyor += r.bekliyorMs;
    if (r.yanlisDusme) yanlis++;
    kayip += r.kayipGecerliMs;
    if (r.bitis === "cevapsiz_dustu") cevapsiz++;
    soru += r.soru;
    sms += r.sms;
    if (r.br05Tetik > 0) br05++;
  }
  const n = ilanlar.length;
  return {
    ilan: n,
    bayatOrani: bayat / gorunur,
    bayatTeyitliOrani: bayatTeyitli / gorunur,
    ilanBasinaBayatSaat: bayat / n / SAAT,
    tazelik: taze / gorunur,
    bekliyorPayi: bekliyor / gorunur,
    yanlisDusmeOrani: yanlis / n,
    ilanBasinaKayipGecerliSaat: kayip / n / SAAT,
    cevapsizDusmeOrani: cevapsiz / n,
    ilanBasinaSoru: soru / n,
    ilanBasinaSms: sms / n,
    br05TetikOrani: br05 / n,
  };
}
