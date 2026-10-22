// F4 dönüş planı (FR-24, BR-23, UC-12) — uçtan uca test. İş: Aydın/Efeler → İstanbul/Tuzla (OSRM açık olmalı).
// Dönüş yükü: Pendik → Nazilli; rota üstü: Gebze → Bursa/Osmangazi; ters yön: Osmangazi → Gebze; yol dışı: Ankara → Konya.
// Yalıtım: +90538… numaraları; sonuçlarda başka takımların ilanları da olabilir, yalnız kendi ilanlarımız denetlenir.
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false). node test/e2e-return-plan.mjs api.log
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
const lastCode = (phone) =>
  [...log().matchAll(/\[SMS → (\+\d+)\] Seferna giriş kodunuz: (\d{6})/g)].filter((m) => m[1] === phone).at(-1)?.[2];
async function login(phone) {
  await api("POST", "/auth/otp/request", null, { phone });
  await sleep(300);
  return (await api("POST", "/auth/otp/verify", null, { phone, code: lastCode(phone) })).body;
}
async function user(phone, roles) {
  const t = await login(phone);
  return (await api("POST", "/me/roles", t.accessToken, { roles })).body.accessToken;
}
const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90538${run}%'`) !== "0");
const phone = (n) => `+90538${run}${String(n).padStart(3, "0")}`;

const S = await user(phone(1), ["shipper"]); // işin yük sahibi
const S2 = await user(phone(2), ["shipper"]); // önerilecek yüklerin sahibi
const C = await user(phone(3), ["carrier"]); // işi taşıyan
const C2 = await user(phone(4), ["carrier"]); // başka nakliyeci
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const EFELER = district("Aydın", "Efeler"), NAZILLI = district("Aydın", "Nazilli"), TUZLA = district("İstanbul", "Tuzla"), PENDIK = district("İstanbul", "Pendik");
const GEBZE = district("Kocaeli", "Gebze"), OSMANGAZI = district("Bursa", "Osmangazi"), CANKAYA = district("Ankara", "Çankaya"), SELCUKLU = district("Konya", "Selçuklu");

async function load(t, from, to, day, extra = {}) {
  const r = await api("POST", "/loads", t, {
    originDistrictId: from, destDistrictId: to, loadFrom: trDay(day), loadTo: trDay(day), cargoType: "genel",
    weightTon: 8, vehicleType: "kamyon", bodyType: null, priceType: "teklif", price: null, ...extra,
  });
  if (r.body.status === "moderasyonda") await api("POST", `/admin/loads/${r.body.id}/review`, A, { decision: "onay" });
  return r.body.id;
}
const V = (await api("POST", "/vehicles", C, { plate: `09 RP ${run}`, vehicleType: "kamyon", bodyType: "kapali", capacityTon: 15 })).body.id;
const JL = await load(S, EFELER, TUZLA, 1);
const offer = (await api("POST", `/loads/${JL}/offers`, C, { vehicleId: V, price: 20000 })).body.id;
const acc = (await api("POST", `/offers/${offer}/accept`, S)).body;
const J = acc.job.id;
check("iş kuruldu (Efeler → Tuzla, yarın)", !!J, JSON.stringify(acc).slice(0, 200));

// Önerilecek ve önerilmeyecek yükler (S2'nin)
const RET = await load(S2, PENDIK, NAZILLI, 3); // dönüş: varışa ≤ 50 km, eve ≤ 80 km, pencerede
const RET_LATE = await load(S2, PENDIK, NAZILLI, 9); // pencere dışı
const RET_HEAVY = await load(S2, PENDIK, NAZILLI, 3, { weightTon: 20 }); // 15 tonluk araca ağır
const RET_TIR = await load(S2, PENDIK, NAZILLI, 3, { vehicleType: "tir" }); // kamyon tır yükünü taşıyamaz
const ROUTE = await load(S2, GEBZE, OSMANGAZI, 3); // dönüş yolunda, doğru yön
const ROUTE_BACK = await load(S2, OSMANGAZI, GEBZE, 3); // ters yön
const FAR = await load(S2, CANKAYA, SELCUKLU, 3); // yol dışı
check("yükler yayında", [RET, RET_LATE, RET_HEAVY, RET_TIR, ROUTE, ROUTE_BACK, FAR].every(Boolean));

console.log("\nYetki ve durum");
check("girişsiz 401", (await api("GET", `/return-plan/${J}`)).status === 401);
check("yük sahibi (nakliyeci rolü yok) 403", (await api("GET", `/return-plan/${J}`, S)).status === 403);
check("başka nakliyeci 404", (await api("GET", `/return-plan/${J}`, C2)).status === 404);
check("geçersiz kimlik 400", (await api("GET", "/return-plan/x", C)).status === 400);

