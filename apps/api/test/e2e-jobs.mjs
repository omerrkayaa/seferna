// Teklif → kabul → iş → teslim kodu (FR-30…34, BR-31, BR-32) uçtan uca test.
// Yalıtım: "panelvan" araç tipini kendine ayırır (diğer testler kullanmaz); başta ve sonda bu tipteki ilanları kapatır.
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false). node test/e2e-jobs.mjs api.log
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
while (psql(`select count(*) from users where phone like '+90550${run}%'`) !== "0");
const phone = (n) => `+90550${run}${String(n).padStart(3, "0")}`;

const S = await user(phone(1), ["shipper"]);
const S2 = await user(phone(2), ["shipper"]);
const C1 = await user(phone(3), ["carrier"]);
const C2 = await user(phone(4), ["carrier"]);
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const MENTESE = district("Muğla", "Menteşe"), MURATPASA = district("Antalya", "Muratpaşa");

const vehicle = async (t, plate, vehicleType = "panelvan") =>
  (await api("POST", "/vehicles", t, { plate, vehicleType, bodyType: "kapali", capacityTon: 3 })).body.id;
const V1 = await vehicle(C1, `48 PA ${run}`);
const V2 = await vehicle(C2, `48 PB ${run}`);
const Vbad = await vehicle(C2, `48 PC ${run}`, "kamyonet");
async function load(t = S, from = 1, to = 2) {
  const r = await api("POST", "/loads", t, {
    originDistrictId: MENTESE, destDistrictId: MURATPASA, loadFrom: trDay(from), loadTo: trDay(to), cargoType: "genel",
    weightTon: 2, vehicleType: "panelvan", bodyType: "kapali", priceType: "teklif", price: null,
  });
  if (r.body.status === "moderasyonda") await api("POST", `/admin/loads/${r.body.id}/review`, A, { decision: "onay" });
  return r.body.id;
}
const offer = (t, loadId, vehicleId, price) => api("POST", `/loads/${loadId}/offers`, t, { vehicleId, price, note: "Hemen çıkarım" });
const loadStatus = (id) => psql(`select status from load_posts where id='${id}'`);
const offerStatus = (id) => psql(`select status from offers where id='${id}'`);

// ── Teklif ────────────────────────────────────────────────────────
console.log("\nTeklif (FR-30)");
const K1 = (await api("POST", "/capacity", C1, { vehicleId: V1, originDistrictId: MENTESE, destDistrictId: null, availableFrom: trDay(1), availableTo: trDay(3) })).body.id;
const L = await load();
check("yük sahibi teklif veremez 403", (await offer(S, L, V1, 5000)).status === 403);
// Büyük araç küçük tip isteyen ilana teklif verebilir (panelvan ilanına kamyonet); ayrı ilanda, sonra iptal
const Lsmall = await load();
let r = await offer(C2, Lsmall, Vbad, 4000);
check("büyük araçla küçük tip ilana teklif verilir", r.status === 201, JSON.stringify(r.body));
psql(`update load_posts set status='iptal' where id='${Lsmall}'`);
await api("POST", `/offers/${r.body.id}/withdraw`, C2);
// Küçük araç büyük tip isteyen ilana uymaz (kamyonet ilanına panelvan)
const Lbig = (await api("POST", "/loads", S, {
  originDistrictId: MENTESE, destDistrictId: MURATPASA, loadFrom: trDay(1), loadTo: trDay(2), cargoType: "genel",
  weightTon: 2, vehicleType: "kamyonet", bodyType: null, priceType: "teklif", price: null,
})).body;
if (Lbig.status === "moderasyonda") await api("POST", `/admin/loads/${Lbig.id}/review`, A, { decision: "onay" });
r = await offer(C1, Lbig.id, V1, 4000);
check("küçük araçla büyük tip ilana teklif 400", r.status === 400 && r.body.message === "Araç tipi ilanda istenenden küçük", JSON.stringify(r.body));
psql(`update load_posts set status='iptal' where id='${Lbig.id}'`);
check("başkasının aracıyla teklif 404", (await offer(C2, L, V1, 4000)).status === 404);
r = await offer(C1, L, V1, 5000);
const O1 = r.body.id;
check("teklif verildi", r.status === 201 && r.body.status === "beklemede" && r.body.price === 5000);
check("ikinci bekleyen teklif 409", (await offer(C1, L, V1, 4900)).status === 409);
check("yük sahibine 'yeni teklif' bildirimi", (await notes(S, "offer_new")).some((n) => n.data.offerId === O1));
let O2 = (await offer(C2, L, V2, 4500)).body.id;
r = await api("GET", `/loads/${L}/offers`, S);
check("yük sahibi teklifleri görür: ucuz önce", r.body.items?.map((o) => o.price).join() === "4500,5000", JSON.stringify(r.body).slice(0, 150));
check("teklif listesinde plaka ve tam numara yok", !JSON.stringify(r.body).includes(`48PA${run}`) && !JSON.stringify(r.body).includes(phone(3)));
check("başka yük sahibi teklifleri göremez 404", (await api("GET", `/loads/${L}/offers`, S2)).status === 404);
r = await api("GET", "/offers", C1);
check("nakliyeci tekliflerini görür", r.body.items?.[0]?.load.origin.district === "Menteşe");
check("geri çek", (await api("POST", `/offers/${O2}/withdraw`, C2)).body.status === "geri_cekildi");
check("ikinci geri çekme 409", (await api("POST", `/offers/${O2}/withdraw`, C2)).status === 409);
r = await offer(C2, L, V2, 4800);
O2 = r.body.id;
check("geri çektikten sonra yeni teklif verilebilir", r.status === 201);
const mineLoad = async () => (await api("GET", "/loads/mine", S)).body.items.find((x) => x.id === L);
check("İlanlarım: bekleyen teklif sayısı (geri çekilen sayılmaz)", (await mineLoad())?.pendingOffers === 2, JSON.stringify(await mineLoad()));
check("ilan detayı (sahibi): bekleyen teklif sayısı", (await api("GET", `/loads/${L}`, S)).body.pendingOffers === 2);
check("başkası ilan detayında teklif sayısını görmez", !("pendingOffers" in (await api("GET", `/loads/${L}`, C2)).body));
r = await api("GET", `/loads/${L}/offers`, S);
const oc = r.body.items?.find((o) => o.id === O1)?.carrier;
check("teklifte nakliyecinin puanı ve tamamlanan işi (P5)", oc?.completedJobs === 0 && oc.rating === null && oc.ratingCount === 0 && typeof oc.id === "string", JSON.stringify(oc));

