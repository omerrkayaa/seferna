// İl/ilçe koordinatları: API'nin tohum verisi (apps/api/src/db/seed/locations.json, OSM/Wikidata). Yalnız okunur.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LatLng } from "@nakliye/shared";

export interface Il {
  id: number;
  name: string;
  lat: number;
  lon: number;
}

export interface Ilce {
  id: number;
  provinceId: number;
  name: string;
  lat: number;
  lon: number;
}

export interface KonumVerisi {
  iller: Il[];
  ilceler: Ilce[];
  /** ilçe kimliği → ilceler dizisindeki sıra */
  ilceSirasi: Map<number, number>;
  /** il kimliği → o ilin ilçe kimlikleri */
  ilIlceleri: Map<number, number[]>;
  ilAdindan: Map<string, Il>;
}

const KONUM_DOSYASI = fileURLToPath(new URL("../../../apps/api/src/db/seed/locations.json", import.meta.url));

let onbellek: KonumVerisi | null = null;

export function konumlariYukle(): KonumVerisi {
  if (onbellek) return onbellek;
  const ham = JSON.parse(readFileSync(KONUM_DOSYASI, "utf8")) as { provinces: Il[]; districts: Ilce[] };
  const ilceSirasi = new Map<number, number>();
  const ilIlceleri = new Map<number, number[]>();
  ham.districts.forEach((d, i) => {
    ilceSirasi.set(d.id, i);
    const liste = ilIlceleri.get(d.provinceId) ?? [];
    liste.push(d.id);
    ilIlceleri.set(d.provinceId, liste);
  });
  onbellek = {
    iller: ham.provinces,
    ilceler: ham.districts,
    ilceSirasi,
    ilIlceleri,
    ilAdindan: new Map(ham.provinces.map((p) => [p.name, p])),
  };
  return onbellek;
}

export function ilce(k: KonumVerisi, id: number): Ilce {
  const i = k.ilceSirasi.get(id);
  if (i === undefined) throw new Error(`Bilinmeyen ilçe: ${id}`);
  return k.ilceler[i]!;
}

/** shared'ın LatLng biçimi (lng); JSON'da "lon" */
export const ilceKonum = (k: KonumVerisi, id: number): LatLng => {
  const d = ilce(k, id);
  return { lat: d.lat, lng: d.lon };
};
