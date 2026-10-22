// Y5 / FR-53 yönetici metrikleri ve P2 yük sahibi göstergesi (GET /loads/mine/summary) — uçtan uca test. Metrikler tüm DB üzerinden olduğu için önce/sonra farkına bakılır
// (takımlar sırayla çalışır; aynı anda başka test çalıştırmayın).
// Yalıtım: Kilis/Musabeyli → Osmaniye/Düziçi ve +90546… numaraları. Çalıştırma kimliği DB'de boş olana kadar yeniden üretilir.
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false). node test/e2e-metrics.mjs api.log
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
/** Bu haftanın pazartesisi (Türkiye günü) */
const monday = () => {
  const d = new Date(`${trDay()}T12:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400e3).toISOString().slice(0, 10);
};
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90546${run}%'`) !== "0");
const phone = (n) => `+90546${run}${String(n).padStart(3, "0")}`;

const S = await user(phone(1), ["shipper"]);
const C = await user(phone(2), ["carrier"]);
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla
const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const MUSABEYLI = district("Kilis", "Musabeyli"), DUZICI = district("Osmaniye", "Düziçi");
const V = (await api("POST", "/vehicles", C, { plate: `79 MT ${run}`, vehicleType: "kamyonet", bodyType: "kapali", capacityTon: 3 })).body.id;
const metrics = async () => (await api("GET", "/admin/metrics", A)).body;
const lastOf = (arr, key) => arr.at(-1)[key];
const summary = async () => (await api("GET", "/loads/mine/summary", S)).body;

console.log("\nYetki ve biçim");
check("yönetici olmayan 403", (await api("GET", "/admin/metrics", S)).status === 403);
const m0 = await metrics();
check("haftalık kapanan: son 8 hafta, sonuncusu bu pazartesi", m0.weeklyClosed?.length === 8 && lastOf(m0.weeklyClosed, "week") === monday(), JSON.stringify(m0.weeklyClosed?.slice(-2)));
check("günlük ilan: son 14 gün, sonuncusu bugün (TR)", m0.dailyLoads?.length === 14 && lastOf(m0.dailyLoads, "day") === trDay(), JSON.stringify(m0.dailyLoads?.slice(-2)));
check("oranlar 0–1 ya da boş", [m0.live.freshness, m0.confirmations.answerRate, m0.matches.hitRate].every((x) => x === null || (x >= 0 && x <= 1)), JSON.stringify([m0.live, m0.confirmations, m0.matches]));

console.log("\nP2 gösterge: yeni yük sahibi");
check("nakliyeci göstergeyi alamaz 403", (await api("GET", "/loads/mine/summary", C)).status === 403);
let g = await summary();
check("boş gösterge: hepsi sıfır", JSON.stringify(g) === JSON.stringify({ loads: { visible: 0, awaiting: 0, moderation: 0 }, awaitingConfirmation: [], offers: { pending: 0, loads: [] }, jobs: { active: 0, completed: 0, cancelled: 0 } }), JSON.stringify(g));

console.log("\nİlan ve tazelik");
const lr = await api("POST", "/loads", S, {
  originDistrictId: MUSABEYLI, destDistrictId: DUZICI, loadFrom: trDay(1), loadTo: trDay(2), cargoType: "genel",
  weightTon: 2, vehicleType: "kamyonet", bodyType: null, priceType: "teklif", price: null,
});
const L = lr.body.id;
if (lr.body.status === "moderasyonda") await api("POST", `/admin/loads/${L}/review`, A, { decision: "onay" });
const m1 = await metrics();
g = await summary();
check("gösterge: 1 yayında ilan", g.loads.visible === 1 && g.loads.awaiting === 0, JSON.stringify(g.loads));
check("bugünün yeni ilanı +1", lastOf(m1.dailyLoads, "loads") === lastOf(m0.dailyLoads, "loads") + 1, `${lastOf(m0.dailyLoads, "loads")} → ${lastOf(m1.dailyLoads, "loads")}`);
check("yayındaki ve taze ilan +1", m1.live.visible === m0.live.visible + 1 && m1.live.fresh === m0.live.fresh + 1, JSON.stringify([m0.live, m1.live]));

