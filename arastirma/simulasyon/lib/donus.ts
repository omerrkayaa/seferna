// Deney 2: dönüş planı (F4). Gidiş işleri + pazar yükleri, shared kurallarıyla dönüş adayları, atama yöntemleri, ölçütler.
// Kurallar KOPYALANMAZ: tahmini varış, dönüş penceresi, sanal boş araç ilanı (BR-20) ve rota üstü (BR-23) shared'dan.
import {
  DEFAULT_MATCH_PARAMS,
  RETURN_PLAN_PARAMS,
  estimatedArrivalDay,
  fitRejectReason,
  matchLoadWithCapacity,
  onRouteMatch,
  returnCapacity,
  returnWindow,
  type BodyType,
  type MatchParams,
  type ReturnPlanParams,
  type VehicleType,
} from "@nakliye/shared";
import { DENEY2, KAPASITE_ARALIGI, KASA_DAGILIMI, REFERANS_GUN } from "../parametreler.js";
import { ilce, ilceKonum, type KonumVerisi } from "./konum.js";
import { kareDisiMacar } from "./macar.js";
import type { Mesafe } from "./mesafe.js";
import { Rastgele } from "./prng.js";
import type { RotaKaynagi } from "./rota.js";
import { yukEslestirmeGirdisi, type SentetikYuk, type Uretici } from "./uretici.js";

/** Bir aracın gidiş işi. Ev = işin kalkış ilçesi (API'deki dönüş planı da böyle varsayar). */
export interface GidisIsi {
  id: number;
  kalkisIlce: number;
  varisIlce: number;
  loadFrom: string;
  vehicle: { type: VehicleType; bodyType: BodyType; capacityTon: number };
  /** shared estimatedArrivalDay (teslim edilmemiş, gecikmesiz) */
  varisGunu: string;
  /** Gidiş yüklü km (karayolu) */
  yukluKm: number;
}

export interface PazarYuku extends SentetikYuk {
  /** Yük sahibinin güven skoru (BR-21 skorunda nakliyeci tarafından bakılırken) */
  sahipGuven: number;
}

export interface DonusOrnegi {
  isler: GidisIsi[];
  pazar: PazarYuku[];
}

/**
 * Gidiş işleri ve pazar yükleri ayrı tohumlardan. İşler sıralı üretilir: aynı tohumda 50 işin ilk 50'si, 100 işinkiyle
 * aynıdır (iç içe). İşin aracı yükün istediği tiptir; kasa yük istiyorsa o, istemiyorsa tipin kasa dağılımından;
 * kapasite tip aralığından ama yükten az olamaz.
 */
export function donusOrnegi(u: Uretici, k: KonumVerisi, mesafe: Mesafe, tohumIs: number, tohumPazar: number, nIs: number, nPazar: number): DonusOrnegi {
  const ri = new Rastgele(tohumIs);
  const isler: GidisIsi[] = [];
  let sira = 0;
  while (isler.length < nIs) {
    const y = u.yuk(ri, sira++);
    if (DENEY2.gidisIlDisi && ilce(k, y.kalkisIlce).provinceId === ilce(k, y.varisIlce).provinceId) continue;
    const type = y.vehicleType;
    const bodyType = y.bodyType ?? ri.agirlikli(KASA_DAGILIMI[type]);
    const [alt, ust] = KAPASITE_ARALIGI[type];
    const capacityTon = Math.max(y.weightTon, Math.round(ri.duzgun(alt, ust) * 10) / 10);
    const yukluKm = mesafe.km(y.kalkisIlce, y.varisIlce);
    isler.push({
      id: isler.length,
      kalkisIlce: y.kalkisIlce,
      varisIlce: y.varisIlce,
      loadFrom: y.loadFrom,
      vehicle: { type, bodyType, capacityTon },
      varisGunu: estimatedArrivalDay({ loadFrom: y.loadFrom, roadKm: yukluKm, deliveredDay: null }, REFERANS_GUN),
      yukluKm,
    });
  }
  const rp = new Rastgele(tohumPazar);
  const pazar = Array.from({ length: nPazar }, (_, i) => ({ ...u.yuk(rp, i), sahipGuven: u.guven(rp) }));
  return { isler, pazar };
}

