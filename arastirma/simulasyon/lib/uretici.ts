// Sentetik yük ve boş araç ilanı üreticisi. Tüm dağılımlar parametreler.ts'te ([T]); değer kümeleri ve sınırlar shared'dan.
import {
  trustScore,
  type BodyType,
  type CapacityForMatch,
  type CargoType,
  type LoadForMatch,
  type VehicleType,
} from "@nakliye/shared";
import {
  ARAC_TIPI_KARISIMI,
  GUVEN_GIRDILERI,
  HER_YER_ORANI,
  IL_AGIRLIGI,
  IL_ICI_YUK_ORANI,
  KAPASITE_ARALIGI,
  KASA_DAGILIMI,
  KASA_ISTEGI,
  KORIDOR_ILLERI,
  MERKEZ_ILLERI,
  MUSAITLIK_ARALIK_GUN,
  MUSAITLIK_OFSET_GUN,
  YUK_CINSI_KARISIMI,
  YUK_DOLULUK_ARALIGI,
  YUKLEME_ARALIK_GUN,
  YUKLEME_OFSET_GUN,
} from "../parametreler.js";
import { ilce, ilceKonum, type KonumVerisi } from "./konum.js";
import { Rastgele } from "./prng.js";

export interface SentetikYuk {
  /** İlan sırası (kural tabanlı yöntemde geliş sırası ve eşitlik bozucu) */
  id: number;
  kalkisIlce: number;
  varisIlce: number;
  loadFrom: string;
  loadTo: string;
  cargoType: CargoType;
  weightTon: number;
  vehicleType: VehicleType;
  bodyType: BodyType | null;
}

export interface SentetikArac {
  id: number;
  bulunduguIlce: number;
  /** null = "her yer" */
  hedefIlce: number | null;
  availableFrom: string;
  availableTo: string;
  vehicle: { type: VehicleType; bodyType: BodyType; capacityTon: number };
  /** Araç sahibinin güven skoru (shared trustScore, BR-30) */
  guven: number;
}

export interface Ornek {
  yukler: SentetikYuk[];
  araclar: SentetikArac[];
}