// ── Kabul ─────────────────────────────────────────────────────────
console.log("\nKabul → iş (FR-31, FR-32)");
check("başka yük sahibi kabul edemez 404", (await api("POST", `/offers/${O1}/accept`, S2)).status === 404);
r = await api("POST", `/offers/${O1}/accept`, S);
const J = r.body.job?.id, CODE = r.body.deliveryCode;
check("kabul: iş oluştu + teslim kodu (yalnız bu yanıtta)", r.status === 201 && /^\d{6}$/.test(CODE) && r.body.job.status === "anlasildi", JSON.stringify(r.body).slice(0, 200));
check("kabulden sonra bekleyen teklif kalmaz", (await mineLoad())?.pendingOffers === 0);
check("teslim kodu yük sahibine SMS'le gitti", log().includes(`[SMS → ${phone(1)}] Seferna teslim kodunuz: ${CODE}`));
check("kod DB'de düz saklanmıyor", psql(`select count(*) from jobs where delivery_code_hash='${CODE}'`) === "0");
check("ilan kapandı", loadStatus(L) === "kapandi");
check("diğer teklif reddedildi", offerStatus(O2) === "ret");
check("kazanana 'kabul edildi', kaybedene 'sonuçlanmadı'", (await notes(C1, "offer_result")).some((n) => n.title.includes("kabul")) && (await notes(C2, "offer_result")).some((n) => n.title.includes("sonuçlanmadı")));
check("aracın çakışan boş araç ilanı kapandı", psql(`select status from capacity_posts where id='${K1}'`) === "kapandi");
check("aynı teklif tekrar kabul 409", (await api("POST", `/offers/${O1}/accept`, S)).status === 409);
check("reddedilen teklif kabul edilemez 409", (await api("POST", `/offers/${O2}/accept`, S)).status === 409);

