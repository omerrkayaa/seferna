// P7 "Nakliyecilerim": birlikte iş yapılan nakliyeciler, favoriler ve favorilere yeni ilan bildirimi — uçtan uca test.
// Yalıtım: Kilis/Polateli → Osmaniye/Bahçe ve +90547… numaraları. Çalıştırma kimliği DB'de boş olana kadar yeniden üretilir.
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false). node test/e2e-carriers.mjs api.log
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { adminSession } from "./lib/admin.mjs";

const LOG = process.argv[2];
const B = "http://localhost:3000/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => execFileSync("docker", ["exec", "nakliye-db-1", "psql", "-U", "nakliye", "-d", "nakliye", "-tAc", q]).toString().trim();
const log = () => readFileSync(LOG, "utf8");

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
  const code = [...log().matchAll(/\[SMS → (\+\d+)\] Seferna giriş kodunuz: (\d{6})/g)].filter((m) => m[1] === phone).at(-1)[2];
  return (await api("POST", "/auth/otp/verify", null, { phone, code })).body;
}
async function user(phone, roles) {
  const t = await login(phone);
  return roles.length ? (await api("POST", "/me/roles", t.accessToken, { roles })).body.accessToken : t.accessToken;
}

async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(150); }
}

const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90547${run}%'`) !== "0");
const phone = (n) => `+90547${run}${String(n).padStart(3, "0")}`;

const S = await user(phone(1), ["shipper"]);
const X = await user(phone(2), ["shipper"]);
const C1 = await user(phone(3), ["carrier"]);
const C2 = await user(phone(4), ["carrier"]);
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla
await api("PATCH", "/me", C1, { name: "Polateli Nakliyat" });
const idOf = (p) => psql(`select id from users where phone='${p}'`);
const C1id = idOf(phone(3)), C2id = idOf(phone(4));

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const POLATELI = district("Kilis", "Polateli"), BAHCE = district("Osmaniye", "Bahçe");
const vehicle = async (t, plate) => (await api("POST", "/vehicles", t, { plate, vehicleType: "kamyonet", bodyType: "kapali", capacityTon: 3 })).body.id;
const V1 = await vehicle(C1, `79 PL ${run}`), V2 = await vehicle(C2, `79 PM ${run}`);

async function load(t = S, from = 1) {
  const r = await api("POST", "/loads", t, {
    originDistrictId: POLATELI, destDistrictId: BAHCE, loadFrom: trDay(from), loadTo: trDay(from), cargoType: "genel",
    weightTon: 2, vehicleType: "kamyonet", bodyType: null, priceType: "teklif", price: null,
  });
  if (r.body.status === "moderasyonda") await api("POST", `/admin/loads/${r.body.id}/review`, A, { decision: "onay" });
  return r.body.id;
}
/** İlan → teklif → kabul → teslim → tamamlandı */
async function doneJob(carrier, vehicleId, from) {
  const l = await load(S, from);
  const o = (await api("POST", `/loads/${l}/offers`, carrier, { vehicleId, price: 1500 })).body.id;
  const acc = (await api("POST", `/offers/${o}/accept`, S)).body;
  await api("POST", `/jobs/${acc.job.id}/deliver`, carrier, { code: acc.deliveryCode });
  await api("POST", `/jobs/${acc.job.id}/complete`, S);
  return acc.job.id;
}
const favNotes = async (t) => (await api("GET", "/notifications", t)).body.items.filter((n) => n.type === "favorite_load");
const list = async (t = S) => (await api("GET", "/me/carriers", t)).body;

console.log("\nListe ve yetki");
check("nakliyeci göremez 403", (await api("GET", "/me/carriers", C1)).status === 403);
check("işi olmayan yük sahibinde boş", (await list()).items?.length === 0);
check("iş yapılmamış nakliyeci favori olamaz 404", (await api("PUT", `/me/carriers/${C1id}/favorite`, S)).status === 404);
await doneJob(C1, V1, 1);
await doneJob(C2, V2, 2);
let r = await list();
const c1 = r.items?.find((c) => c.id === C1id);
check("birlikte iş yapılanlar listede (2)", r.items?.length === 2, JSON.stringify(r));
check("nakliyeci: ad, tam numara, işler, itibar", c1?.displayName === "Polateli Nakliyat" && c1.phone === phone(3) && c1.jobsWithYou === 1 && c1.completedWithYou === 1 && c1.favorite === false && c1.reputation.completedJobs === 1, JSON.stringify(c1));
check("favori yokken son iş en üstte", r.items[0].id === C2id);
check("başka yük sahibi bu listeyi görmez", (await list(X)).items.length === 0);

