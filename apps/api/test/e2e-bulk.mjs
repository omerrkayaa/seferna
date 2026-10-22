// Toplu ilan (FR-11, F5): POST /loads/bulk uçtan uca test.
// Yalıtım: +90544… numaraları, Sinop → Bartın (sonda iptal). Ön koşul: e2e-confirmation.mjs ile aynı.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

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
  return { status: res.status, body: json };
}
async function login(phone) {
  await api("POST", "/auth/otp/request", null, { phone });
  await sleep(300);
  const code = [...readFileSync(LOG, "utf8").matchAll(/\[SMS → (\+\d+)\] Seferna giriş kodunuz: (\d{6})/g)].filter((m) => m[1] === phone).at(-1)[2];
  return (await api("POST", "/auth/otp/verify", null, { phone, code })).body;
}
const role = async (phone, roles) => (await api("POST", "/me/roles", (await login(phone)).accessToken, { roles })).body.accessToken;

// 4 haneli kimlik eski bir çalıştırmayla çakışabiliyor (aynı numaralar/plakalar): DB'de boş olana kadar yeniden üretilir
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90544${run}%'`) !== "0");
const phone = (n) => `+90544${run}${String(n).padStart(3, "0")}`;
const trDay = (o) => new Date(Date.now() + 3 * 3600e3 + o * 86400e3).toISOString().slice(0, 10);

const S = await role(phone(1), ["shipper"]);
const C = await role(phone(2), ["carrier"]);
const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const ok = (over = {}) => ({
  originDistrictId: district("Sinop", "Merkez"), destDistrictId: district("Bartın", "Merkez"), loadFrom: trDay(1), loadTo: trDay(2),
  cargoType: "genel", weightTon: 8, vehicleType: "kamyon", bodyType: null, priceType: "teklif", price: null, ...over,
});

console.log("\nToplu ilan (FR-11)");
check("nakliyeci toplu ilan veremez 403", (await api("POST", "/loads/bulk", C, { items: [ok()] })).status === 403);
check("boş liste 400", (await api("POST", "/loads/bulk", S, { items: [] })).status === 400);
check("101 satır 400", (await api("POST", "/loads/bulk", S, { items: Array.from({ length: 101 }, () => ok()) })).status === 400);
check("items yok 400", (await api("POST", "/loads/bulk", S, {})).status === 400);

const r = await api("POST", "/loads/bulk", S, {
  items: [
    ok({ note: "toplu 1" }),
    ok({ weightTon: 100 }), // şema hatası
    ok({ loadFrom: trDay(-3), loadTo: trDay(-2) }), // geçmiş tarih (serviste)
    ok({ destDistrictId: 99999 }), // olmayan ilçe (serviste)
    "metin", // satır nesne değil
    ok({ priceType: "sabit", price: 9000, note: "toplu 2" }),
  ],
});
check("istek başarılı, satır satır sonuç", r.status === 201 && r.body.results?.length === 6, JSON.stringify(r.body).slice(0, 300));
const res = r.body.results ?? [];
check("2 açıldı, 4 hatalı", r.body.created === 2 && r.body.failed === 4);
check("satır numaraları sırayla", res.map((x) => x.row).join(",") === "1,2,3,4,5,6");
check("1. ve 6. satır ilan kimliğiyle", !!res[0]?.id && !!res[5]?.id && !res[0].error);
check("yeni hesabın ilanları moderasyonda (BR-11, tekli ilanla aynı)", res[0]?.status === "moderasyonda" && res[5]?.status === "moderasyonda");
check("şema hatası alan adıyla", /weightTon/.test(res[1]?.error ?? ""), res[1]?.error);
check("geçmiş tarih hatası (tekli ilanla aynı mesaj)", /Yükleme/.test(res[2]?.error ?? "") && !res[2]?.id, res[2]?.error);
check("olmayan ilçe hatası", res[3]?.error === "Kalkış ya da varış ilçesi bulunamadı", res[3]?.error);
check("nesne olmayan satır hatası", !!res[4]?.error && !res[4]?.id);
check("hatalı satırlar DB'ye yazılmadı", psql(`select count(*) from load_posts where shipper_id=(select id from users where phone='${phone(1)}')`) === "2");
const l6 = (await api("GET", `/loads/${res[5].id}`, S)).body;
check("açılan ilan tekli ilanla aynı alanlarla", l6.priceType === "sabit" && l6.price === 9000 && l6.note === "toplu 2" && /^[A-Za-z0-9_-]{10}$/.test(l6.shareId));
check("İlanlarım'da görünür", (await api("GET", "/loads/mine", S)).body.items.filter((x) => res.some((y) => y.id === x.id)).length === 2);

psql(`update load_posts set status='iptal' where shipper_id in (select id from users where phone like '+90544%') and status in ('teyitli','teyit_bekliyor','moderasyonda')`);
console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
