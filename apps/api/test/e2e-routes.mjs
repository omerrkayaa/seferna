// W2 güzergâh sayfası verisi: GET /public/routes/:from/:to ve tanıtımdaki canlı yük akışı GET /public/feed (girişsiz) uçtan uca test.
// Yalıtım: +90548… numaraları; açtığı ilanlar sonda iptal. İlan sayısı önce/sonra farkıyla
// sınanır (DB'de demo ve başka ilanlar da var). Ön koşul: e2e-confirmation.mjs ile aynı. node test/e2e-routes.mjs api.log
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { estimatePrice } from "@nakliye/shared";
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

let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90548${run}%'`) !== "0");
const phone = (n) => `+90548${run}${String(n).padStart(3, "0")}`;
const trDay = (o) => new Date(Date.now() + 3 * 3600e3 + o * 86400e3).toISOString().slice(0, 10);

const s = await login(phone(1));
const S = (await api("POST", "/me/roles", s.accessToken, { roles: ["shipper"] })).body.accessToken;
const a = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, a.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const AYDIN = 9, ISTANBUL = 34, IZMIR = 35;
const route = (f, t) => api("GET", `/public/routes/${f}/${t}`);

console.log("\nGüzergâh özeti (W2)");
let r = await route(AYDIN, ISTANBUL);
const sum = r.body;
check("girişsiz 200, il adları", r.status === 200 && sum.from?.name === "Aydın" && sum.to?.name === "İstanbul", r.text.slice(0, 200));
check("mesafe makul (450–800 km) ve kaynak belli", sum.distanceKm > 450 && sum.distanceKm < 800 && ["karayolu", "kus_ucusu"].includes(sum.source), `${sum.distanceKm} ${sum.source}`);
const e = sum.estimates ?? [];
check("beş araç tipi, büyükten küçüğe", e.map((x) => x.vehicleType).join() === "tir,kirkayak,kamyon,kamyonet,panelvan", JSON.stringify(e));
check("her aralık geçerli, tır kamyonetten pahalı", e.every((x) => x.min > 0 && x.min < x.max) && e[0].max > e[3].max);
check("aralıklar shared formülüyle aynı", e.every((x) => {
  const p = estimatePrice(sum.distanceKm, x.vehicleType);
  return p.min === x.min && p.max === x.max;
}));
// Temsil ilçesi = il merkezine en yakın ilçe; ilan formundaki tahmin (aynı ilçeler) ile aynı sonucu vermeli
const rep = (p) => psql(`select d.id from districts d join provinces p on p.id = d.province_id where p.id = ${p} order by d.geom <-> p.geom limit 1`);
const pe = (await api("GET", `/price-estimate?from=${rep(AYDIN)}&to=${rep(ISTANBUL)}&vehicleType=tir`, S)).body;
check("ilan formundaki tahminle aynı (temsil ilçeleri arası)", pe.min === e[0].min && pe.max === e[0].max && pe.distanceKm === sum.distanceKm && pe.source === sum.source, JSON.stringify(pe));
console.log(`    (temsil ilçeleri: ${psql(`select string_agg(d.name, ' → ') from districts d where d.id in (${rep(AYDIN)}, ${rep(ISTANBUL)})`)}; ${sum.distanceKm} km ${sum.source})`);

console.log("\nYayındaki ilan sayısı");
const count = async (f, t) => (await route(f, t)).body.activeLoads;
const before = sum.activeLoads, reverse0 = await count(ISTANBUL, AYDIN), izmir0 = await count(AYDIN, IZMIR);
check("sayı alanı var", Number.isInteger(before));
const l1 = (await api("POST", "/loads", S, {
  originDistrictId: district("Aydın", "Nazilli"), destDistrictId: district("İstanbul", "Esenyurt"), loadFrom: trDay(1), loadTo: trDay(2),
  cargoType: "genel", weightTon: 12, vehicleType: "tir", bodyType: null, priceType: "teklif", price: null,
})).body;
check("moderasyondaki ilan sayılmaz", l1.status === "moderasyonda" && (await count(AYDIN, ISTANBUL)) === before, l1.status);
await api("POST", `/admin/loads/${l1.id}/review`, A, { decision: "onay" });
check("yayına çıkan ilan sayılır (+1)", (await count(AYDIN, ISTANBUL)) === before + 1);
check("ters yön ve başka il değişmez", (await count(ISTANBUL, AYDIN)) === reverse0 && (await count(AYDIN, IZMIR)) === izmir0);
psql(`update load_posts set status='teyit_bekliyor' where id='${l1.id}'`);
check("teyit bekleyen ilan da sayılır (yük akışı gibi)", (await count(AYDIN, ISTANBUL)) === before + 1);
r = await route(AYDIN, ISTANBUL);
check("numara ve ilan kimliği dönmez", !r.text.includes(phone(1)) && !r.text.includes(phone(1).slice(3)) && !r.text.includes(l1.id) && !r.text.includes(l1.shareId));
check("ilan kapatılınca düşer", (await api("POST", `/loads/${l1.id}/close`, S, { reason: "iptal" })).status < 300 && (await count(AYDIN, ISTANBUL)) === before);