/** YYYY-AA-GG + k gün (takvim günü; saat dilimi önemsiz) */
export function gunEkle(gun: string, k: number): string {
  const t = Date.parse(`${gun}T00:00:00Z`) + k * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** İl seçimi için ağırlık tablosu (il kimliği, ağırlık) */
export function ilAgirliklari(k: KonumVerisi): readonly (readonly [number, number])[] {
  for (const ad of [...KORIDOR_ILLERI, ...MERKEZ_ILLERI]) {
    if (!k.ilAdindan.has(ad)) throw new Error(`Konum verisinde il yok: ${ad}`);
  }
  const koridor = new Set<string>(KORIDOR_ILLERI);
  const merkez = new Set<string>(MERKEZ_ILLERI);
  return k.iller.map((il) => {
    const w = koridor.has(il.name) ? IL_AGIRLIGI.koridor : merkez.has(il.name) ? IL_AGIRLIGI.merkez : IL_AGIRLIGI.diger;
    return [il.id, w] as const;
  });
}

export class Uretici {
  private readonly ilAgirlik: readonly (readonly [number, number])[];

  constructor(
    private readonly k: KonumVerisi,
    private readonly referansGun: string,
  ) {
    this.ilAgirlik = ilAgirliklari(k);
  }

  private ilIlceleri(ilId: number): number[] {
    const l = this.k.ilIlceleri.get(ilId);
    if (!l || l.length === 0) throw new Error(`İlin ilçesi yok: ${ilId}`);
    return l;
  }

  /** Ağırlıklı il, il içinde düzgün ilçe */
  ilceSec(r: Rastgele): number {
    const il = r.agirlikli(this.ilAgirlik);
    const l = this.ilIlceleri(il);
    return l[r.tamsayi(0, l.length - 1)]!;
  }

  private varisSec(r: Rastgele, kalkis: number, tip: VehicleType): number {
    const ilId = ilce(this.k, kalkis).provinceId;
    const ayniIl = this.ilIlceleri(ilId).filter((d) => d !== kalkis);
    if (ayniIl.length > 0 && r.bernoulli(IL_ICI_YUK_ORANI[tip])) return ayniIl[r.tamsayi(0, ayniIl.length - 1)]!;
    for (;;) {
      const d = this.ilceSec(r);
      if (d !== kalkis) return d;
    }
  }

  yuk(r: Rastgele, id: number): SentetikYuk {
    const vehicleType = r.agirlikli(ARAC_TIPI_KARISIMI);
    const kalkisIlce = this.ilceSec(r);
    const varisIlce = this.varisSec(r, kalkisIlce, vehicleType);
    const ofset = r.agirlikli(YUKLEME_OFSET_GUN);
    const aralik = r.agirlikli(YUKLEME_ARALIK_GUN);
    const loadFrom = gunEkle(this.referansGun, ofset);
    const loadTo = gunEkle(loadFrom, aralik);

    // İstenen kasa, istenen tipin kasa dağılımında yoksa yük cinsi yeniden çekilir (parametreler.ts KASA_ISTEGI notu)
    const tipKasalari = new Set(KASA_DAGILIMI[vehicleType].map(([b]) => b));
    let cargoType: CargoType = "genel";
    let bodyType: BodyType | null = null;
    let bulundu = false;
    for (let deneme = 0; deneme < 50 && !bulundu; deneme++) {
      cargoType = r.agirlikli(YUK_CINSI_KARISIMI);
      bodyType = r.agirlikli(KASA_ISTEGI[cargoType]);
      bulundu = bodyType === null || tipKasalari.has(bodyType);
    }
    if (!bulundu) bodyType = null;

    const ust = KAPASITE_ARALIGI[vehicleType][1];
    const weightTon = Math.max(0.1, Math.round(r.duzgun(YUK_DOLULUK_ARALIGI[0], YUK_DOLULUK_ARALIGI[1]) * ust * 10) / 10);
    return { id, kalkisIlce, varisIlce, loadFrom, loadTo, cargoType, weightTon, vehicleType, bodyType };
  }

  guven(r: Rastgele): number {
    const g = GUVEN_GIRDILERI;
    if (r.bernoulli(g.yeniUyeOrani)) {
      return trustScore({ avgStars: null, ratingCount: 0, completedJobs: 0, verificationLevel: 0, cancelRate: 0, reportRate: 0 });
    }
    const completedJobs = Math.max(1, Math.round(r.lognormal(g.isMedyan, g.isSigma)));
    const ratingCount = Math.round(completedJobs * g.puanlanmaOrani);
    return trustScore({
      avgStars: ratingCount > 0 ? r.duzgun(g.yildizAraligi[0], g.yildizAraligi[1]) : null,
      ratingCount,
      completedJobs,
      verificationLevel: r.agirlikli(g.dogrulama),
      cancelRate: r.duzgun(0, g.iptalOraniUst),
      reportRate: r.duzgun(0, g.sikayetOraniUst),
    });
  }

  arac(r: Rastgele, id: number): SentetikArac {
    const type = r.agirlikli(ARAC_TIPI_KARISIMI);
    const bodyType = r.agirlikli(KASA_DAGILIMI[type]);
    const [alt, ust] = KAPASITE_ARALIGI[type];
    const capacityTon = Math.round(r.duzgun(alt, ust) * 10) / 10;
    const bulunduguIlce = this.ilceSec(r);
    let hedefIlce: number | null = null;
    if (!r.bernoulli(HER_YER_ORANI)) {
      do hedefIlce = this.ilceSec(r);
      while (hedefIlce === bulunduguIlce);
    }
    const availableFrom = gunEkle(this.referansGun, r.agirlikli(MUSAITLIK_OFSET_GUN));
    const availableTo = gunEkle(availableFrom, r.agirlikli(MUSAITLIK_ARALIK_GUN));
    return { id, bulunduguIlce, hedefIlce, availableFrom, availableTo, vehicle: { type, bodyType, capacityTon }, guven: this.guven(r) };
  }

  /**
   * Bir örnek (anlık görüntü): nYuk yük + nArac boş araç ilanı. Yükler ve araçlar ayrı alt akışlardan üretilir;
   * böylece aynı tohumda araç sayısını değiştirmek yükleri değiştirmez.
   */
  ornek(tohumYuk: number, tohumArac: number, nYuk: number, nArac: number): Ornek {
    const ry = new Rastgele(tohumYuk);
    const ra = new Rastgele(tohumArac);
    const yukler = Array.from({ length: nYuk }, (_, i) => this.yuk(ry, i));
    const araclar = Array.from({ length: nArac }, (_, i) => this.arac(ra, i));
    return { yukler, araclar };
  }
}

export const yukEslestirmeGirdisi = (k: KonumVerisi, y: SentetikYuk): LoadForMatch => ({
  origin: ilceKonum(k, y.kalkisIlce),
  dest: ilceKonum(k, y.varisIlce),
  loadFrom: y.loadFrom,
  loadTo: y.loadTo,
  weightTon: y.weightTon,
  vehicleType: y.vehicleType,
  bodyType: y.bodyType,
});

export const aracEslestirmeGirdisi = (k: KonumVerisi, a: SentetikArac): CapacityForMatch => ({
  origin: ilceKonum(k, a.bulunduguIlce),
  dest: a.hedefIlce === null ? null : ilceKonum(k, a.hedefIlce),
  availableFrom: a.availableFrom,
  availableTo: a.availableTo,
  vehicle: a.vehicle,
});
