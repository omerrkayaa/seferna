// Puanlama + güven skoru (FR-40…42, BR-30, BR-31) uçtan uca test.
// Yalıtım: e2e-jobs.mjs gibi "panelvan" tipini kullanır (takımlar sırayla çalışır); başta ve sonda bu tipteki ilanları kapatır.
// Beklenen skorlar shared'daki formülle hesaplanır: test, API'nin formüle doğru girdileri verdiğini doğrular.
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false). node test/e2e-ratings.mjs api.log
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
const notes = async (t, type) => (await api("GET", "/notifications", t)).body.items.filter((n) => n.type === type);

const cleanup = () => {
  psql(`update load_posts set status='iptal' where vehicle_type='panelvan' and status in ('teyitli','teyit_bekliyor','moderasyonda')`);
  psql(`update capacity_posts set status='iptal' where status='aktif' and vehicle_id in (select id from vehicles where vehicle_type='panelvan')`);
};
cleanup();

const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
// 4 haneli kimlik eski bir çalıştırmayla çakışabiliyor (aynı numaralar/plakalar): DB'de boş olana kadar yeniden üretilir
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90556${run}%'`) !== "0");
const phone = (n) => `+90556${run}${String(n).padStart(3, "0")}`;

const S = await user(phone(1), ["shipper"]);
const C = await user(phone(2), ["carrier"]);
const X = await user(phone(3), ["carrier"]);
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla
await api("PATCH", "/me", S, { name: "Yük Sahibi Test" });
const sId = (await api("GET", "/me", S)).body.id, cId = (await api("GET", "/me", C)).body.id;

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const MENTESE = district("Muğla", "Menteşe"), MURATPASA = district("Antalya", "Muratpaşa");
const V = (await api("POST", "/vehicles", C, { plate: `48 RA ${run}`, vehicleType: "panelvan", bodyType: "kapali", capacityTon: 3 })).body.id;

/** İlan → teklif → kabul; iş kimliği ve teslim kodu döner. */
async function newJob() {
  const l = await api("POST", "/loads", S, {
    originDistrictId: MENTESE, destDistrictId: MURATPASA, loadFrom: trDay(1), loadTo: trDay(2), cargoType: "genel",
    weightTon: 2, vehicleType: "panelvan", bodyType: "kapali", priceType: "teklif", price: null,
  });
  if (l.body.status === "moderasyonda") await api("POST", `/admin/loads/${l.body.id}/review`, A, { decision: "onay" });
  const o = await api("POST", `/loads/${l.body.id}/offers`, C, { vehicleId: V, price: 3000 });
  const r = await api("POST", `/offers/${o.body.id}/accept`, S);
  return { id: r.body.job.id, code: r.body.deliveryCode, loadId: l.body.id };
}
const rate = (t, jobId, body) => api("POST", `/jobs/${jobId}/rating`, t, body);
const rep = async (id, t = X) => (await api("GET", `/users/${id}/reputation`, t)).body;
/** Beklenen skor: görünür puanlar, tamamlanan/toplam/iptal iş, haklı şikayet, ilan sayısı (doğrulama seviyesi 0). */
const expected = ({ stars, completed, total, cancelled = 0, upheld = 0, loads = 0 }) =>
  trustScore({
    avgStars: stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : null,
    ratingCount: stars.length,
    completedJobs: completed,
    verificationLevel: 0,
    cancelRate: total ? cancelled / total : 0,
    reportRate: upheld / Math.max(1, loads + total),
  });
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 0.0011;

// ── Puan verme ────────────────────────────────────────────────────
console.log("\nPuan verme (FR-40, BR-31)");
const J1 = await newJob();
let r = await rate(S, J1.id, { stars: 5 });
check("tamamlanmamış iş puanlanamaz 409", r.status === 409 && r.body.message.includes("tamamlanmış"), JSON.stringify(r.body));
check("yeni üye skoru 0,25", (await rep(cId)).trustScore === 0.25);
await api("POST", `/jobs/${J1.id}/complete`, S);
check("üçüncü kişi puanlayamaz 404", (await rate(X, J1.id, { stars: 1 })).status === 404);
check("0 yıldız 400", (await rate(S, J1.id, { stars: 0 })).status === 400);
check("bilinmeyen etiket 400", (await rate(S, J1.id, { stars: 5, tags: ["harika"] })).status === 400);
r = await rate(S, J1.id, { stars: 5, tags: ["odeme_sorunsuz"] });
check("nakliyeciye 'ödeme sorunsuz' verilemez 400", r.status === 400 && r.body.message.includes("nakliyeciye"), JSON.stringify(r.body));
check("yük sahibine 'yüke özenli' verilemez 400", (await rate(C, J1.id, { stars: 4, tags: ["yuk_ozenli"] })).status === 400);
r = await rate(S, J1.id, { stars: 5, tags: ["zamaninda", "yuk_ozenli"], comment: "Çok özenli taşıdı" });
check("yük sahibi nakliyeciyi puanladı", r.status === 201 && r.body.given?.stars === 5 && r.body.received === null && r.body.canRate === false, JSON.stringify(r.body));
check("ikinci kez puanlama 409", (await rate(S, J1.id, { stars: 1 })).status === 409);