export interface DonusSecenegi {
  /** pazar dizisindeki sıra */
  yuk: number;
  /** "donus": BR-20 sanal araç ilanıyla dönüş yükü; "rota": BR-23 rota üstü (dönüş yükü değilse) */
  tur: "donus" | "rota";
  /** dönüşte BR-21 skoru, rota üstünde onRouteMatch skoru (sistemin listelerdeki sıralaması) */
  skor: number;
  /** Bu yükle dönüş boş km: karayolu(varış → yük kalkışı) + karayolu(yük varışı → ev) */
  bosKm: number;
  /** Dönüş yükünün yüklü km'si */
  yukluKm: number;
}

export interface DonusAdaylari {
  /** iş başına, boş km'yi azaltan seçenekler */
  secenekler: DonusSecenegi[][];
  /** iş başına boş dönüş km: karayolu(varış → ev) */
  bosDonusKm: number[];
}

export interface DonusParametreleri {
  eslesme: MatchParams;
  plan: ReturnPlanParams;
}
export const SISTEM_PARAMETRELERI: DonusParametreleri = { eslesme: DEFAULT_MATCH_PARAMS, plan: RETURN_PLAN_PARAMS };

/**
 * Sistem kuralıyla aday listesi (API'deki ReturnPlanService ile aynı mantık): önce dönüş yükü (BR-20, sanal araç
 * ilanı), değilse araç/tarih uyuyorsa rota üstü (BR-23, dönüş yolu çizgisi). Kabul varsayımı [T]: nakliyeci yalnız boş
 * km'sini azaltan yükü alır (gelir modellenmediği için).
 */
export function donusAdaylari(k: KonumVerisi, o: DonusOrnegi, mesafe: Mesafe, rotalar: RotaKaynagi, p: DonusParametreleri = SISTEM_PARAMETRELERI): DonusAdaylari {
  const girdiler = o.pazar.map((y) => yukEslestirmeGirdisi(k, y));
  const secenekler: DonusSecenegi[][] = [];
  const bosDonusKm: number[] = [];
  for (const is of o.isler) {
    const ev = is.kalkisIlce;
    const orasi = is.varisIlce;
    const cap = returnCapacity({ origin: ilceKonum(k, ev), dest: ilceKonum(k, orasi), vehicle: is.vehicle }, returnWindow(is.varisGunu, p.plan));
    const cizgi = rotalar.cizgi(orasi, ev);
    const bos0 = mesafe.km(orasi, ev);
    const liste: DonusSecenegi[] = [];
    o.pazar.forEach((y, i) => {
      const load = girdiler[i]!;
      let tur: DonusSecenegi["tur"];
      let skor: number;
      const m = matchLoadWithCapacity(load, cap, y.sahipGuven, p.eslesme);
      if (m.candidate) {
        tur = "donus";
        skor = m.score;
      } else {
        if (fitRejectReason(load, cap, p.eslesme)) return;
        const r = onRouteMatch(load, cizgi, p.plan);
        if (!r.candidate) return;
        tur = "rota";
        skor = r.score;
      }
      const bosKm = mesafe.km(orasi, y.kalkisIlce) + mesafe.km(y.varisIlce, ev);
      if (bosKm >= bos0) return;
      liste.push({ yuk: i, tur, skor, bosKm, yukluKm: mesafe.km(y.kalkisIlce, y.varisIlce) });
    });
    secenekler.push(liste);
    bosDonusKm.push(bos0);
  }
  return { secenekler, bosDonusKm };
}

/** iş → seçilen seçenek (yoksa null) */
export type DonusAtamasi = (DonusSecenegi | null)[];

/** İşler varış gününe göre (eşitlikte kimlik): önce varan önce seçer */
const varisSirasi = (o: DonusOrnegi) => [...o.isler].sort((a, b) => (a.varisGunu < b.varisGunu ? -1 : a.varisGunu > b.varisGunu ? 1 : a.id - b.id));

function sirali(o: DonusOrnegi, a: DonusAdaylari, sec: (liste: DonusSecenegi[]) => DonusSecenegi | null): DonusAtamasi {
  const alinan = new Set<number>();
  const sonuc: DonusAtamasi = o.isler.map(() => null);
  for (const is of varisSirasi(o)) {
    const s = sec(a.secenekler[is.id]!.filter((x) => !alinan.has(x.yuk)));
    if (s) {
      alinan.add(s.yuk);
      sonuc[is.id] = s;
    }
  }
  return sonuc;
}

