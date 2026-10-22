// Yönetici: şikayet kuyruğu (Y3) ve askıya alma (Y2) — FR-51 uçtan uca test.
// Yalıtım: Sinop → Bartın bölgesi ve +90542… numaraları (diğer takımlar kullanmaz). Başta bu numaraların açık
// ilanları/boş araçları kapatılır.
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false). node test/e2e-admin.mjs api.log
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { trustScore } from "@nakliye/shared";
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
async function otp(phone) {
  await sleep(300);
  return [...log().matchAll(/\[SMS → (\+\d+)\] Seferna giriş kodunuz: (\d{6})/g)].filter((m) => m[1] === phone).at(-1)[2];
}
async function login(phone) {
  await api("POST", "/auth/otp/request", null, { phone });
  return (await api("POST", "/auth/otp/verify", null, { phone, code: await otp(phone) })).body;
}
async function user(phone, roles) {
  const t = await login(phone);
  const access = roles.length ? (await api("POST", "/me/roles", t.accessToken, { roles })).body.accessToken : t.accessToken;
  return { access, refresh: t.refreshToken };
}

const cleanup = () => {
  psql(`update load_posts set status='iptal' where status in ('teyitli','teyit_bekliyor','moderasyonda') and shipper_id in (select id from users where phone like '+90542%')`);
  psql(`update capacity_posts set status='iptal' where status='aktif' and carrier_id in (select id from users where phone like '+90542%')`);
};
cleanup();

const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
// 4 haneli kimlik eski bir çalıştırmayla çakışabiliyor (aynı numaralar/plakalar): DB'de boş olana kadar yeniden üretilir
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90542${run}%'`) !== "0");
const phone = (n) => `+90542${run}${String(n).padStart(3, "0")}`;
const idOf = (p) => psql(`select id from users where phone='${p}'`);
const trustOf = (p) => Number(psql(`select trust_score from users where phone='${p}'`));

const S = await user(phone(1), ["shipper"]);
const S2 = await user(phone(2), ["shipper"]);
const C1 = await user(phone(3), ["carrier"]);
const C2 = await user(phone(4), ["carrier"]);
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla
const adminId = idOf(phone(9));

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const SINOP = district("Sinop", "Merkez"), BARTIN = district("Bartın", "Merkez");

async function load(t, { approve = true } = {}) {
  const r = await api("POST", "/loads", t, {
    originDistrictId: SINOP, destDistrictId: BARTIN, loadFrom: trDay(1), loadTo: trDay(2), cargoType: "genel",
    weightTon: 8, vehicleType: "kamyon", bodyType: null, priceType: "teklif", price: null,
  });
  if (r.body.status === "moderasyonda" && approve) await api("POST", `/admin/loads/${r.body.id}/review`, A, { decision: "onay" });
  return r.body.id;
}
// Plaka çalıştırmaya özel (rastgele 3 hane birkaç çalıştırmada eski aktif plakayla çakıştı, araç açılmadı)
let plates = 0;
async function vehicle(t) {
  const plate = `57 AD ${run}${++plates}`;
  const r = await api("POST", "/vehicles", t, { plate, vehicleType: "kamyon", bodyType: "tenteli", capacityTon: 10 });
  if (r.status !== 201) throw new Error(`Araç açılamadı (${plate}): ${JSON.stringify(r.body)}`);
  return r.body.id;
}

// ── Yetki ─────────────────────────────────────────────────────────
console.log("\nYetki");
check("yönetici olmayan şikayet kuyruğu 403", (await api("GET", "/admin/reports", C1.access)).status === 403);
check("yönetici olmayan kullanıcı arama 403", (await api("GET", "/admin/users", S.access)).status === 403);
check("yönetici olmayan askıya alma 403", (await api("POST", `/admin/users/${idOf(phone(2))}/suspend`, C1.access, { reason: "deneme sebebi" })).status === 403);