console.log("\nKör puanlama");
r = await api("GET", `/jobs/${J1.id}`, C);
check("nakliyeci puanlandığını görür ama puanı görmez", r.body.rating?.received?.revealed === false && r.body.rating.received.stars === undefined && r.body.rating.canRate === true, JSON.stringify(r.body.rating));
check("son gün = tamamlanma + 14 gün", r.body.rating?.deadline === new Date(new Date(r.body.completedAt).getTime() + 14 * 86400e3).toISOString());
let p = await rep(cId);
check("gizli puan profilde yok", p.rating.count === 0 && p.recent.length === 0, JSON.stringify(p.rating));
check("gizli puan skora girmedi", near(p.trustScore, expected({ stars: [], completed: 1, total: 1 })), String(p.trustScore));
check("nakliyeciye 'puanlandınız' bildirimi", (await notes(C, "job_update")).some((n) => n.title === "Puanlandınız"));
r = await rate(C, J1.id, { stars: 4, tags: ["odeme_sorunsuz", "iletisim_iyi"] });
check("karşı taraf da puanlayınca ikisi görünür", r.status === 201 && r.body.received?.revealed === true && r.body.received.stars === 5, JSON.stringify(r.body));
check("DB'de iki puan görünür", psql(`select count(*) from ratings where job_id='${J1.id}' and revealed_at is not null`) === "2");
check("yük sahibine 'puanlandınız' gitmedi (iki taraf da puanladı)", !(await notes(S, "job_update")).some((n) => n.title === "Puanlandınız"));

console.log("\nProfil (FR-41) ve skor (BR-30)");
p = await rep(cId);
check("ortalama, sayı ve etiketler", p.rating.average === 5 && p.rating.count === 1 && p.rating.tags.zamaninda === 1 && p.rating.tags.yuk_ozenli === 1, JSON.stringify(p.rating));
check("son puanlar: yorum ve puanlayanın rolü", p.recent[0]?.comment === "Çok özenli taşıdı" && p.recent[0].raterRole === "shipper", JSON.stringify(p.recent));
check("puanlayanın adı ve numarası gösterilmez", !JSON.stringify(p).includes("Yük Sahibi Test") && !JSON.stringify(p).includes(phone(1)) && !JSON.stringify(p).includes(sId));
check("tamamlanan iş, iptal oranı, üyelik", p.completedJobs === 1 && p.cancelRate === 0 && !!p.memberSince);
check("nakliyecinin skoru formülle aynı", near(p.trustScore, expected({ stars: [5], completed: 1, total: 1 })), String(p.trustScore));
check("yük sahibinin skoru formülle aynı", near((await rep(sId)).trustScore, expected({ stars: [4], completed: 1, total: 1 })));
check("/me de aynı skoru gösterir", (await api("GET", "/me", C)).body.trustScore === p.trustScore);
check("bilinmeyen kullanıcı 404", (await api("GET", `/users/00000000-0000-4000-8000-000000000000/reputation`, X)).status === 404);
check("girişsiz profil 401", (await api("GET", `/users/${cId}/reputation`)).status === 401);

// ── Süre ve zamanlayıcı ───────────────────────────────────────────
console.log("\nYük kartında yük sahibinin itibarı (A6)");
let lr = await api("POST", "/loads", S, {
  originDistrictId: MENTESE, destDistrictId: MURATPASA, loadFrom: trDay(3), loadTo: trDay(3), cargoType: "genel",
  weightTon: 2, vehicleType: "panelvan", bodyType: "kapali", priceType: "teklif", price: null,
});
if (lr.body.status === "moderasyonda") await api("POST", `/admin/loads/${lr.body.id}/review`, A, { decision: "onay" });
const feedCard = (await api("GET", `/loads?vehicleType=panelvan&fromProvinceId=48&date=${trDay(3)}`, X)).body.items?.find((l) => l.id === lr.body.id);
check("akış kartı: yük sahibinin görünür puanı, puan sayısı, tamamlanan işi", feedCard?.shipper.rating === 4 && feedCard.shipper.ratingCount === 1 && feedCard.shipper.completedJobs === 1, JSON.stringify(feedCard?.shipper));
const detailShipper = (await api("GET", `/loads/${lr.body.id}`, X)).body.shipper;
check("ilan detayı (başkası): aynı itibar, numara maskeli", detailShipper?.rating === 4 && detailShipper.completedJobs === 1 && !JSON.stringify(detailShipper).includes(phone(1)), JSON.stringify(detailShipper));
psql(`update load_posts set status='iptal' where id='${lr.body.id}'`);