console.log("\nFavori");
r = await api("PUT", `/me/carriers/${C1id}/favorite`, S);
check("favoriye eklendi", r.status === 200 && r.body.favorite === true, JSON.stringify(r.body));
check("ikinci ekleme sorunsuz", (await api("PUT", `/me/carriers/${C1id}/favorite`, S)).status === 200);
r = await list();
check("favori en üstte ve işaretli", r.items[0].id === C1id && r.items[0].favorite === true);
check("başkası (X) favoriye ekleyemez 404", (await api("PUT", `/me/carriers/${C1id}/favorite`, X)).status === 404);

console.log("\nYeni ilan favoriye bildirilir");
const before = (await favNotes(C1)).length;
const L = await load(S, 5);
await sleep(800); // eşleştirme arka planda
let notes = await favNotes(C1);
check("favori nakliyeciye 'çalıştığınız yük sahibinden yeni ilan'", notes.length === before + 1 && notes[0].data.loadId === L && notes[0].body.includes("Polateli"), JSON.stringify(notes[0]));
check("favori olmayan nakliyeciye gitmez", (await favNotes(C2)).length === 0);
await api("PATCH", `/loads/${L}`, S, { weightTon: 2.5 }); // düzenleme yeniden eşleştirir
await sleep(800);
check("düzenleyince ikinci bildirim yok", (await favNotes(C1)).length === before + 1);
const Lx = await load(X, 5);
await sleep(800);
check("başka yük sahibinin ilanı favori bildirimi üretmez", !(await favNotes(C1)).some((n) => n.data.loadId === Lx));

console.log("\nFavoriden çıkar");
check("çıkarıldı", (await api("DELETE", `/me/carriers/${C1id}/favorite`, S)).body.favorite === false);
check("listede favori değil", (await list()).items.find((c) => c.id === C1id)?.favorite === false);
await load(S, 6);
await sleep(800);
check("çıkarınca yeni ilan bildirilmez", (await favNotes(C1)).length === before + 1);

console.log("\nToplu bildirimle tekilleştirme (BR-22)");
// Yükü boş araç ilanının toplu bildiriminden öğrenen nakliyeci sonradan favori olsa da o yük için ikinci bildirim almaz
const L2 = await load(S, 9);
await sleep(800);
const K2 = (await api("POST", "/capacity", C2, { vehicleId: V2, originDistrictId: POLATELI, destDistrictId: null, availableFrom: trDay(9), availableTo: trDay(9) })).body.id;
await until(async () => psql(`select matched_at is not null from capacity_posts where id='${K2}'`) === "t");
r = (await api("GET", "/notifications", C2)).body.items.filter((n) => n.data?.capacityId === K2);
check("boş araç ilanı yükü toplu bildirimle duyurur", r.length === 1, JSON.stringify(r));
await api("PUT", `/me/carriers/${C2id}/favorite`, S);
await api("PATCH", `/loads/${L2}`, S, { weightTon: 2.5 });
await until(async () => psql(`select matched_at is not null from load_posts where id='${L2}'`) === "t");
check("sonradan favori olunca aynı yük için favori bildirimi gitmez", !(await favNotes(C2)).some((n) => n.data.loadId === L2));
const L3 = await load(S, 12);
await until(async () => psql(`select matched_at is not null from load_posts where id='${L3}'`) === "t");
check("favoriye yeni yük bildirilir (kontrol)", (await favNotes(C2)).some((n) => n.data.loadId === L3));
await api("DELETE", `/me/carriers/${C2id}/favorite`, S);

psql(`update load_posts set status='iptal' where status in ('teyitli','teyit_bekliyor','moderasyonda') and shipper_id in (select id from users where phone like '+90547${run}%')`);
psql(`update capacity_posts set status='iptal' where status='aktif' and carrier_id in (select id from users where phone like '+90547${run}%')`);
console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
