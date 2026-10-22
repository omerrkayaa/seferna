// Arama (BR-40, BR-12) ve şikayet (FR-17, BR-05) uçtan uca test.
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false, SMS_PROVIDER=console, çıktı dosyada).
// Kullanım (apps/api içinden): node test/e2e-reports.mjs api.log
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

const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
// 4 haneli kimlik eski bir çalıştırmayla çakışabiliyor (aynı numaralar/plakalar): DB'de boş olana kadar yeniden üretilir
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90553${run}%'`) !== "0");
const phone = (n) => `+90553${run}${String(n).padStart(3, "0")}`;

// ── Hazırlık ──────────────────────────────────────────────────────
const S = await user(phone(1), ["shipper"]);
const C1 = await user(phone(2), ["carrier"]);
const C2 = await user(phone(3), ["carrier"]);
const C3 = await user(phone(4), ["carrier"]);
const C4 = await user(phone(6), ["carrier"]);
const C5 = await user(phone(7), ["carrier"]);
const S2 = await user(phone(5), ["shipper"]);
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const base = {
  originDistrictId: district("Manisa", "Salihli"), destDistrictId: district("İstanbul", "Tuzla"),
  loadFrom: trDay(1), loadTo: trDay(2), cargoType: "gida", weightTon: 8, vehicleType: "kamyon", bodyType: null,
  priceType: "teklif", price: null,
};
async function liveLoad() {
  const r = await api("POST", "/loads", S, base);
  if (r.body.status === "moderasyonda") await api("POST", `/admin/loads/${r.body.id}/review`, A, { decision: "onay" });
  return r.body.id;
}
const status = (id) => psql(`select status from load_posts where id='${id}'`);
const questions = (id) => psql(`select count(*) from load_confirmations where load_post_id='${id}'`);
const report = (t, id, reason = "yuk_yok") => api("POST", "/reports", t, { targetType: "load_post", targetId: id, reason });
const call = (t, id) => api("POST", `/loads/${id}/call`, t);

const L = await liveLoad();

console.log("\nNumara maskeleme ve arama (BR-40, BR-12)");
let r = await api("GET", `/loads/${L}`, C1);
check("detayda numara maskeli", r.body.shipper?.phoneMasked === `0553 *** ** ${phone(1).slice(-2)}`, JSON.stringify(r.body.shipper));
check("listede tam numara yok", !JSON.stringify((await api("GET", "/loads", C1)).body).includes(phone(1)));
check("yük sahibi rolüyle arama 403", (await call(S2, L)).status === 403);
r = await call(C1, L);
check("nakliyeci arar: ilanı veren hesabın numarası döner", r.status === 200 && r.body.phone === phone(1), JSON.stringify(r.body));
check("arama loglandı", psql(`select count(*) from call_logs where load_post_id='${L}'`) === "1");
const S_both = (await api("POST", "/me/roles", S, { roles: ["carrier"] })).body.accessToken;
check("kendi ilanını arama 400", (await call(S_both, L)).status === 400);
check("olmayan ilan 404", (await call(C1, "00000000-0000-4000-8000-000000000000")).status === 404);

console.log("\nGünlük arama sınırı (30 farklı ilan)");
const c3id = psql(`select id from users where phone='${phone(4)}'`);
const bulk = psql(`with n as (
  insert into load_posts (share_id, shipper_id, origin_district_id, origin_geom, dest_district_id, dest_geom, load_from, load_to,
    cargo_type, weight_ton, vehicle_type, price_type, status, last_confirmed_at, next_reminder_at)
  select substr(md5(random()::text), 1, 10), shipper_id, origin_district_id, origin_geom, dest_district_id, dest_geom, load_from, load_to,
    cargo_type, weight_ton, vehicle_type, price_type, 'teyitli', now(), now() + interval '1 day'
  from load_posts, generate_series(1, 30) where id = '${L}' returning id)
  insert into call_logs (caller_id, load_post_id) select '${c3id}', id from n returning load_post_id`).split("\n");
check("30 farklı ilan arandıktan sonra yenisi 429", (await call(C3, L)).status === 429);
check("daha önce aranan ilanı tekrar aramak serbest", (await call(C3, bulk[0])).status === 200);