// ── Şikayet kuyruğu ───────────────────────────────────────────────
console.log("\nŞikayet kuyruğu (Y3)");
const L1 = await load(S.access);
for (const c of [C1, C2]) await api("POST", `/loads/${L1}/call`, c.access);
const r1 = (await api("POST", "/reports", C1.access, { targetType: "load_post", targetId: L1, reason: "sahte", note: "Numara başka firmaya çıktı" })).body.id;
const r2 = (await api("POST", "/reports", C2.access, { targetType: "load_post", targetId: L1, reason: "telefon_acilmiyor" })).body.id;
const r3 = (await api("POST", "/reports", C1.access, { targetType: "user", targetId: idOf(phone(2)), reason: "diger", note: "Küfürlü konuştu" })).body.id;
check("şikayetler kaydedildi", !!r1 && !!r2 && !!r3);

/** Kuyruğun bütün sayfaları (önceki çalıştırmaların açık şikayetleri ilk sayfayı doldurabilir) */
async function queue(status = "acik") {
  const items = [];
  for (let page = 1; ; page++) {
    const r = await api("GET", `/admin/reports?status=${status}&page=${page}`, A);
    if (r.status !== 200) return { status: r.status, body: { items } };
    items.push(...r.body.items);
    if (!r.body.hasMore) return { status: 200, body: { items } };
  }
}
let q = await queue();
const mine = (id) => q.body.items.find((x) => x.id === id);
check("açık kuyrukta üçü de var", q.status === 200 && !!mine(r1) && !!mine(r2) && !!mine(r3), JSON.stringify(q.body).slice(0, 200));
check("ilan şikayetinde ilan özeti ve sahibi", mine(r1)?.target.load?.origin.province === "Sinop" && mine(r1)?.target.owner?.phone === phone(1), JSON.stringify(mine(r1)?.target));
check("aynı ilana açık şikayet sayısı 2", mine(r1)?.openOnTarget === 2);
check("kullanıcı şikayetinde hedef kullanıcı", mine(r3)?.target.type === "user" && mine(r3)?.target.load === null && mine(r3)?.target.owner?.phone === phone(2));
check("şikayetçi ve not görünür", mine(r1)?.reporter.phone === phone(3) && mine(r1)?.note === "Numara başka firmaya çıktı");
const idx = (id) => q.body.items.findIndex((x) => x.id === id);
check("açık kuyruk eskiden yeniye", idx(r1) < idx(r2) && idx(r2) < idx(r3));

check("geçersiz karar 400", (await api("POST", `/admin/reports/${r2}/resolve`, A, { decision: "belki" })).status === 400);
check("bilinmeyen şikayet 404", (await api("POST", `/admin/reports/00000000-0000-4000-8000-000000000000/resolve`, A, { decision: "haksiz" })).status === 404);
let r = await api("POST", `/admin/reports/${r2}/resolve`, A, { decision: "haksiz", note: "Arandı, açtı" });
check("haksız karar", r.status === 200 && r.body.status === "haksiz");
check("ikinci karar 409", (await api("POST", `/admin/reports/${r2}/resolve`, A, { decision: "hakli" })).status === 409);
check("karar kaydı (kim, ne zaman, not)", psql(`select status||'|'||resolved_by||'|'||resolution||'|'||(resolved_at is not null) from reports where id='${r2}'`) === `haksiz|${adminId}|Arandı, açtı|true`);
check("haksız karar skoru değiştirmez", trustOf(phone(1)) === 0.25, String(trustOf(phone(1))));

r = await api("POST", `/admin/reports/${r1}/resolve`, A, { decision: "hakli" });
check("haklı karar", r.status === 200 && r.body.status === "hakli");
// Yeni yük sahibi: puan yok, iş yok, 1 ilan, 1 haklı şikayet → şikayet oranı 1 (BR-30)
const expected = trustScore({ avgStars: null, ratingCount: 0, completedJobs: 0, verificationLevel: 0, cancelRate: 0, reportRate: 1 });
const clean = trustScore({ avgStars: null, ratingCount: 0, completedJobs: 0, verificationLevel: 0, cancelRate: 0, reportRate: 0 });
check(`haklı şikayet ilan sahibinin skorunu düşürür (${clean} → ${trustOf(phone(1))}, beklenen ${expected})`, trustOf(phone(1)) === expected && expected < clean);

