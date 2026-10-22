import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const API = "http://localhost:3000/api/v1";
const API_LOG = resolve(__dirname, "../../api/api.log");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const psql = (q: string) =>
  execFileSync("docker", ["exec", "nakliye-db-1", "psql", "-U", "nakliye", "-d", "nakliye", "-tAc", q]).toString().trim();

// 4 haneli kimlik eski bir çalıştırmayla (ya da aynı öneki kullanan başka bir takımla) çakışabiliyor: DB'de boş olana kadar yeniden üretilir
let run: string;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90559${run}%'`) !== "0");
/** Bu çalıştırmaya özel numara (+90559…): web testleri diğer takımların numaralarıyla karışmaz */
export const phone = (n: number) => `+90559${run}${String(n).padStart(3, "0")}`;
/** Formda yazılan biçim: 0559 … */
export const localPhone = (p: string) => `0${p.slice(3)}`;

/** API geliştirme modunda SMS'i loga yazar; o numaraya giden son SMS'te kalıba uyan 6 haneli kod. */
export async function smsCode(p: string, text: string): Promise<string> {
  const re = new RegExp(String.raw`\[SMS → (\+\d+)\] ${text}: (\d{6})`, "g");
  for (let i = 0; i < 40; i++) {
    const m = [...readFileSync(API_LOG, "utf8").matchAll(re)].filter((x) => x[1] === p).at(-1);
    if (m) return m[2]!;
    await sleep(150);
  }
  throw new Error(`SMS bulunamadı: ${p} ${text}`);
}

export const otpFor = (p: string) => smsCode(p, "Seferna giriş kodunuz");

export async function api<T = Record<string, string>>(method: string, path: string, token?: string, body?: unknown) {
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

/** API üzerinden giriş (tarayıcı dışı kullanıcılar: yönetici). */
export async function apiLogin(p: string) {
  await api("POST", "/auth/otp/request", undefined, { phone: p });
  const code = await otpFor(p);
  return (await api<{ accessToken: string; refreshToken: string }>("POST", "/auth/otp/verify", undefined, { phone: p, code })).body;
}

/** Yönetici belirteci: rol DB'den verilir, refresh ile rolü taşıyan belirteç alınır. Her test dosyası ayrı numara
 * kullanır (aynı numaraya art arda OTP istemek bekleme süresine takılır). */
export async function adminToken(n = 900) {
  const p = phone(n);
  const t = await apiLogin(p);
  psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${p}' on conflict do nothing`);
  return (await adminSession(t.accessToken)).accessToken;
}

/** RFC 6238 (HMAC-SHA-1, 6 hane, 30 sn) — API'nin kodundan bağımsız: doğrulama uygulamasının o an göstereceği kod */
export function totp(secretB32: string, offset = 0, ms = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of secretB32.replace(/\s/g, "")) {
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

/** NFR-04: rolü DB'den verilmiş yöneticinin ikinci adım kurulumu; dönen belirteçler yönetici rolünü taşır */
export async function adminSession(accessToken: string) {
  const s = await api<{ secret: string }>("POST", "/me/totp/setup", accessToken, {});
  const e = await api<{ accessToken: string; refreshToken: string; recoveryCodes: string[] }>("POST", "/me/totp/enable", accessToken, { code: totp(s.body.secret) });
  if (e.status !== 201) throw new Error(`TOTP etkinleşmedi: ${e.status} ${JSON.stringify(e.body)}`);
  return { ...e.body, secret: s.body.secret };
}


const trDay = (offset: number) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

/** Yük ilanı (Menteşe → Muratpaşa); moderasyona düşerse yönetici onaylar. */
export async function createLoad(token: string, admin: string) {
  const locs = (await api<{ name: string; districts: { id: number; name: string }[] }[]>("GET", "/locations")).body;
  const d = (prov: string, name: string) => locs.find((p) => p.name === prov)!.districts.find((x) => x.name === name)!.id;
  const r = await api("POST", "/loads", token, {
    originDistrictId: d("Muğla", "Menteşe"),
    destDistrictId: d("Antalya", "Muratpaşa"),
    loadFrom: trDay(1),
    loadTo: trDay(2),
    cargoType: "palet",
    weightTon: 7,
    vehicleType: "kamyon",
    bodyType: null,
    priceType: "sabit",
    price: 12500,
  });
  if (r.body.status === "moderasyonda") await api("POST", `/admin/loads/${r.body.id}/review`, admin, { decision: "onay" });
  return r.body.id!;
}

/** API ile kullanıcı: giriş + rol (+ ad); rolü taşıyan erişim belirteci döner. */
export async function apiUser(p: string, role: "shipper" | "carrier", name?: string) {
  const t = await apiLogin(p);
  const access = (await api("POST", "/me/roles", t.accessToken, { roles: [role] })).body.accessToken!;
  if (name) await api("PATCH", "/me", access, { name });
  return { ...t, accessToken: access, id: (await api("GET", "/me", access)).body.id! };
}