console.log("\nPuanlama süresi (14 gün) ve zamanlayıcı");
const J2 = await newJob();
await api("POST", `/jobs/${J2.id}/complete`, S);
await rate(S, J2.id, { stars: 1, tags: ["gec_kaldi"] });
psql(`update jobs set completed_at = now() - interval '15 days' where id='${J2.id}'`);
r = await rate(C, J2.id, { stars: 5 });
check("süre bitince puan verilemez 409", r.status === 409 && r.body.message.includes("süresi"), JSON.stringify(r.body));
check("tur öncesi gizli", (await rep(cId)).rating.count === 1);
r = await api("POST", "/admin/tick", A);
check("tur süresi biten puanı açtı", r.body.ratingsRevealed >= 1 && psql(`select count(*) from ratings where job_id='${J2.id}' and revealed_at is not null`) === "1", JSON.stringify(r.body));
p = await rep(cId);
check("açılan puan profilde ve skorda", p.rating.count === 2 && p.rating.average === 3 && near(p.trustScore, expected({ stars: [5, 1], completed: 2, total: 2 })), JSON.stringify(p.rating) + p.trustScore);
check("ikinci tur aynı puanı tekrar açmaz", (await api("POST", "/admin/tick", A)).body.ratingsRevealed === 0);

// ── Eşzamanlı puan ────────────────────────────────────────────────
console.log("\nEşzamanlı puanlama (3 tur)");
let together = 0;
for (let i = 0; i < 3; i++) {
  const J = await newJob();
  await api("POST", `/jobs/${J.id}/complete`, S);
  const [a, b] = await Promise.all([rate(S, J.id, { stars: 4 }), rate(C, J.id, { stars: 4 })]);
  if (a.status === 201 && b.status === 201 && psql(`select count(*) from ratings where job_id='${J.id}' and revealed_at is not null`) === "2") together++;
}
check("aynı anda puanlayan iki tarafın puanı da görünür (3/3)", together === 3, `${together}/3`);
p = await rep(cId);
check("skor eşzamanlı puanlardan sonra doğru", near(p.trustScore, expected({ stars: [5, 1, 4, 4, 4], completed: 5, total: 5 })), String(p.trustScore));

// ── İptal oranı ───────────────────────────────────────────────────
console.log("\nİptal oranı (yalnız iptal edene)");
const J4 = await newJob();
await api("POST", `/jobs/${J4.id}/cancel`, C, { reason: "Araç arızalandı" });
p = await rep(cId);
check("iptal eden nakliyecinin oranı 1/6", p.cancelRate === 0.17 && near(p.trustScore, expected({ stars: [5, 1, 4, 4, 4], completed: 5, total: 6, cancelled: 1 })), `${p.cancelRate} ${p.trustScore}`);
const sRep = await rep(sId);
check("mağdur yük sahibinin oranı 0", sRep.cancelRate === 0 && near(sRep.trustScore, expected({ stars: [4, 4, 4, 4], completed: 5, total: 6 })), `${sRep.cancelRate} ${sRep.trustScore}`);
check("iptal edilen iş puanlanamaz 409", (await rate(S, J4.id, { stars: 1 })).status === 409);

// ── Haklı şikayet ve otomatik tamamlama ───────────────────────────
console.log("\nHaklı şikayet bileşeni ve otomatik tamamlama (BR-32)");
const xId = (await api("GET", "/me", X)).body.id;
psql(`insert into reports(reporter_id, target_type, target_id, reason, status) values ('${xId}', 'user', '${cId}', 'diger', 'hakli')`);
psql(`insert into reports(reporter_id, target_type, target_id, reason, status) values ('${xId}', 'load_post', '${J1.loadId}', 'sahte', 'hakli')`);
psql(`insert into reports(reporter_id, target_type, target_id, reason) values ('${xId}', 'load_post', '${J2.loadId}', 'sahte')`); // açık: sayılmaz
const J5 = await newJob(); // olay: iki tarafın skoru yeniden hesaplanır
await api("POST", `/jobs/${J5.id}/deliver`, C, { code: J5.code });
psql(`update jobs set delivered_at = now() - interval '49 hours' where id='${J5.id}'`);
r = await api("POST", "/admin/tick", A);
check("tur işi otomatik tamamladı", r.body.jobsCompleted >= 1 && psql(`select status from jobs where id='${J5.id}'`) === "tamamlandi");
p = await rep(cId);
check("otomatik tamamlanan iş sayıldı, haklı şikayet skoru düşürdü",
  p.completedJobs === 6 && near(p.trustScore, expected({ stars: [5, 1, 4, 4, 4], completed: 6, total: 7, cancelled: 1, upheld: 1 })), `${p.completedJobs} ${p.trustScore}`);
const sLoads = Number(psql(`select count(*) from load_posts where shipper_id='${sId}'`));
check("yük sahibinin ilanına haklı şikayet sayıldı (açık şikayet sayılmadı)",
  near((await rep(sId)).trustScore, expected({ stars: [4, 4, 4, 4], completed: 6, total: 7, upheld: 1, loads: sLoads })));
r = await api("GET", `/jobs/${J5.id}`, S);
check("otomatik tamamlanan iş puanlanabilir", r.body.rating?.canRate === true && (await rate(S, J5.id, { stars: 5 })).status === 201);

cleanup();
console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