console.log("\nCanlı yük akışı (tanıtım)");
const feed = () => api("GET", "/public/feed");
r = await feed();
const total0 = r.body.activeLoads;
check("girişsiz 200, toplam sayı ve en çok 6 ilan", r.status === 200 && Number.isInteger(total0) && Array.isArray(r.body.loads) && r.body.loads.length <= 6, r.text.slice(0, 200));
const l2 = (await api("POST", "/loads", S, {
  originDistrictId: district("Aydın", "Söke"), destDistrictId: district("İzmir", "Torbalı"), loadFrom: trDay(1), loadTo: trDay(3),
  cargoType: "palet", weightTon: 7.5, vehicleType: "kamyon", bodyType: null, priceType: "sabit", price: 9876, note: "akış-notu-gizli",
})).body;
check("moderasyondaki ilan akışta yok", l2.status === "moderasyonda" && (await feed()).body.activeLoads === total0, l2.status);
await api("POST", `/admin/loads/${l2.id}/review`, A, { decision: "onay" });
psql(`update load_posts set last_confirmed_at = now() + interval '1 minute' where id='${l2.id}'`); // en son teyit edilen olsun
r = await feed();
const top = r.body.loads?.[0] ?? {};
check("yayına çıkan ilan sayılır (+1) ve en son teyit edilen önde", r.body.activeLoads === total0 + 1 && top.origin?.district === "Söke" && top.dest?.district === "Torbalı", JSON.stringify(top));
check("güzergâh, yük ve durum alanları", top.origin?.province === "Aydın" && top.dest?.province === "İzmir" && top.cargoType === "palet" && top.weightTon === 7.5 &&
  top.vehicleType === "kamyon" && top.loadFrom === trDay(1) && top.loadTo === trDay(3) && top.status === "teyitli" && !Number.isNaN(Date.parse(top.lastConfirmedAt)), JSON.stringify(top));
check("yalnız izin verilen alanlar (fiyat, not, kimlik yok)", Object.keys(top).sort().join() === "cargoType,dest,lastConfirmedAt,loadFrom,loadTo,origin,status,vehicleType,weightTon", Object.keys(top).join());
check("numara, ilan/paylaşım kimliği, fiyat ve not yanıtta yok", !r.text.includes(phone(1).slice(3)) && !r.text.includes(l2.id) && !r.text.includes(l2.shareId) && !r.text.includes("9876") && !r.text.includes("akış-notu-gizli"));
psql(`update load_posts set status='teyit_bekliyor' where id='${l2.id}'`);
r = await feed();
check("teyit bekleyen ilan da görünür", r.body.activeLoads === total0 + 1 && r.body.loads[0]?.status === "teyit_bekliyor", JSON.stringify(r.body.loads[0]));
psql(`update load_posts set load_from = '${trDay(-2)}', load_to = '${trDay(-1)}', status='teyitli' where id='${l2.id}'`);
check("yükleme günü geçmiş ilan görünmez", (await feed()).body.activeLoads === total0);
psql(`update load_posts set load_from = '${trDay(1)}', load_to = '${trDay(3)}' where id='${l2.id}'`);
check("ilan kapatılınca düşer", (await api("POST", `/loads/${l2.id}/close`, S, { reason: "iptal" })).status < 300 && (await feed()).body.activeLoads === total0);

console.log("\nHatalar");
r = await route(AYDIN, AYDIN);
check("aynı il 400 (Türkçe)", r.status === 400 && r.body.message === "Kalkış ve varış ili farklı olmalı", r.text);
check("olmayan il 404", (await route(AYDIN, 99)).status === 404);
check("sayı olmayan il 404", (await route("aydin", "istanbul")).status === 404);

psql(`update load_posts set status='iptal' where status in ('teyitli','teyit_bekliyor','moderasyonda') and shipper_id in (select id from users where phone like '+90548${run}%')`);
console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
