// CSV (makine için: nokta ondalık) ve Markdown (rapor için: virgül ondalık) yazımı.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Hucre = string | number | boolean | null;

export function csvYaz(dosya: string, satirlar: Record<string, Hucre>[]): void {
  if (satirlar.length === 0) throw new Error(`Boş CSV: ${dosya}`);
  const basliklar = Object.keys(satirlar[0]!);
  const kacis = (v: Hucre) => {
    if (v === null) return "";
    const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const metin = [basliklar.join(","), ...satirlar.map((r) => basliklar.map((b) => kacis(r[b] ?? null)).join(","))].join("\n");
  mkdirSync(dirname(dosya), { recursive: true });
  writeFileSync(dosya, metin + "\n", "utf8");
}

/** Türkçe ondalık (virgül) */
export function sayi(x: number, basamak = 2): string {
  if (!Number.isFinite(x)) return "–";
  return x.toFixed(basamak).replace("-", "−").replace(".", ",");
}

/** Yüzde: 0,123 → "12,3" */
export const yuzde = (x: number, basamak = 1) => sayi(x * 100, basamak);

export function pDegeri(p: number): string {
  if (!Number.isFinite(p)) return "–";
  if (p < 0.001) return "<0,001";
  return sayi(p, 3);
}

export function mdTablo(basliklar: string[], satirlar: string[][], hizala?: ("l" | "r")[]): string {
  const h = hizala ?? basliklar.map((_, i) => (i === 0 ? "l" : "r"));
  const ayirac = h.map((a) => (a === "r" ? "---:" : ":---"));
  return [
    `| ${basliklar.join(" | ")} |`,
    `| ${ayirac.join(" | ")} |`,
    ...satirlar.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}