q = await queue();
check("kararlılar açık kuyrukta yok, diğeri duruyor", !mine(r1) && !mine(r2) && !!mine(r3));
q = await queue("kapali");
check("kapalı listede kararlar", mine(r1)?.status === "hakli" && mine(r2)?.status === "haksiz" && mine(r2)?.resolution === "Arandı, açtı");
check("açık sayaç kararla düşer", mine(r1)?.openOnTarget === 0);
r = await api("GET", "/admin/reports?status=kapali", A);
check("kapalılar en son karar başta (karar tarihi boş eski kayıtlar sonda)", r.body.items[0]?.id === r1 && r.body.items[1]?.id === r2, JSON.stringify(r.body.items.slice(0, 2).map((x) => [x.id, x.resolvedAt])));

// ── Kullanıcı arama ───────────────────────────────────────────────
console.log("\nKullanıcı arama (Y2)");
r = await api("GET", `/admin/users?q=${encodeURIComponent("0" + phone(1).slice(3))}`, A);
check("numarayla (0'lı yazım) bulunur", r.status === 200 && r.body.items.length === 1 && r.body.items[0].phone === phone(1), JSON.stringify(r.body).slice(0, 200));
await api("PATCH", "/me", S2.access, { name: `Adminarama ${run}` });
r = await api("GET", `/admin/users?q=${encodeURIComponent(`adminarama ${run}`)}`, A);
check("adla (büyük/küçük harf duyarsız) bulunur", r.body.items.length === 1 && r.body.items[0].phone === phone(2), JSON.stringify(r.body.items.map((u) => u.phone)));
r = await api("GET", `/admin/users?q=${encodeURIComponent("+90 542")}`, A);
check("4 haneden kısa numara araması boş döner (hepsini listelemez)", r.status === 200 && r.body.items.length === 0);

// ── Askıya alma ───────────────────────────────────────────────────
console.log("\nAskıya alma (FR-51)");
const L2 = await load(S.access, { approve: false });
const L2status = psql(`select status from load_posts where id='${L2}'`);
const c1v = await vehicle(C1.access);
check("teklif verildi", (await api("POST", `/loads/${L1}/offers`, C1.access, { vehicleId: c1v, price: 7000 })).status === 201);
const sId = idOf(phone(1));

check("kısa sebep 400", (await api("POST", `/admin/users/${sId}/suspend`, A, { reason: "kot" })).status === 400);
check("kendini askıya alamaz 409", (await api("POST", `/admin/users/${adminId}/suspend`, A, { reason: "kendimi deniyorum" })).status === 409);
check("bilinmeyen kullanıcı 404", (await api("POST", `/admin/users/00000000-0000-4000-8000-000000000000/suspend`, A, { reason: "olmayan kullanıcı" })).status === 404);

r = await api("POST", `/admin/users/${sId}/suspend`, A, { reason: "Sahte ilan, haklı şikayet" });
check(`yük sahibi askıya alındı (ilanlar: ${r.body.closedLoads}, ikinci ilan ${L2status})`, r.status === 200 && r.body.user?.status === "askida" && r.body.closedLoads === 2, JSON.stringify(r.body));
check("ilanlar iptal", psql(`select string_agg(status::text, ',' order by created_at) from load_posts where id in ('${L1}','${L2}')`) === "iptal,iptal");
check("ilana gelen bekleyen teklif sonuçlanmadı (ret)", psql(`select status from offers where load_post_id='${L1}' and carrier_id='${idOf(phone(3))}'`) === "ret");
check("nakliyeciye 'sonuçlanmadı' bildirimi", (await api("GET", "/notifications", C1.access)).body.items.some((n) => n.type === "offer_result" && n.data?.loadId === L1));
check("aramada ilan görünmez", (await api("GET", `/loads/${L1}`, C1.access)).status === 404);
check("askıdayken tekrar 409", (await api("POST", `/admin/users/${sId}/suspend`, A, { reason: "yine deneme" })).status === 409);
check("sebep ve tarih kayıtlı", psql(`select suspend_reason||'|'||(suspended_at is not null) from users where id='${sId}'`) === "Sahte ilan, haklı şikayet|true");