console.log("\nTeyit cevabı");
psql(`insert into load_confirmations (load_post_id, asked_at, answered_at, answer, channel) values ('${L}', now() - interval '40 minutes', now() - interval '10 minutes', 'gecerli', 'app')`);
psql(`insert into load_confirmations (load_post_id, asked_at, answer) values ('${L}', now() - interval '5 hours', 'cevapsiz')`);
const m2 = await metrics();
check("sorulan +2, cevaplanan +1, cevapsız +1", m2.confirmations.asked === m1.confirmations.asked + 2 && m2.confirmations.answered === m1.confirmations.answered + 1 && m2.confirmations.unanswered === m1.confirmations.unanswered + 1, JSON.stringify([m1.confirmations, m2.confirmations]));
check("cevap oranı = cevaplanan / (cevaplanan + cevapsız)", m2.confirmations.answerRate === Math.round((m2.confirmations.answered / (m2.confirmations.answered + m2.confirmations.unanswered)) * 1000) / 1000);
check("medyan cevap süresi dakika", typeof m2.confirmations.medianMinutes === "number" && m2.confirmations.medianMinutes >= 0);

console.log("\nEşleşme isabeti");
// Boş araç ilanı yükün tarihlerinden uzak: eşleştirme kendiliğinden eşleşme yazmasın, satırı test ekler
const K = (await api("POST", "/capacity", C, { vehicleId: V, originDistrictId: MUSABEYLI, destDistrictId: null, availableFrom: trDay(20), availableTo: trDay(21) })).body.id;
psql(`insert into matches (load_post_id, capacity_post_id, score, notified_at, outcome) values ('${L}', '${K}', 0.8, now(), 'teklif')`);
const m3 = await metrics();
psql(`update load_posts set status='teyit_bekliyor' where id='${L}'`);
g = await summary();
check("gösterge: teyit bekleyen ilan listede", g.loads.awaiting === 1 && g.loads.visible === 1 && g.awaitingConfirmation[0]?.id === L && g.awaitingConfirmation[0].origin.district === "Musabeyli", JSON.stringify(g));
await api("POST", `/loads/${L}/confirm`, S, { answer: "gecerli" });
check("eşleşme, bildirilen ve dönüşen +1", m3.matches.created === m2.matches.created + 1 && m3.matches.notified === m2.matches.notified + 1 && m3.matches.converted === m2.matches.converted + 1, JSON.stringify([m2.matches, m3.matches]));
check("isabet = dönüşen / bildirilen", m3.matches.hitRate === Math.round((m3.matches.converted / m3.matches.notified) * 1000) / 1000);

console.log("\nHaftalık kapanan yük (ana başarı ölçütü)");
const offer = (await api("POST", `/loads/${L}/offers`, C, { vehicleId: V, price: 2000 })).body;
g = await summary();
check("gösterge: bekleyen teklif ve ilanı", g.offers.pending === 1 && g.offers.loads[0]?.id === L && g.offers.loads[0].pendingOffers === 1, JSON.stringify(g.offers));
const acc = (await api("POST", `/offers/${offer.id}/accept`, S)).body;
g = await summary();
check("gösterge: kabulden sonra süren taşıma 1, yayında ilan ve teklif 0", g.jobs.active === 1 && g.loads.visible === 0 && g.offers.pending === 0, JSON.stringify(g));
const m4 = await metrics();
check("kabul edilen iş henüz sayılmaz", lastOf(m4.weeklyClosed, "closed") === lastOf(m3.weeklyClosed, "closed"));
check("kabulde ilan kapandı: yayındaki ilan -1", m4.live.visible === m3.live.visible - 1, JSON.stringify([m3.live, m4.live]));
await api("POST", `/jobs/${acc.job.id}/deliver`, C, { code: acc.deliveryCode });
await api("POST", `/jobs/${acc.job.id}/complete`, S);
const m5 = await metrics();
g = await summary();
check("gösterge: bu ay tamamlanan 1, süren 0", g.jobs.completed === 1 && g.jobs.active === 0, JSON.stringify(g.jobs));
check("tamamlanan iş bu haftaya +1", lastOf(m5.weeklyClosed, "closed") === lastOf(m4.weeklyClosed, "closed") + 1, `${lastOf(m4.weeklyClosed, "closed")} → ${lastOf(m5.weeklyClosed, "closed")}`);