console.log("\nPlan");
let r = await api("GET", `/return-plan/${J}`, C);
const plan = r.body;
check("200; iş özeti: kalkış, varış, araç", r.status === 200 && plan.job?.origin?.district === "Efeler" && plan.job?.dest?.district === "Tuzla" && plan.job?.vehicle?.plate === `09RP${run}`, JSON.stringify(plan.job));
check("OSRM rotası (kuş uçuşu değil), dönüş km ~500", plan.job?.routeSource === "osrm" && plan.job.returnKm > 400 && plan.job.returnKm < 650, `${plan.job?.routeSource} ${plan.job?.returnKm}`);
check("tahmini varış = yükleme günü + ⌈km/600⌉ (yarın + 1), pencere +2 gün", plan.job?.arrivalDay === trDay(2) && plan.job?.window?.from === trDay(2) && plan.job?.window?.to === trDay(4), JSON.stringify(plan.job?.window));
check("dönüş rotası geometrisi önbelleğe yazıldı", psql(`select jsonb_array_length(geometry) > 10 from district_routes where origin_district_id=${TUZLA} and dest_district_id=${EFELER}`) === "t");
const retIds = plan.returnLoads?.map((l) => l.id) ?? [];
const routeIds = plan.onRouteLoads?.map((l) => l.id) ?? [];
check("dönüş yükü önerildi, eşleşme skoru ve mesafelerle", retIds.includes(RET) && plan.returnLoads.find((l) => l.id === RET).match.originKm < 50, JSON.stringify(plan.returnLoads?.find((l) => l.id === RET)?.match));
check("kart besleme biçiminde (yük sahibi itibarı, maskeli numara)", (() => { const c = plan.returnLoads.find((l) => l.id === RET); return c && c.origin.district === "Pendik" && c.shipper?.phoneMasked?.includes("*") && "ratingCount" in c.shipper; })());
check("pencere dışı, ağır ve araç tipine uymayan dönüş yükü yok", ![RET_LATE, RET_HEAVY, RET_TIR].some((id) => retIds.includes(id) || routeIds.includes(id)));
check("rota üstü yük önerildi (sapma ≤ 30 km, kapsama)", routeIds.includes(ROUTE) && (() => { const x = plan.onRouteLoads.find((l) => l.id === ROUTE).route; return x.originDevKm <= 30 && x.destDevKm <= 30 && x.coverage > 0; })(), JSON.stringify(plan.onRouteLoads?.find((l) => l.id === ROUTE)?.route));
check("ters yöndeki ve yol dışındaki yük yok", ![ROUTE_BACK, FAR].some((id) => retIds.includes(id) || routeIds.includes(id)));
check("dönüş yükü rota üstü listesinde tekrar edilmez", !routeIds.includes(RET));
check("alarm önerisi: varıştan eve, araç tipiyle, henüz yok", plan.alert?.originDistrictId === TUZLA && plan.alert?.destDistrictId === EFELER && plan.alert?.vehicleType === "kamyon" && plan.alert?.exists === false, JSON.stringify(plan.alert));

console.log("\nAlarm (UC-12) ve teslimden sonra");
r = await api("POST", "/alerts", C, { originDistrictId: plan.alert.originDistrictId, destDistrictId: plan.alert.destDistrictId, vehicleType: plan.alert.vehicleType });
check("alarm kuruldu", r.status === 201, JSON.stringify(r.body));
check("planda alarm 'var'", (await api("GET", `/return-plan/${J}`, C)).body.alert?.exists === true);
await api("POST", `/jobs/${J}/deliver`, C, { code: acc.deliveryCode });
r = await api("GET", `/return-plan/${J}`, C);
check("teslim edildi: varış = teslim günü (bugün), pencere bugünden", r.status === 200 && r.body.job.status === "teslim_edildi" && r.body.job.arrivalDay === trDay(0) && r.body.job.window.to === trDay(2), JSON.stringify(r.body.job?.window));
check("pencere kaydı: 3 gün sonraki yük (tolerans 1 gün) hâlâ önerilir", r.body.returnLoads.some((l) => l.id === RET));
await api("POST", `/jobs/${J}/complete`, S);
r = await api("GET", `/return-plan/${J}`, C);
check("tamamlanan işte 409", r.status === 409 && /süren işlerde/.test(r.body.message), JSON.stringify(r.body));

// Temizlik: aynı güzergâhta her koşu 4 ilan bırakıyordu; birikince (öneri listesi ilk 20) sonraki koşuların ilanını itiyordu
psql(`update load_posts set status='iptal' where status in ('teyitli','teyit_bekliyor','moderasyonda') and shipper_id in (select id from users where phone like '+90538${run}%')`);
console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