r = await api("POST", "/auth/refresh", null, { refreshToken: S.refresh });
check("oturum yenilenemez 401", r.status === 401);
await api("POST", "/auth/otp/request", null, { phone: phone(1) });
r = await api("POST", "/auth/otp/verify", null, { phone: phone(1), code: await otp(phone(1)) });
check("giriş yapamaz 403 + mesaj", r.status === 403 && r.body.message === "Hesabınız askıya alındı.", JSON.stringify(r.body));
r = await api("GET", "/me", S.access);
check("erişim belirteci de hemen kapanır 403 + mesaj", r.status === 403 && r.body.message === "Hesabınız askıya alındı.", JSON.stringify(r.body));

// Nakliyeci: boş araç ilanı ve bekleyen teklif
const L3 = await load(S2.access);
const c2v = await vehicle(C2.access);
check("C2 teklif", (await api("POST", `/loads/${L3}/offers`, C2.access, { vehicleId: c2v, price: 6500 })).status === 201);
const cap = await api("POST", "/capacity", C2.access, { vehicleId: c2v, originDistrictId: SINOP, destDistrictId: null, availableFrom: trDay(0), availableTo: trDay(2) });
check("C2 boş araç ilanı", cap.status === 201, JSON.stringify(cap.body));
const c2Id = idOf(phone(4));
r = await api("POST", `/admin/users/${c2Id}/suspend`, A, { reason: "Teklif verip gelmiyor" });
check("nakliyeci askıya alındı: 1 boş araç, 1 teklif", r.status === 200 && r.body.closedCapacity === 1 && r.body.withdrawnOffers === 1, JSON.stringify(r.body));
check("boş araç iptal", psql(`select status from capacity_posts where id='${cap.body.id}'`) === "iptal");
check("teklif geri çekildi", psql(`select status from offers where load_post_id='${L3}' and carrier_id='${c2Id}'`) === "geri_cekildi");
check("başkasının ilanı yayında kalır", psql(`select status from load_posts where id='${L3}'`) === "teyitli");

r = await api("GET", "/admin/users", A);
check("q boşken askıdakiler listelenir", r.body.items.some((u) => u.id === c2Id && u.suspendReason === "Teklif verip gelmiyor"));

// Askıyı kaldır
r = await api("POST", `/admin/users/${sId}/unsuspend`, A);
check("askı kaldırıldı", r.status === 200 && r.body.user.status === "aktif" && r.body.user.suspendedAt === null);
check("askıda değilken kaldırma 409", (await api("POST", `/admin/users/${sId}/unsuspend`, A)).status === 409);
check("askı kalkınca süresi dolmamış erişim belirteci yeniden geçer", (await api("GET", "/me", S.access)).status === 200);
await sleep(61_000); // OTP yeniden gönderme bekleme süresi (60 sn)
await api("POST", "/auth/otp/request", null, { phone: phone(1) });
r = await api("POST", "/auth/otp/verify", null, { phone: phone(1), code: await otp(phone(1)) });
check("tekrar giriş yapabilir", r.status === 201 && !!r.body.accessToken, JSON.stringify(r.body));
check("kapanan ilanlar kapalı kalır", psql(`select status from load_posts where id='${L1}'`) === "iptal");
r = await api("GET", "/admin/users", A);
check("askısı kalkan listede yok", !r.body.items.some((u) => u.id === sId));

cleanup();
console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
