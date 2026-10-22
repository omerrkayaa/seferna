/// <reference types="node" />
// Testler Node.js'te çalışır (Playwright); uygulama kodu Node tiplerini görmez.
import { expect, type Page } from "@playwright/test";
import { execFileSync, execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const API = "http://localhost:3000/api/v1";
const API_LOG = resolve(__dirname, "../../api/api.log");
export const DEMO_PHONE = "+905550102030";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const psql = (q: string) =>
  execFileSync("docker", ["exec", "nakliye-db-1", "psql", "-U", "nakliye", "-d", "nakliye", "-tAc", q]).toString().trim();

// 4 haneli kimlik eski bir çalıştırmayla (ya da aynı öneki kullanan başka bir takımla) çakışabiliyor: DB'de boş olana kadar yeniden üretilir
let run: string;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90554${run}%'`) !== "0");
/** Bu çalıştırmaya özel numara (+90554…): diğer test takımlarının numaralarıyla karışmaz */
export const phone = (n: number) => `+90554${run}${String(n).padStart(3, "0")}`;

/** Demo verisini tazele: demo ilanları yenilenir, demo nakliyecinin önceki teklifleri ilanlarla birlikte kapanır */
export const seedDemo = () => execSync("npm run db:seed-demo", { cwd: resolve(__dirname, "../../api"), stdio: "pipe" });

export async function api<T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json as T };
}

/** API geliştirme modunda SMS'i loga yazar: o numaraya giden, kalıba uyan bütün 6 haneli kodlar (eskiden yeniye) */
export const smsCodes = (p: string, text: string) =>
  [...readFileSync(API_LOG, "utf8").matchAll(new RegExp(String.raw`\[SMS → (\+\d+)\] ${text}: (\d{6})`, "g"))].filter((x) => x[1] === p).map((x) => x[2]!);

/** O numaraya giden son giriş kodu (SMS loga düşene kadar bekler) */
export async function otpFor(p: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const code = smsCodes(p, "Seferna giriş kodunuz").at(-1);
    if (code) return code;
    await sleep(150);
  }
  throw new Error(`SMS bulunamadı: ${p}`);
}

/** API üzerinden giriş; roller verilirse eklenir ve rolleri taşıyan belirteç döner */
export async function apiUser(p: string, roles: string[] = []) {
  await api("POST", "/auth/otp/request", undefined, { phone: p });
  const code = p === DEMO_PHONE ? "123456" : await otpFor(p);
  const t = (await api<{ accessToken: string; refreshToken: string }>("POST", "/auth/otp/verify", undefined, { phone: p, code })).body;
  if (!roles.length) return t.accessToken;
  return (await api<{ accessToken: string }>("POST", "/me/roles", t.accessToken, { roles })).body.accessToken;
}

/** Yönetici belirteci: rol DB'den verilir; yönetici rolü belirtece ikinci adımla girer (NFR-04) */
export async function adminToken(p: string) {
  return (await adminSession(p)).accessToken;
}

/** Yönetici oturumu: giriş + rol + doğrulama uygulaması kurulumu (setup → kod → enable); anahtar ve kurtarma kodlarıyla */
export async function adminSession(p: string) {
  await api("POST", "/auth/otp/request", undefined, { phone: p });
  const t = (await api<{ accessToken: string }>("POST", "/auth/otp/verify", undefined, { phone: p, code: await otpFor(p) })).body;
  psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${p}' on conflict do nothing`);
  const s = await api<{ secret: string }>("POST", "/me/totp/setup", t.accessToken, {});
  const e = await api<{ accessToken: string; recoveryCodes: string[] }>("POST", "/me/totp/enable", t.accessToken, { code: totp(s.body.secret) });
  if (e.status !== 201) throw new Error(`TOTP etkinleşmedi: ${e.status} ${JSON.stringify(e.body)}`);
  return { ...e.body, secret: s.body.secret };
}

/** RFC 6238 (HMAC-SHA-1, 6 hane, 30 sn) — API'nin kodundan bağımsız: doğrulama uygulamasının o an göstereceği kod */
export function totp(secretB32: string, offset = 0, ms = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of secretB32) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(ms / 30_000) + offset));
  const h = createHmac("sha1", Buffer.from(bytes)).update(msg).digest();
  const o = h[19]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export const demoToken = () => apiUser(DEMO_PHONE);

/** Görünür olanlar (Expo Router önceki ekranları DOM'da gizli tutar) */
export const vis = (page: Page, text: string | RegExp, exact = false) => page.getByText(text, { exact }).locator("visible=true");
export const btn = (page: Page, name: string | RegExp, exact = false) => page.getByRole("button", { name, exact }).locator("visible=true");

/** Konsol ve sayfa hatalarını topla; testin sonunda boş olmalı */
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

/** window.confirm/alert diyaloglarını kabul et ve metinlerini kaydet */
export function acceptDialogs(page: Page) {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  return dialogs;
}

export async function demoLogin(page: Page) {
  await page.goto("/");
  await vis(page, "Demo hesabıyla gir").click();
  await expect(vis(page, "Nereden").first()).toBeVisible({ timeout: 20_000 });
}

/** İl → ilçe seçici: n. il/ilçe alanı (formdaki sıraya göre) */
export async function pickDistrict(page: Page, n: number, province: string, district: string) {
  await btn(page, /^İl: /).nth(n).click();
  await page.getByLabel("İl ara").locator("visible=true").fill(province.slice(0, 4).toLocaleLowerCase("tr-TR"));
  await btn(page, province, true).click();
  await btn(page, /^İlçe: /).nth(n).click();
  await page.getByLabel("İlçe ara").locator("visible=true").fill(district.slice(0, 4).toLocaleLowerCase("tr-TR"));
  await btn(page, district, true).click();
  // Seçici kapanma animasyonu
  await expect(page.getByLabel("İlçe ara").locator("visible=true")).toHaveCount(0);
}

export const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const trDayOffset = (o: number) => new Date(Date.now() + 3 * 3600e3 + o * 86400e3).toISOString().slice(0, 10);

/** API'den teyitli ilan (yeni yük sahibinin ilanı moderasyona düşerse yönetici onaylar) */
export async function apiLoad(shipper: string, admin: string, originDistrictId: number, destDistrictId: number) {
  const r = await api<{ id: string; status: string }>("POST", "/loads", shipper, {
    originDistrictId,
    destDistrictId,
    loadFrom: trDayOffset(1),
    loadTo: trDayOffset(2),
    cargoType: "genel",
    weightTon: 10,
    vehicleType: "tir",
    bodyType: null,
    priceType: "teklif",
    price: null,
  });
  if (r.body.status === "moderasyonda") await api("POST", `/admin/loads/${r.body.id}/review`, admin, { decision: "onay" });
  return r.body.id;
}

let locs: { name: string; districts: { id: number; name: string }[] }[] | null = null;
export async function districtId(province: string, district: string) {
  locs ??= (await api<typeof locs & object>("GET", "/locations")).body;
  return locs!.find((p) => p.name === province)!.districts.find((d) => d.name === district)!.id;
}

/** SHOTS=<klasör> verilirse ekran görüntüsü (görsel kontrol için; testin sonucunu etkilemez) */
export const shot = (page: Page, name: string) => (process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }) : Promise.resolve());
