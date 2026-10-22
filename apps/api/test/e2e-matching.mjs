// Eşleştirme (BR-20…22, FR-23) ve bildirimler (A14) uçtan uca test.
// Yalıtım: bu test "kirkayak" araç tipini ve Van → Hakkari bölgesini kendine ayırır; başta ve sonda bu tipteki
// ilanları iptal eder (önceki çalıştırmaların ilanları aday olarak karışmasın). Diğer testler kirkayak kullanmaz.
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false). node test/e2e-matching.mjs api.log
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
  return { status: res.status, body: json };
}
async function login(phone) {
  await api("POST", "/auth/otp/request", null, { phone });
  await sleep(300);
  const code = [...readFileSync(LOG, "utf8").matchAll(/\[SMS → (\+\d+)\] Seferna giriş kodunuz: (\d{6})/g)].filter((m) => m[1] === phone).at(-1)[2];
  return (await api("POST", "/auth/otp/verify", null, { phone, code })).body;
}
async function user(phone, roles) {
  const t = await login(phone);
  return roles.length ? (await api("POST", "/me/roles", t.accessToken, { roles })).body.accessToken : t.accessToken;
}
/** Eşleştirme arka planda çalışır: koşul sağlanana kadar (en çok 5 sn) bekle */
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(150); }
}
const inbox = async (t) => (await api("GET", "/notifications", t)).body;
const matchNotes = async (t, pred = () => true) =>
  (await inbox(t)).items.filter((n) => n.type.startsWith("match_") && pred(n));

const cleanup = () => {
  psql(`update load_posts set status='iptal' where vehicle_type='kirkayak' and status in ('teyitli','teyit_bekliyor','moderasyonda')`);
  psql(`update capacity_posts set status='iptal' where status='aktif' and vehicle_id in (select id from vehicles where vehicle_type='kirkayak')`);
};
cleanup();

const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
// 4 haneli kimlik eski bir çalıştırmayla çakışabiliyor (aynı numaralar/plakalar): DB'de boş olana kadar yeniden üretilir
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90551${run}%'`) !== "0");
const phone = (n) => `+90551${run}${String(n).padStart(3, "0")}`;

const S = await user(phone(1), ["shipper"]);
const C1 = await user(phone(2), ["carrier"]);
const C2 = await user(phone(3), ["carrier"]);
const C3 = await user(phone(4), ["carrier"]);
const SC = await user(phone(5), ["shipper", "carrier"]);
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const IPEKYOLU = district("Van", "İpekyolu"), EDREMIT = district("Van", "Edremit"), ERCIS = district("Van", "Erciş");
const HAKKARI = district("Hakkari", "Merkez");

const vehicle = async (t, plate, bodyType) =>
  (await api("POST", "/vehicles", t, { plate, vehicleType: "kirkayak", bodyType, capacityTon: 20 })).body.id;
const V1 = await vehicle(C1, `65 KA ${run}`, "lowbed");
const V1b = await vehicle(C1, `65 KB ${run}`, "lowbed");
const V2 = await vehicle(C2, `65 KC ${run}`, "lowbed");
const V3 = await vehicle(C3, `65 KD ${run}`, "frigo");
const VS = await vehicle(SC, `65 KE ${run}`, "lowbed");
const capacity = async (t, vehicleId, originDistrictId, from, to, destDistrictId = null) =>
  (await api("POST", "/capacity", t, { vehicleId, originDistrictId, destDistrictId, availableFrom: trDay(from), availableTo: trDay(to) })).body.id;
/** Yayında yük (ilk 3 ilan moderasyona girer, yönetici onaylar → eşleştirme onayda başlar) */
async function load(t, originDistrictId, from, to, extra = {}) {
  const r = await api("POST", "/loads", t, {
    originDistrictId, destDistrictId: HAKKARI, loadFrom: trDay(from), loadTo: trDay(to), cargoType: "makine",
    weightTon: 15, vehicleType: "kirkayak", bodyType: "lowbed", priceType: "teklif", price: null, ...extra,
  });
  if (r.body.status === "moderasyonda") await api("POST", `/admin/loads/${r.body.id}/review`, A, { decision: "onay" });
  return r.body.id;
}
const pairs = (loadId) => psql(`select count(*) from matches where load_post_id='${loadId}'`);

console.log("\n1. Önce boş araç, sonra yük (BR-20)");
const K1 = await capacity(C1, V1, IPEKYOLU, 1, 3); // her yer
const K3 = await capacity(C3, V3, IPEKYOLU, 1, 3); // frigo: kasa uymaz
const K2 = await capacity(C2, V2, ERCIS, 1, 3); // 58 km: kalkış uzak
const L1 = await load(S, EDREMIT, 2, 2);
check("uygun araca (14 km) bildirim gitti", await until(async () => (await matchNotes(C1, (n) => n.data.loadId === L1)).length === 1));
check("bildirim metni rota ve tarih içeriyor", (await matchNotes(C1, (n) => n.data.loadId === L1))[0]?.body.includes("Van/Edremit → Hakkari/Merkez"));
check("yük sahibine 'uygun araç' bildirimi", await until(async () => (await matchNotes(S, (n) => n.data.loadId === L1)).length === 1));
check("kalkışı 58 km olan araca bildirim yok", (await matchNotes(C2)).length === 0);
check("kasa tipi uymayan araca bildirim yok", (await matchNotes(C3)).length === 0);
check("tek çift kaydedildi", pairs(L1) === "1");