console.log("\nŞikayet doğrulamaları");
check("kendi ilanını şikayet 400", (await report(S, L)).status === 400);
check("olmayan ilan 404", (await report(C1, "00000000-0000-4000-8000-000000000000")).status === 404);
check("bozuk kimlik 400", (await api("POST", "/reports", C1, { targetType: "load_post", targetId: "x", reason: "yuk_yok" })).status === 400);
check("kendini şikayet 400", (await api("POST", "/reports", C1, { targetType: "user", targetId: psql(`select id from users where phone='${phone(2)}'`), reason: "sahte" })).status === 400);
check("başka kullanıcıyı şikayet 201", (await api("POST", "/reports", C1, { targetType: "user", targetId: c3id, reason: "diger", note: "test" })).status === 201);

console.log("\nBR-05: 'yük yok' → anında teyit");
r = await report(C1, L);
check("1. sayılan şikayetçi (aramış): ilan teyitli kalır", r.status === 201 && status(L) === "teyitli");
await report(C2, L);
check("aramamış ve doğrulanmamış şikayetçi sayılmaz", status(L) === "teyitli");
await call(C2, L);
r = await report(C2, L);
check("aynı kişi arayıp tekrar bildirince (kayıt tazelenir) 2. sayılır → teyit bekliyor", r.status === 201 && status(L) === "teyit_bekliyor");
check("tek şikayet satırı (tekrar bildirim yeni satır açmaz)", psql(`select count(*) from reports r join users u on u.id=r.reporter_id where u.phone='${phone(3)}'`) === "1");
check("sahibine anında soru açıldı + push", questions(L) === "1" && log().includes("Yükünüzün gittiği bildirildi"));
const pendingFor = psql(`select round(extract(epoch from now() - reminder_sent_at) / 60) from load_posts where id='${L}'`);
check("BR-04'ün 12 saati şimdi başlar (hatırlatma 4 saat geriye yazıldı)", Math.abs(Number(pendingFor) - 240) <= 1, `${pendingFor} dk`);
await call(C3, L);
await report(C3, L);
check("3. şikayet yeni soru açmaz", questions(L) === "1");
await api("POST", "/admin/tick", A);
check("tur hemen düşürmez", status(L) === "teyit_bekliyor");

console.log("\nTeyitten sonra eski şikayetler sayılmaz");
await api("POST", `/loads/${L}/confirm`, S, { answer: "gecerli" });
check("sahibi 'geçerli' dedi → teyitli", status(L) === "teyitli");
await report(C1, L);
check("teyitten sonra tek yeni şikayet: teyitli kalır", status(L) === "teyitli");
await report(C2, L);
check("ikinci yeni şikayet: tekrar teyit bekliyor", status(L) === "teyit_bekliyor");
psql(`update load_posts set reminder_sent_at = now() - interval '16 hours 5 minutes' where id='${L}'`);
await api("POST", "/admin/tick", A);
check("12 saat cevapsız → süresi doldu", status(L) === "suresi_doldu");
check("süresi dolan ilan şikayet edilemez 404", (await report(C3, L)).status === 404);

console.log("\nDiğer sebepler BR-05'i tetiklemez");
const L2 = await liveLoad();
for (const c of [C1, C2]) { await call(c, L2); await report(c, L2, "sahte"); }
check("2 'sahte' şikayeti: teyitli kalır (yönetici kuyruğuna)", status(L2) === "teyitli");

console.log("\nEşzamanlı şikayetler");
let concurrentOk = 0;
for (let i = 0; i < 3; i++) {
  const Lc = await liveLoad();
  await call(C4, Lc); await call(C5, Lc);
  await Promise.all([report(C4, Lc), report(C5, Lc)]);
  if (status(Lc) === "teyit_bekliyor" && questions(Lc) === "1") concurrentOk++;
}
check("aynı anda gelen 2 şikayet her seferinde tetikler (3/3) ve tek soru açar", concurrentOk === 3, `${concurrentOk}/3`);

console.log("\nGünlük şikayet sınırı (20)");
psql(`insert into reports (reporter_id, target_type, target_id, reason) select '${c3id}', 'user', gen_random_uuid(), 'diger' from generate_series(1, 20)`);
check("21. şikayet 429", (await report(C3, L2)).status === 429);

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
