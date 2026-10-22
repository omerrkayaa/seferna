// İtirazlı işi yönetici çözer (BR-32 sonrası) — uçtan uca test.
// Yalıtım: Kilis → Osmaniye bölgesi ve +90545… numaraları (diğer takımlar kullanmaz). Başta ve sonda bu numaraların
// açık ilanları kapatılır. Çalıştırma kimliği DB'de kullanılmamış olana kadar yeniden üretilir (4 hane çakışabiliyor).
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false). node test/e2e-disputes.mjs api.log
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
const notes = async (t) => (await api("GET", "/notifications", t)).body.items.filter((n) => n.type === "job_update");

const cleanup = () =>
  psql(`update load_posts set status='iptal' where status in ('teyitli','teyit_bekliyor','moderasyonda') and shipper_id in (select id from users where phone like '+90545%')`);
cleanup();

const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90545${run}%'`) !== "0");
const phone = (n) => `+90545${run}${String(n).padStart(3, "0")}`;
const idOf = (p) => psql(`select id from users where phone='${p}'`);

const S = await user(phone(1), ["shipper"]);
const C = await user(phone(2), ["carrier"]);
const X = await user(phone(3), ["carrier"]);
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const ELBEYLI = district("Kilis", "Elbeyli"), KADIRLI = district("Osmaniye", "Kadirli");
const V = (await api("POST", "/vehicles", C, { plate: `79 KL ${run}`, vehicleType: "kamyonet", bodyType: "kapali", capacityTon: 3 })).body.id;
check("hazırlık: araç açıldı", typeof V === "string");

/** İlan → teklif → kabul → teslim → itiraz */
async function disputedJob(from, reason) {
  const r = await api("POST", "/loads", S, {
    originDistrictId: ELBEYLI, destDistrictId: KADIRLI, loadFrom: trDay(from), loadTo: trDay(from + 1), cargoType: "genel",
    weightTon: 2, vehicleType: "kamyonet", bodyType: null, priceType: "teklif", price: null,
  });
  if (r.body.status === "moderasyonda") await api("POST", `/admin/loads/${r.body.id}/review`, A, { decision: "onay" });
  const offer = (await api("POST", `/loads/${r.body.id}/offers`, C, { vehicleId: V, price: 3000 })).body;
  const acc = (await api("POST", `/offers/${offer.id}/accept`, S)).body;
  await api("POST", `/jobs/${acc.job.id}/deliver`, C, { code: acc.deliveryCode });
  const d = await api("POST", `/jobs/${acc.job.id}/dispute`, S, { reason });
  return { id: acc.job.id, status: d.body.status };
}
/** Listede sayfa sayfa ara (geliştirme DB'sinde başka takımların itirazlı işleri de var) */
async function findIn(status, id) {
  for (let page = 1; page < 50; page++) {
    const r = await api("GET", `/admin/disputes?status=${status}&page=${page}`, A);
    const hit = r.body.items?.find((j) => j.id === id);
    if (hit || !r.body.hasMore) return hit;
  }
}

console.log("\nİtiraz kuyruğu");
const J1 = await disputedJob(1, "Kolilerden ikisi ezik geldi");
const J2 = await disputedJob(4, "Yük hiç teslim edilmedi, kod yanlışlıkla paylaşıldı");
check("hazırlık: iki iş itirazlı", J1.status === "itirazli" && J2.status === "itirazli", JSON.stringify([J1, J2]));
check("yönetici olmayan kuyruğu göremez 403", (await api("GET", "/admin/disputes", X)).status === 403);
let hit = await findIn("acik", J1.id);
check("açık kuyrukta: itiraz sebebi ve zamanı", hit?.dispute?.reason === "Kolilerden ikisi ezik geldi" && !!hit.dispute.at && !!hit.deliveredAt, JSON.stringify(hit));
check("açık kuyrukta: iki tarafın numarası ve plaka (yönetici arar)", hit?.shipper.phone === phone(1) && hit?.carrier.phone === phone(2) && hit?.vehicle.plate === `79KL${run}`);
check("açık kuyrukta: güzergâh ve kararı yok", hit?.load.origin.district === "Elbeyli" && hit?.decision === null);

console.log("\nKarar doğrulaması");
check("gerekçesiz karar 400", (await api("POST", `/admin/disputes/${J1.id}/resolve`, A, { outcome: "tamamlandi" })).status === 400);
let r = await api("POST", `/admin/disputes/${J1.id}/resolve`, A, { outcome: "tamamlandi", note: "kısa" });
check("kısa gerekçe 400 (Türkçe mesaj)", r.status === 400 && JSON.stringify(r.body).includes("en az 5 karakter"), JSON.stringify(r.body));
check("geçersiz sonuç 400", (await api("POST", `/admin/disputes/${J1.id}/resolve`, A, { outcome: "teslim_edildi", note: "Deneme kararı" })).status === 400);
check("yük sahibi karar veremez 403", (await api("POST", `/admin/disputes/${J1.id}/resolve`, S, { outcome: "iptal", note: "Kendi lehime" })).status === 403);
check("olmayan iş 404", (await api("POST", `/admin/disputes/00000000-0000-4000-8000-000000000000/resolve`, A, { outcome: "iptal", note: "Deneme kararı" })).status === 404);