let r = await api("GET", `/loads/${L1}/matches`, S);
check("yük sahibi uygun araçları görür", r.body.items?.length === 1 && r.body.items[0].capacityId === K1 && r.body.items[0].originKm < 20, JSON.stringify(r.body).slice(0, 200));
check("araç listesinde plaka ve tam numara yok", !JSON.stringify(r.body).includes("65KA") && !JSON.stringify(r.body).includes(phone(2)) && r.body.items[0].carrier.phoneMasked.includes("***"));
r = await api("GET", `/capacity/${K1}/matches`, C1);
check("nakliyeci uygun yükleri görür", r.body.items?.some((l) => l.loadId === L1));
check("başkasının ilanının eşleşmeleri 404", (await api("GET", `/capacity/${K1}/matches`, C2)).status === 404);
check("nakliyeci rolüyle yük eşleşmeleri 403", (await api("GET", `/loads/${L1}/matches`, C1)).status === 403);

console.log("\n2. Önce yük, sonra boş araç");
const L2 = await load(S, IPEKYOLU, 6, 7);
await until(async () => psql(`select matched_at is not null from load_posts where id='${L2}'`) === "t");
check("uygun araç yokken çift yok", pairs(L2) === "0");
const K2b = await capacity(C2, V2, EDREMIT, 6, 7, HAKKARI);
check("yeni boş araca 'uygun yük bulundu' bildirimi", await until(async () => (await matchNotes(C2, (n) => n.data.capacityId === K2b)).length === 1));
check("yük sahibine de bildirim", await until(async () => (await matchNotes(S, (n) => n.data.loadId === L2)).length === 1));

console.log("\n3. Aynı yük için tek bildirim (BR-22)");
await capacity(C1, V1, IPEKYOLU, 9, 10);
await capacity(C1, V1b, EDREMIT, 9, 10);
await sleep(500);
const L3 = await load(S, IPEKYOLU, 9, 9);
await until(async () => pairs(L3) === "2");
await sleep(300);
check("nakliyecinin iki aracı da uyar: 2 çift", pairs(L3) === "2");
check("ama nakliyeciye tek bildirim", (await matchNotes(C1, (n) => n.data.loadId === L3)).length === 1);

console.log("\n4. Kendi kendine eşleşme yok");
await capacity(SC, VS, IPEKYOLU, 12, 13);
const LS = await load(SC, IPEKYOLU, 12, 12);
await until(async () => psql(`select matched_at is not null from load_posts where id='${LS}'`) === "t");
check("aynı kullanıcının yükü ve aracı eşleşmez", pairs(LS) === "0");

console.log("\n5. Düzenleme yeniden eşleştirir");
await api("PATCH", `/loads/${L1}`, S, { bodyType: null });
check("kasa şartı kalkınca frigo araca bildirim", await until(async () => (await matchNotes(C3, (n) => n.data.loadId === L1)).length === 1));
check("eski çift yeniden bildirilmez", (await matchNotes(C1, (n) => n.data.loadId === L1)).length === 1);

console.log("\n6. Saatlik sınır (BR-22: 5)");
const before = (await matchNotes(C2)).length;
// Eşzamanlı: sınır sayımı ile ekleme arasındaki yarışı da sınar (kilitsizken 6-7 bildirim gidiyordu)
const many = await Promise.all(Array.from({ length: 6 }, () => load(S, EDREMIT, 6, 7)));
await until(async () => many.every((id) => psql(`select matched_at is not null from load_posts where id='${id}'`) === "t"), 8000);
const c2Notes = (await matchNotes(C2)).length;
check("6 uygun yükün hepsi eşleşti", many.every((id) => pairs(id) === "1"));
check("ama nakliyeci saatte en fazla 5 bildirim aldı", c2Notes === 5 && before < 5, `${before} → ${c2Notes}`);
check("yük sahibi de 5'te kaldı", (await matchNotes(S)).length === 5, String((await matchNotes(S)).length));

console.log("\n7. Zamanlayıcı süpürmesi");
psql(`delete from matches where load_post_id='${L2}'`);
psql(`update load_posts set matched_at = null where id='${L2}'`);
r = await api("POST", "/admin/tick", A);
check("tur gözden kaçan ilanı eşleştirdi", r.body.matchSwept >= 1 && pairs(L2) === "1", JSON.stringify(r.body));
check("süpürmede aynı bildirim tekrar gitmedi (tekil anahtar)", (await matchNotes(S, (n) => n.data.loadId === L2)).length === 1);

console.log("\n8. Arama → eşleşme isabeti");
await api("POST", `/loads/${L1}/call`, C1);
check("eşleşme 'arandı' olarak işaretlendi", psql(`select outcome from matches where load_post_id='${L1}' and capacity_post_id='${K1}'`) === "arandi");

console.log("\n9. Bildirim kutusu (A14)");
let box = await inbox(C1);
check("okunmamış sayısı", box.unread >= 2 && box.items.every((n) => n.readAt === null), JSON.stringify(box.unread));
check("iç anahtar dışarı sızmıyor", !("refKey" in box.items[0]) && !("userId" in box.items[0]));
const first = box.items[0].id;
check("okundu 204", (await api("POST", `/notifications/${first}/read`, C1)).status === 204);
check("başkasının bildirimi 404", (await api("POST", `/notifications/${first}/read`, C2)).status === 404);
box = await inbox(C1);
check("okunmamış bir azaldı", box.items.find((n) => n.id === first).readAt !== null);
await api("POST", "/notifications/read-all", C1);
check("hepsi okundu", (await inbox(C1)).unread === 0);

cleanup();
console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