console.log("\nEşzamanlı kabul");
// V1 artık 1–2. günlerde L'nin işinde: bu ilan başka günlerde (yoksa V1 teklif veremez)
const L2 = await load(S, 4, 5);
const P1 = (await offer(C1, L2, V1, 3000)).body.id, P2 = (await offer(C2, L2, V2, 3100)).body.id;
const both = await Promise.all([api("POST", `/offers/${P1}/accept`, S), api("POST", `/offers/${P2}/accept`, S)]);
check("iki teklif aynı anda kabul: biri 201, biri 409", both.map((x) => x.status).sort().join() === "201,409", both.map((x) => x.status).join());
check("ilana tek iş", psql(`select count(*) from jobs where load_post_id='${L2}'`) === "1");
const J2 = both.find((x) => x.status === 201).body.job.id;
const J2carrier = both.find((x) => x.status === 201) === both[0] ? C1 : C2;

// ── İş ────────────────────────────────────────────────────────────
console.log("\nİş detayı ve durumlar (FR-32, FR-33)");
r = await api("GET", `/jobs/${J}`, C1);
check("nakliyeci yük sahibinin tam numarasını görür", r.body.counterpart?.phone === phone(1) && r.body.role === "carrier", JSON.stringify(r.body.counterpart));
r = await api("GET", `/jobs/${J}`, S);
check("yük sahibi nakliyecinin numarasını ve plakayı görür", r.body.counterpart?.phone === phone(3) && r.body.vehicle.plate === `48PA${run}`);
check("taraf olmayan 404", (await api("GET", `/jobs/${J}`, C2)).status === 404);
check("aktif işler listesi", (await api("GET", "/jobs?scope=active", C1)).body.items.some((j) => j.id === J));
check("yük sahibi 'yüklendi' diyemez 403", (await api("POST", `/jobs/${J}/status`, S, { status: "yuklendi" })).status === 403);
check("yüklendi", (await api("POST", `/jobs/${J}/status`, C1, { status: "yuklendi" })).body.status === "yuklendi");
check("yolda", (await api("POST", `/jobs/${J}/status`, C1, { status: "yolda" })).body.status === "yolda");
check("geri gidilemez 409", (await api("POST", `/jobs/${J}/status`, C1, { status: "yuklendi" })).status === 409);
check("durum güncellemesiyle teslim olmaz 400", (await api("POST", `/jobs/${J}/status`, C1, { status: "teslim_edildi" })).status === 400);
check("yük sahibine durum bildirimi", (await notes(S, "job_update")).some((n) => n.body.includes("Yolda")));
check("aktif işteki araç silinemez 409", (await api("DELETE", `/vehicles/${V1}`, C1)).status === 409);

console.log("\nTeslim kodu (F3)");
const wrong = CODE === "000000" ? "111111" : "000000";
r = await api("POST", `/jobs/${J}/deliver`, C1, { code: wrong });
check("yanlış kod 400 + kalan hak", r.status === 400 && r.body.message.includes("kalan deneme: 4"), JSON.stringify(r.body));
check("yük sahibi teslim edemez 403", (await api("POST", `/jobs/${J}/deliver`, S, { code: CODE })).status === 403);
for (let i = 0; i < 3; i++) await api("POST", `/jobs/${J}/deliver`, C1, { code: wrong });
r = await api("POST", `/jobs/${J}/deliver`, C1, { code: wrong });
check("5. yanlış denemede kilit 429", r.status === 429);
check("kilitliyken doğru kod da 429", (await api("POST", `/jobs/${J}/deliver`, C1, { code: CODE })).status === 429);
check("yük sahibine 'yeni kod oluşturun' bildirimi", (await notes(S, "job_update")).some((n) => n.body.includes("yeni kod")));
check("nakliyeci yeni kod üretemez 403", (await api("POST", `/jobs/${J}/delivery-code`, C1)).status === 403);
r = await api("POST", `/jobs/${J}/delivery-code`, S);
const CODE2 = r.body.deliveryCode;
check("yük sahibi yeni kod üretti (SMS ile)", /^\d{6}$/.test(CODE2) && log().includes(`Seferna teslim kodunuz: ${CODE2}`));
check("eski kod artık geçersiz", CODE2 === CODE || (await api("POST", `/jobs/${J}/deliver`, C1, { code: CODE })).status === 400);
r = await api("POST", `/jobs/${J}/deliver`, C1, { code: CODE2 });
check("doğru kodla teslim edildi", r.body.status === "teslim_edildi" && r.body.autoCompleteAt, JSON.stringify(r.body).slice(0, 120));
check("teslimden sonra iptal edilemez 409", (await api("POST", `/jobs/${J}/cancel`, C1, { reason: "vazgeçtim artık" })).status === 409);
check("nakliyeci tamamlayamaz 403", (await api("POST", `/jobs/${J}/complete`, C1)).status === 403);