psql(`update capacity_posts set status='iptal' where id='${K}'`);

console.log("\nNFR-09 API sağlığı: istekler rota kalıbıyla saatlik toplanır; 4xx ve 5xx ayrı");
const h0 = (await metrics()).api.last24h;
const fakeId = "00000000-0000-4000-8000-000000000000";
for (let i = 0; i < 25; i++) await api("GET", `/loads/${fakeId}`, C); // olmayan ilan: 404
for (let i = 0; i < 5; i++) await api("GET", "/loads?page=0", C); // geçersiz sayfa: 400
const big = await api("GET", "/loads?page=100000000000000000000", C);
check("çok büyük sayfa numarası 400 (önceden veritabanında taşıp 500 veriyordu)", big.status === 400 && big.body.errors?.[0]?.message === "Sayfa en çok 10.000 olabilir", JSON.stringify(big.body));
const m6 = await metrics();
const h1 = m6.api.last24h;
check("istek sayısı arttı (en az 31 istek)", h1.requests >= h0.requests + 31, `${h0.requests} → ${h1.requests}`);
check("4xx en az 31 arttı, 5xx artmadı", h1.status4xx >= h0.status4xx + 31 && h1.status5xx === h0.status5xx, `4xx ${h0.status4xx} → ${h1.status4xx}, 5xx ${h0.status5xx} → ${h1.status5xx}`);
// (Önceden "en yavaşlar listesinde" diye bakıyordu: tam turda ilk 5'i başka rotalar doldurunca kalıyordu)
check("rota kalıbıyla (kimlik değil) toplandı", psql(`select count(*) from api_request_stats where route like '%${fakeId}%'`) === "0" && Number(psql(`select coalesce(sum(status_4xx), 0) from api_request_stats where method='GET' and route='/loads/:id' and hour = date_trunc('hour', now())`)) >= 25);
check("oranlar ve yaklaşık p95 tutarlı", h1.errorRate !== null && h1.errorRate <= 1 && h1.clientErrorRate > 0 && (h1.p95Ms === null || [50, 100, 200, 300, 500, 1000, 3000].includes(h1.p95Ms)) && h1.maxMs >= 0, JSON.stringify(h1).slice(0, 200));
check("DB'de saat × yöntem × rota satırı (istek başına değil)", Number(psql(`select requests from api_request_stats where method='GET' and route='/loads/:id' and hour = date_trunc('hour', now())`)) >= 25);
check("bildirim okunma oranı alanları", typeof m6.notifications.created === "number" && m6.notifications.read <= m6.notifications.created && m6.notifications.windowDays === 30, JSON.stringify(m6.notifications));
for (let i = 0; i < 15; i++) await api("GET", "/health");
const h2 = (await metrics()).api.last24h;
// Arada sayılan yalnız önceki metrik isteğinin kendisi (yanıttan sonra kaydedilir); sağlık sayılsaydı fark ≥ 16
check("sağlık ucu istatistiğe katılmaz", h2.requests - h1.requests < 10, `${h1.requests} → ${h2.requests}`);
const odd = await fetch(B + "/loads", { method: "MKCALENDAR" });
const h3 = (await metrics()).api.last24h;
check("bilinmeyen HTTP yöntemi (MKCALENDAR, sütundan uzun) toplu yazımı düşürmez", odd.status === 404 && h3.requests > h2.requests && Number(psql(`select coalesce(sum(requests), 0) from api_request_stats where method='DİĞER' and hour = date_trunc('hour', now())`)) >= 1, `${odd.status} · ${h2.requests} → ${h3.requests}`);
console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
