/// <reference types="node" />
// NFR-07 kullanılabilirlik ölçümü (docs/03): kullanıcının en kısa yolda yapacağı işlemleri sayar, süreyi KLM ile tahmin eder.
// Aynı dosya apps/web/e2e/usability.ts ile apps/mobile/e2e/usability.ts'de (iki ayrı paket): değişiklik ikisine birden.
// Yöntem ve sonuçlar: arastirma/kullanilabilirlik/README.md.
//
// KLM (Keystroke-Level Model; Card, Moran, Newell 1980, Communications of the ACM 23(7)) işlem süreleri, saniye:
//   K tuş 0,28 (ortalama, sekreter olmayan yazıcı, ~40 kelime/dk); kötü durum 1,20 (klavyeye yabancı)
//   P hedefi gösterme 1,10 + BB tıklama/dokunma 0,20 · H elin fare ile klavye arasında gidişi 0,40 · M zihinsel hazırlık 1,35
// Sadeleştirmeler: her karar adımına (bir alan, bir seçim, gönder) bir M; dokunuş = P + BB; dokunmatik ekranda H yok.
// Sistemin cevap süresi (R) yerine otomatik koşunun duvar saati süresi eklenir (Playwright payı da içinde: fazlası).
// Uygulama dışındaki dokunuşlar (telefonun arama ekranında "ara") ayrıca sayılır; süreye her biri için P + BB eklenir.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator } from "@playwright/test";

export const KLM = { K: 0.28, Kslow: 1.2, P: 1.1, BB: 0.2, H: 0.4, M: 1.35 } as const;

const fold = (t: string) => t.toLocaleLowerCase("tr-TR");

/** Hedefin listede ilk eşleşme olması için yazılması gereken en kısa ön ek: seçici araması ("includes") ya da açılır
 * listede harfle atlama ("startsWith"). Hedef görünse bile ilk sırada değilse bir harf daha yazılır (kötümser). */
export function minPrefix(names: string[], target: string, match: "includes" | "startsWith") {
  const t = fold(target);
  for (let n = 1; n <= t.length; n++) {
    const q = t.slice(0, n);
    if (names.find((x) => fold(x)[match](q)) === target) return q;
  }
  throw new Error(`${target} listede ilk sıraya gelmiyor`);
}

export interface Result {
  flow: string;
  /** Uygulama içindeki dokunuş / tıklama (alanı odaklamak dahil) */
  taps: number;
  /** Uygulama dışında (telefonun arama ekranı) */
  outsideTaps: number;
  keys: number;
  steps: number;
  homes: number;
  systemSec: number;
  /** KLM, K = 0,28 sn */
  typicalSec: number;
  /** KLM, K = 1,20 sn */
  slowSec: number;
  path: string[];
}

type Tally = { taps: number; outsideTaps: number; keys: number; steps: number; homes: number };
type Counts = Tally & { path: number; t: number };

export class Ops {
  private c: Tally = { taps: 0, outsideTaps: 0, keys: 0, steps: 0, homes: 0 };
  private path: string[] = [];
  private hand: "pointer" | "keyboard" = "pointer";
  private readonly t0 = Date.now();

  /** desktop: fare + klavye (el değiştirme H sayılır); değilse dokunmatik */
  constructor(private readonly desktop: boolean) {}

  /** Bir karar adımı (M); adı yola yazılır */
  step(name: string) {
    this.c.steps++;
    this.path.push(name);
  }

  private use(hand: "pointer" | "keyboard") {
    if (this.desktop && hand !== this.hand) this.c.homes++;
    this.hand = hand;
  }

  async tap(l: Locator) {
    this.use("pointer");
    this.c.taps++;
    await l.click();
  }

  /** Yazma: alan kendiliğinden odakta değilse önce ona dokunulur (o da sayılır) */
  async type(l: Locator, text: string) {
    if (!(await l.evaluate((e) => e === document.activeElement))) await this.tap(l);
    this.use("keyboard");
    this.c.keys += text.length;
    await l.fill(text);
  }

  /** Açılır liste (select): tıkla, hedef ilk eşleşme olana kadar harf yaz, Enter */
  async choose(l: Locator, label: string) {
    await l.waitFor(); // seçenekler beklemeden okunur
    const prefix = minPrefix(await l.locator("option").allTextContents(), label, "startsWith");
    this.use("pointer");
    this.c.taps++;
    this.use("keyboard");
    this.c.keys += prefix.length + 1;
    await l.selectOption({ label });
  }

  /** Uygulama dışındaki dokunuş: yalnız sayılır (test ortamında yapılamaz) */
  outsideTap(name: string) {
    this.c.outsideTaps++;
    this.path.push(name);
  }

  mark(): Counts {
    return { ...this.c, path: this.path.length, t: Date.now() };
  }

  /** Baştan ya da verilen işaretten bu yana */
  result(flow: string, from?: Counts): Result {
    const d = (k: keyof Tally) => this.c[k] - (from?.[k] ?? 0);
    const taps = d("taps"), outsideTaps = d("outsideTaps"), keys = d("keys"), steps = d("steps"), homes = d("homes");
    const systemSec = (Date.now() - (from?.t ?? this.t0)) / 1000;
    const base = steps * KLM.M + (taps + outsideTaps) * (KLM.P + KLM.BB) + homes * KLM.H + systemSec;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    return { flow, taps, outsideTaps, keys, steps, homes, systemSec: r1(systemSec), typicalSec: r1(base + keys * KLM.K), slowSec: r1(base + keys * KLM.Kslow), path: this.path.slice(from?.path ?? 0) };
  }
}

/** Konsola özet; NFR07_OUT=<klasör> verilirse <platform>-<ad>.json yazılır */
export function report(platform: string, name: string, r: Result) {
  const out = r.outsideTaps ? ` + ${r.outsideTaps} uygulama dışı` : "";
  console.log(`[NFR-07] ${platform} · ${r.flow}: ${r.taps} dokunuş${out}, ${r.keys} tuş, ${r.steps} adım, ${r.homes} el değiştirme; sistem ${r.systemSec} sn; KLM tipik ${r.typicalSec} sn, kötü durum ${r.slowSec} sn`);
  const dir = process.env.NFR07_OUT;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${platform}-${name}.json`), JSON.stringify({ platform, at: new Date().toISOString(), klm: KLM, ...r }, null, 2));
}