console.log("\nOtomatik tamamlama ve itiraz (BR-32)");
psql(`update jobs set delivered_at = now() - interval '49 hours' where id='${J}'`);
check("48 saat geçince itiraz edilemez 409", (await api("POST", `/jobs/${J}/dispute`, S, { reason: "eksik teslim edildi" })).status === 409);
r = await api("POST", "/admin/tick", A);
check("tur işi otomatik tamamladı", r.body.jobsCompleted >= 1 && psql(`select status from jobs where id='${J}'`) === "tamamlandi", JSON.stringify(r.body));
r = await api("GET", `/jobs/${J}`, S);
check("zaman çizelgesi: sistem tamamladı", r.body.events.at(-1).type === "tamamlandi" && r.body.events.at(-1).by === "system", JSON.stringify(r.body.events.map((e) => e.type)));
check("biten iş geçmiş listesinde", (await api("GET", "/jobs?scope=past", C1)).body.items.some((j) => j.id === J));
const J2code = (await api("POST", `/jobs/${J2}/delivery-code`, S)).body.deliveryCode;
await api("POST", `/jobs/${J2}/deliver`, J2carrier, { code: J2code });
r = await api("POST", `/jobs/${J2}/dispute`, S, { reason: "Kolilerden ikisi hasarlı" });
check("48 saat içinde itiraz → itirazlı", r.body.status === "itirazli");
check("itirazlı iş otomatik tamamlanmaz", (await api("POST", "/admin/tick", A)) && psql(`select status from jobs where id='${J2}'`) === "itirazli");
// Eşzamanlı kabulü hangi teklif kazandıysa V1 o işte olabilir; kontrol iki iş de sonuçlandıktan sonra
check("işleri biten araç silinebilir", (await api("DELETE", `/vehicles/${V1}`, C1)).status === 204);

console.log("\nElle tamamlama ve iptal");
const V3 = await vehicle(C1, `48 PD ${run}`);
const L3 = await load();
const J3 = (await api("POST", `/offers/${(await offer(C1, L3, V3, 2000)).body.id}/accept`, S)).body.job.id;
check("yük sahibi kodsuz elle tamamlar (BR-31)", (await api("POST", `/jobs/${J3}/complete`, S)).body.status === "tamamlandi");
const L4 = await load();
const J4 = (await api("POST", `/offers/${(await offer(C2, L4, V2, 2000)).body.id}/accept`, S)).body.job.id;
check("sebepsiz iptal 400", (await api("POST", `/jobs/${J4}/cancel`, C2, { reason: "yok" })).status === 400);
r = await api("POST", `/jobs/${J4}/cancel`, C2, { reason: "Araç arızalandı" });
check("nakliyeci iptal etti (sebep kayıtlı)", r.body.status === "iptal" && r.body.cancelReason === "Araç arızalandı");
check("yük sahibine iptal bildirimi", (await notes(S, "job_update")).some((n) => n.body.includes("Araç arızalandı")));
check("iptal edilen işe teslim 409", (await api("POST", `/jobs/${J4}/deliver`, C2, { code: "123456" })).status === 409);

console.log("\nTeslim kodu: paralel tahmin");
const V5 = await vehicle(C1, `48 PF ${run}`);
const otherCode = (c, i) => String((Number(c) + 1 + i) % 1e6).padStart(6, "0"); // i < 999999 için c'den farklı
const wrongTries = (j) => psql(`select count(*) from job_events where job_id='${j}' and type='hatali_kod'`);
const Jp = (await api("POST", `/offers/${(await offer(C1, await load(S, 3, 3), V5, 2000)).body.id}/accept`, S)).body;
let burst = await Promise.all(Array.from({ length: 50 }, (_, i) => api("POST", `/jobs/${Jp.job.id}/deliver`, C1, { code: otherCode(Jp.deliveryCode, i) })));
check("50 paralel yanlış koddan tam 5'i karşılaştırıldı (4 × 400, gerisi 429)", wrongTries(Jp.job.id) === "5" && burst.filter((x) => x.status === 400).length === 4 && burst.filter((x) => x.status === 429).length === 46, `karşılaştırılan ${wrongTries(Jp.job.id)}`);
check("hak bitince doğru kod da 429", (await api("POST", `/jobs/${Jp.job.id}/deliver`, C1, { code: Jp.deliveryCode })).status === 429);
const Jq = (await api("POST", `/offers/${(await offer(C1, await load(S, 5, 5), V5, 2000)).body.id}/accept`, S)).body;
burst = await Promise.all(Array.from({ length: 50 }, (_, i) => api("POST", `/jobs/${Jq.job.id}/deliver`, C1, { code: i === 25 ? Jq.deliveryCode : otherCode(Jq.deliveryCode, i) })));
const delivered = burst.filter((x) => x.body?.status === "teslim_edildi").length;
check("doğru kod araya karışınca da en çok 5 deneme karşılaştırılır", Number(wrongTries(Jq.job.id)) + delivered <= 5 && delivered <= 1, `yanlış ${wrongTries(Jq.job.id)}, teslim ${delivered}`);