console.log("\nTeslim geçerli → tamamlandı");
const note1 = "Fotoğraflarda hasar taşımadan önce de var";
r = await api("POST", `/admin/disputes/${J1.id}/resolve`, A, { outcome: "tamamlandi", note: note1 });
check("karar: tamamlandı", r.status === 200 && r.body.status === "tamamlandi", JSON.stringify(r.body));
check("DB: tamamlandı + tamamlanma zamanı", psql(`select status || '|' || (completed_at is not null) from jobs where id='${J1.id}'`) === "tamamlandi|true");
check("ikinci karar 409", (await api("POST", `/admin/disputes/${J1.id}/resolve`, A, { outcome: "iptal", note: "Fikir değiştirdim" })).status === 409);
r = await api("GET", `/jobs/${J1.id}`, S);
const last = r.body.events?.at(-1);
check("zaman çizelgesi: yönetici tamamladı, gerekçeyle", last?.type === "tamamlandi" && last.by === "admin" && last.meta?.note === note1, JSON.stringify(last));
check("iki tarafa bildirim (gerekçeli)", (await notes(S)).some((n) => n.body.includes("teslim geçerli") && n.body.includes(note1)) && (await notes(C)).some((n) => n.body.includes("puanlayabilirsiniz")));
check("tamamlanınca iki taraf puanlayabilir", (await api("POST", `/jobs/${J1.id}/rating`, C, { stars: 4, tags: [] })).status === 201);

console.log("\nTeslim geçersiz → iptal (nakliyecinin hanesine)");
const note2 = "Alıcı yükü teslim almadığını belgeledi";
r = await api("POST", `/admin/disputes/${J2.id}/resolve`, A, { outcome: "iptal", note: note2 });
check("karar: iptal", r.status === 200 && r.body.status === "iptal");
check("DB: iptal, sebep yönetici kararı, iptal eden nakliyeci", psql(`select status || '|' || cancel_reason || '|' || cancelled_by from jobs where id='${J2.id}'`) === `iptal|Yönetici kararı: ${note2}|${idOf(phone(2))}`);
check("yük sahibine 'haklı bulundu', nakliyeciye 'iptal oranınıza'", (await notes(S)).some((n) => n.body.includes("haklı bulundu")) && (await notes(C)).some((n) => n.body.includes("iptal oranınıza")));
check("iptal edilen iş puanlanamaz", (await api("POST", `/jobs/${J2.id}/rating`, S, { stars: 1, tags: [] })).status !== 201);
r = await api("GET", `/jobs/${J2.id}`, S);
check("yük sahibi iş detayında yönetici kararını görür", r.body.cancelReason === `Yönetici kararı: ${note2}` && r.body.events.at(-1).by === "admin");

console.log("\nSonuçlanan kuyruk");
check("çözülen iş açık kuyrukta yok", !(await findIn("acik", J1.id)) && !(await findIn("acik", J2.id)));
hit = await findIn("kapali", J1.id);
check("sonuçlananlarda: karar ve gerekçe", hit?.decision?.outcome === "tamamlandi" && hit.decision.note === note1 && hit.status === "tamamlandi", JSON.stringify(hit?.decision));
const page1 = (await api("GET", "/admin/disputes?status=kapali", A)).body.items;
check("sonuçlananlar yeniden eskiye (son karar en üstte)", page1[0]?.id === J2.id && page1[1]?.id === J1.id, page1.slice(0, 2).map((j) => j.id).join());

console.log("\nİtirazsız iş");
r = await api("POST", "/loads", S, {
  originDistrictId: ELBEYLI, destDistrictId: KADIRLI, loadFrom: trDay(8), loadTo: trDay(8), cargoType: "genel",
  weightTon: 1, vehicleType: "kamyonet", bodyType: null, priceType: "teklif", price: null,
});
const L3 = r.body.id;
if (r.body.status === "moderasyonda") await api("POST", `/admin/loads/${L3}/review`, A, { decision: "onay" });
const O3 = (await api("POST", `/loads/${L3}/offers`, C, { vehicleId: V, price: 1000 })).body.id;
const J3 = (await api("POST", `/offers/${O3}/accept`, S)).body.job.id;
check("itirazlı olmayan işe karar 409", (await api("POST", `/admin/disputes/${J3}/resolve`, A, { outcome: "tamamlandi", note: "Deneme kararı" })).status === 409);
await api("POST", `/jobs/${J3}/cancel`, S, { reason: "Test bitti" });

cleanup();
console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
