// Araç (FR-04) ve boş araç ilanı (FR-12) uçtan uca test.
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false, SMS_PROVIDER=console, çıktı dosyada).
// Kullanım (apps/api içinden): node test/e2e-vehicles.mjs api.log
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

const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
// 4 haneli kimlik eski bir çalıştırmayla çakışabiliyor (aynı numaralar/plakalar): DB'de boş olana kadar yeniden üretilir
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90552${run}%'`) !== "0");
const phone = (n) => `+90552${run}${String(n).padStart(3, "0")}`;

const C = await user(phone(1), ["carrier"]);
const C2 = await user(phone(2), ["carrier"]);
const S = await user(phone(3), ["shipper"]);
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const KONAK = district("İzmir", "Konak"), EFELER = district("Aydın", "Efeler");

console.log("\nAraç (FR-04)");
const plate = `35 ts ${run}`;
const truck = { plate, vehicleType: "tir", bodyType: "tenteli", capacityTon: 25, volumeM3: 90 };
check("yük sahibi araç ekleyemez 403", (await api("POST", "/vehicles", S, truck)).status === 403);
let r = await api("POST", "/vehicles", C, truck);
const V = r.body.id;
check("araç eklendi, plaka biçimlendi", r.status === 201 && r.body.plate === `35TS${run}`, JSON.stringify(r.body));
r = await api("POST", "/vehicles", C, truck);
check("aynı plaka kendi hesabında 409", r.status === 409 && r.body.message.includes("araçlarınızda"));
r = await api("POST", "/vehicles", C2, truck);
check("aynı plaka başka hesapta 409", r.status === 409 && r.body.message.includes("başka bir hesapta"));
check("geçersiz plaka 400", (await api("POST", "/vehicles", C, { ...truck, plate: "99 X 1" })).status === 400);
check("60 tondan fazla 400", (await api("POST", "/vehicles", C, { ...truck, plate: `35 TT ${run}`, capacityTon: 70 })).status === 400);
check("araç listesi", (await api("GET", "/vehicles", C)).body.length === 1);
check("plaka düzenlenemez 400", (await api("PATCH", `/vehicles/${V}`, C, { plate: "35AA1111" })).status === 400);
r = await api("PATCH", `/vehicles/${V}`, C, { capacityTon: 26, volumeM3: null });
check("tonaj güncellendi, hacim silindi", r.body.capacityTon === 26 && r.body.volumeM3 === null, JSON.stringify(r.body));
check("başkasının aracı 404", (await api("PATCH", `/vehicles/${V}`, C2, { capacityTon: 10 })).status === 404);

console.log("\nBoş araç ilanı (FR-12)");
const post = (t, body) => api("POST", "/capacity", t, { vehicleId: V, originDistrictId: KONAK, destDistrictId: null, ...body });
check("başkasının aracıyla ilan 404", (await post(C2, { availableFrom: trDay(1), availableTo: trDay(2) })).status === 404);
r = await post(C, { availableFrom: trDay(1), availableTo: trDay(2) });
const P1 = r.body.id;
check("ilan: Konak → her yer", r.status === 201 && r.body.dest === null && r.body.origin.district === "Konak" && r.body.vehicle.plate === `35TS${run}`, JSON.stringify(r.body));
r = await post(C, { availableFrom: trDay(2), availableTo: trDay(4) });
check("aynı araç çakışan tarih 409 (uç gün dahil)", r.status === 409, JSON.stringify(r.body));
r = await post(C, { availableFrom: trDay(3), availableTo: trDay(4) });
const P2 = r.body.id;
check("çakışmayan tarih 201", r.status === 201);
check("geçmiş tarih 400 (Müsaitlik mesajı)", (await post(C, { availableFrom: trDay(-3), availableTo: trDay(-2) })).body.message === "Müsaitlik tarihi geçmişte olamaz");
check("olmayan ilçe 400", (await post(C, { originDistrictId: 99999, availableFrom: trDay(9), availableTo: trDay(9) })).status === 400);
const both = await Promise.all([post(C, { availableFrom: trDay(6), availableTo: trDay(7) }), post(C, { availableFrom: trDay(6), availableTo: trDay(7) })]);
check("aynı anda iki çakışan ilan: biri 201, biri 409", both.map((x) => x.status).sort().join() === "201,409", both.map((x) => x.status).join());

console.log("\nDüzenleme ve kapatma");
r = await api("PATCH", `/capacity/${P1}`, C, { destDistrictId: EFELER });
check("varış eklendi", r.body.dest?.district === "Efeler", JSON.stringify(r.body.dest));
r = await api("PATCH", `/capacity/${P1}`, C, { destDistrictId: null });
check("varış tekrar 'her yer'", r.body.dest === null);
check("araç değiştirilemez 400", (await api("PATCH", `/capacity/${P1}`, C, { vehicleId: V })).status === 400);
check("başka ilanla çakışan düzenleme 409", (await api("PATCH", `/capacity/${P1}`, C, { availableTo: trDay(3) })).status === 409);
check("başkası göremez 404", (await api("GET", `/capacity/${P1}`, C2)).status === 404);
check("İlanlarım", (await api("GET", "/capacity", C)).body.items.length === 3);
r = await api("POST", `/capacity/${P1}/close`, C, { reason: "doldu" });
check("doldu → kapandı", r.body.status === "kapandi");
check("kapalı ilan düzenlenemez 409", (await api("PATCH", `/capacity/${P1}`, C, { destDistrictId: EFELER })).status === 409);
const P3 = (await post(C, { availableFrom: trDay(1), availableTo: trDay(2) })).body.id;
check("kapanan ilanın tarihleri yeniden kullanılabilir", !!P3);
r = await api("GET", "/capacity", C);
const order = r.body.items.map((c) => `${c.status}:${c.availableFrom}`);
check("liste: aktifler üstte en yakın tarih önce, kapanan altta", order.join() === [`aktif:${trDay(1)}`, `aktif:${trDay(3)}`, `aktif:${trDay(6)}`, `kapandi:${trDay(1)}`].join(), order.join());

console.log("\nSüresi dolma (zamanlayıcı)");
psql(`update capacity_posts set available_from = current_date - 3, available_to = current_date - 1 where id='${P2}'`);
r = await api("POST", "/admin/tick", A);
check("tur: süresi geçen ilan düştü", r.body.capacityExpired >= 1 && psql(`select status from capacity_posts where id='${P2}'`) === "suresi_doldu", JSON.stringify(r.body));

console.log("\nAraç silme");
const activeBefore = psql(`select count(*) from capacity_posts where vehicle_id='${V}' and status='aktif'`);
check("204", (await api("DELETE", `/vehicles/${V}`, C)).status === 204);
check("aktif ilanları iptal edildi", Number(activeBefore) > 0 && psql(`select count(*) from capacity_posts where vehicle_id='${V}' and status='aktif'`) === "0", activeBefore);
check("listede yok", (await api("GET", "/vehicles", C)).body.length === 0);
check("silinen araçla ilan 404", (await post(C, { availableFrom: trDay(10), availableTo: trDay(10) })).status === 404);
r = await api("POST", "/vehicles", C2, truck);
check("plaka serbest kaldı: başka hesap ekleyebilir", r.status === 201, JSON.stringify(r.body));
check("ikinci silme 404", (await api("DELETE", `/vehicles/${V}`, C)).status === 404);

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