const enYuksekSkor = (l: DonusSecenegi[]) => l.reduce<DonusSecenegi | null>((b, x) => (!b || x.skor > b.skor || (x.skor === b.skor && x.yuk < b.yuk) ? x : b), null);

/** (A) dönüş planı yok: araç boş döner */
export const bosDonus = (o: DonusOrnegi): DonusAtamasi => o.isler.map(() => null);

/** (B) yalnız dönüş yükleri (BR-20): en yüksek skorlu kullanılabilir dönüş yükü — elle boş araç ilanı açmanın karşılığı */
export const yalnizDonus = (o: DonusOrnegi, a: DonusAdaylari) => sirali(o, a, (l) => enYuksekSkor(l.filter((x) => x.tur === "donus")));

/** (C) sistem: önce dönüş yükleri (skor), yoksa rota üstü (skor) — uygulamadaki liste sırası */
export const sistem = (o: DonusOrnegi, a: DonusAdaylari) =>
  sirali(o, a, (l) => enYuksekSkor(l.filter((x) => x.tur === "donus")) ?? enYuksekSkor(l.filter((x) => x.tur === "rota")));

/** (C-km) aynı öneriler, nakliyeci boş km'si en az olanı seçer (eşitlikte yüksek skor, küçük kimlik) */
export const enAzBosKm = (o: DonusOrnegi, a: DonusAdaylari) =>
  sirali(o, a, (l) => l.reduce<DonusSecenegi | null>((b, x) => (!b || x.bosKm < b.bosKm || (x.bosKm === b.bosKm && (x.skor > b.skor || (x.skor === b.skor && x.yuk < b.yuk))) ? x : b), null));

/**
 * (C-Macar) küresel atama: aynı adaylarla toplam boş km tasarrufu en çok (merkezi planlayıcı; üst sınır). Her işe
 * "eşleşmeden dönmek" sahte sütunu (maliyet T); eşleşme maliyeti T − tasarruf (≥ 0). Toplam = n·T − Σ tasarruf.
 */
export function kuresel(o: DonusOrnegi, a: DonusAdaylari): DonusAtamasi {
  const n = o.isler.length;
  const m = o.pazar.length;
  let T = 0;
  a.secenekler.forEach((l, i) => l.forEach((x) => (T = Math.max(T, a.bosDonusKm[i]! - x.bosKm))));
  const c = m + n;
  const maliyet = new Float64Array(n * c).fill(Infinity);
  for (let i = 0; i < n; i++) {
    for (const x of a.secenekler[i]!) maliyet[i * c + x.yuk] = T - (a.bosDonusKm[i]! - x.bosKm);
    maliyet[i * c + m + i] = T; // eşleşmeden dön
  }
  const at = kareDisiMacar(n, c, maliyet);
  return o.isler.map((_, i) => {
    const j = at[i]!;
    return j >= 0 && j < m ? (a.secenekler[i]!.find((x) => x.yuk === j) ?? null) : null;
  });
}

export interface DonusOlcutleri {
  donusBulmaOrani: number;
  toplamBosKm: number;
  aracBasinaBosKm: number;
  /** boş / (boş + yüklü), gidiş + dönüş */
  bosKmOrani: number;
  /** eşleşen dönüşlerin rota üstü payı */
  rotaPayi: number;
}

export function donusOlcutleri(o: DonusOrnegi, a: DonusAdaylari, at: DonusAtamasi): DonusOlcutleri {
  const kullanilan = new Set<number>();
  let bos = 0;
  let yuklu = 0;
  let eslesen = 0;
  let rota = 0;
  o.isler.forEach((is, i) => {
    yuklu += is.yukluKm;
    const s = at[i];
    if (s) {
      if (kullanilan.has(s.yuk)) throw new Error(`Aynı dönüş yükü iki işe verildi: ${s.yuk}`);
      kullanilan.add(s.yuk);
      eslesen++;
      if (s.tur === "rota") rota++;
      bos += s.bosKm;
      yuklu += s.yukluKm;
    } else bos += a.bosDonusKm[i]!;
  });
  const n = o.isler.length;
  return {
    donusBulmaOrani: n ? eslesen / n : 0,
    toplamBosKm: bos,
    aracBasinaBosKm: n ? bos / n : 0,
    bosKmOrani: bos + yuklu > 0 ? bos / (bos + yuklu) : 0,
    rotaPayi: eslesen ? rota / eslesen : NaN,
  };
}
