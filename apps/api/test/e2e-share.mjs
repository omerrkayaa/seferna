// Paylaşım sayfası (FR-16, F8): GET /public/loads/:shareId uçtan uca test.
// Yalıtım: +90543… numaraları, Sinop → Bartın ilanları (sonda iptal). Ön koşul: e2e-confirmation.mjs ile aynı.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { adminSession } from "./lib/admin.mjs";

const LOG = process.argv[2];
const B = "http://localhost:3000/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => execFileSync("docker", ["exec", "nakliye-db-1", "psql", "-U", "nakliye", "-d", "nakliye", "-tAc", q]).toString().trim();

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
async function api(method, path, token, body) {
  const res = await fetch(B + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}
async function login(phone) {
  await api("POST", "/auth/otp/request", null, { phone });
  await sleep(300);
  const code = [...readFileSync(LOG, "utf8").matchAll(/\[SMS → (\+\d+)\] Seferna giriş kodunuz: (\d{6})/g)].filter((m) => m[1] === phone).at(-1)[2];
  return (await api("POST", "/auth/otp/verify", null, { phone, code })).body;
}

// 4 haneli kimlik eski bir çalıştırmayla çakışabiliyor (aynı numaralar/plakalar): DB'de boş olana kadar yeniden üretilir
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90543${run}%'`) !== "0");
const phone = (n) => `+90543${run}${String(n).padStart(3, "0")}`;
const trDay = (o) => new Date(Date.now() + 3 * 3600e3 + o * 86400e3).toISOString().slice(0, 10);

const s = await login(phone(1));
const S = (await api("POST", "/me/roles", s.accessToken, { roles: ["shipper"] })).body.accessToken;
await api("PATCH", "/me", S, { name: "Paylaşım Deneme" });
const a = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, a.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const body = {
  originDistrictId: district("Sinop", "Merkez"), destDistrictId: district("Bartın", "Merkez"), loadFrom: trDay(1), loadTo: trDay(2),
  cargoType: "genel", weightTon: 8, vehicleType: "kamyon", bodyType: null, priceType: "sabit", price: 9500, note: "Forklift var",
};

console.log("\nPaylaşım sayfası (FR-16)");
const l1 = (await api("POST", "/loads", S, body)).body;
check("ilan yanıtında paylaşım kimliği (10 karakter)", /^[A-Za-z0-9_-]{10}$/.test(l1.shareId ?? ""), JSON.stringify(l1).slice(0, 120));
check("ilk ilan moderasyonda", l1.status === "moderasyonda");
check("moderasyondaki ilan paylaşımda yok (404)", (await api("GET", `/public/loads/${l1.shareId}`)).status === 404);

await api("POST", `/admin/loads/${l1.id}/review`, A, { decision: "onay" });
let r = await api("GET", `/public/loads/${l1.shareId}`);
check("onaylanınca girişsiz açılır", r.status === 200 && r.body.status === "teyitli");
check("güzergâh, tarih, yük, fiyat, not", r.body.origin?.province === "Sinop" && r.body.dest?.province === "Bartın" && r.body.loadFrom === trDay(1) && r.body.weightTon === 8 && r.body.price === 9500 && r.body.note === "Forklift var");
check("yük sahibinin görünen adı ve rozeti", r.body.shipper?.displayName === "Paylaşım Deneme" && r.body.shipper?.verified === false);
check("numara yok (maskeli bile değil)", !/phone|telefon/i.test(r.text) && !r.text.includes(phone(1).slice(3)), r.text.slice(0, 200));
check("iç kimlik yok", r.body.id === undefined && !r.text.includes(l1.id));
check("geçersiz biçim 404", (await api("GET", "/public/loads/kisa")).status === 404 && (await api("GET", `/public/loads/${l1.shareId}x`)).status === 404);
check("bilinmeyen kimlik 404", (await api("GET", "/public/loads/AAAAAAAAAA")).status === 404);

await api("POST", `/loads/${l1.id}/close`, S, { reason: "arac_bulundu" });
r = await api("GET", `/public/loads/${l1.shareId}`);
check("kapanan ilan: yalnız güzergâh ve durum", r.status === 200 && r.body.status === "kapandi" && Object.keys(r.body).sort().join(",") === "dest,origin,shareId,status", JSON.stringify(r.body));

// Yük akışında da kimlik var (mobil paylaşım düğmesi)
const l2 = (await api("POST", "/loads", S, body)).body;
if (l2.status === "moderasyonda") await api("POST", `/admin/loads/${l2.id}/review`, A, { decision: "onay" });
const C = (await api("POST", "/me/roles", (await login(phone(2))).accessToken, { roles: ["carrier"] })).body.accessToken;
r = await api("GET", `/loads/${l2.id}`, C);
check("nakliyecinin gördüğü ilanda paylaşım kimliği", r.body.shareId === l2.shareId);

psql(`update load_posts set status='iptal' where shipper_id in (select id from users where phone like '+90543%') and status in ('teyitli','teyit_bekliyor','moderasyonda')`);
console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