console.log("\nYayından kalkan ilanın bekleyen teklifleri");
const L5 = await load();
const O5 = (await offer(C2, L5, V2, 1500)).body.id;
await api("POST", `/loads/${L5}/close`, S, { reason: "arac_bulundu" });
r = await api("POST", "/admin/tick", A);
check("tur bekleyen teklifi sonuçlandırdı", r.body.offersClosed >= 1 && offerStatus(O5) === "ret", JSON.stringify(r.body));
check("nakliyeciye 'ilan yayından kalktı'", (await notes(C2, "offer_result")).some((n) => n.body.includes("yayından kalktı")));

console.log("\nÇifte rezervasyon: aynı araç aynı günlerde iki işte olamaz");
const V4 = await vehicle(C1, `48 PE ${run}`);
const Lx = await load(S, 7, 8), Ly = await load(S2, 8, 9), Lz = await load(S2, 10, 11);
const Ox = (await offer(C1, Lx, V4, 2500)).body.id, Oy = (await offer(C1, Ly, V4, 2600)).body.id, Oz = (await offer(C1, Lz, V4, 2700)).body.id;
check("boş araç aynı günlere birden çok ilana teklif verebilir", [Ox, Oy, Oz].every(Boolean));
const pair = await Promise.all([api("POST", `/offers/${Ox}/accept`, S), api("POST", `/offers/${Oy}/accept`, S2)]);
check("iki yük sahibi aynı anda kabul: biri 201, biri 409", pair.map((x) => x.status).sort().join() === "201,409", pair.map((x) => `${x.status} ${x.body.message ?? ""}`).join(" | "));
check("araca çakışan günlerde tek iş", psql(`select count(*) from jobs where vehicle_id='${V4}' and status='anlasildi'`) === "1");
const won = pair[0].status === 201 ? Ox : Oy, lost = won === Ox ? Oy : Ox;
const JV4 = pair.find((x) => x.status === 201).body.job.id;
check("kaybeden teklif geri çekildi", offerStatus(lost) === "geri_cekildi", offerStatus(lost));
check("çakışmayan günlerdeki teklif bekliyor", offerStatus(Oz) === "beklemede");
check("nakliyeciye 'geri çekildi' bildirimi", (await notes(C1, "offer_result")).some((n) => n.title.includes("geri çekildi") && n.body.includes("başka bir işe")));
const Lw = await load(S2, 8, 8);
r = await offer(C1, Lw, V4, 2400);
check("dolu günlere yeni teklif 409", r.status === 409 && r.body.message.includes("başka bir işte"), JSON.stringify(r.body));
r = await api("POST", "/capacity", C1, { vehicleId: V4, originDistrictId: MENTESE, destDistrictId: null, availableFrom: trDay(8), availableTo: trDay(8) });
check("dolu günlere boş araç ilanı 409", r.status === 409 && r.body.message.includes("başka bir işte"), JSON.stringify(r.body));
r = await api("POST", "/capacity", C1, { vehicleId: V4, originDistrictId: MURATPASA, destDistrictId: null, availableFrom: trDay(12), availableTo: trDay(13) });
check("işten sonraki günlere boş araç ilanı açılır", r.status === 201, JSON.stringify(r.body));
check("boş araç ilanı dolu günlere kaydırılamaz 409", (await api("PATCH", `/capacity/${r.body.id}`, C1, { availableFrom: trDay(8) })).status === 409);
await api("POST", `/jobs/${JV4}/cancel`, won === Ox ? S : S2, { reason: "Yük ertelendi" });
check("iş iptal edilince araç o günlere yine teklif verir", (await offer(C1, Lw, V4, 2400)).status === 201);

cleanup();
console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
