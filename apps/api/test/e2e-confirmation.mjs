// Canlı ilan teyidi (F1) uçtan uca test: zamanlayıcı turu, BR-02…04, SMS yedeği ve tek kullanımlık link.
// Zamanın geçişi veritabanındaki zaman damgaları geri çekilerek taklit edilir; tur POST /admin/tick ile tetiklenir.
// Ön koşul: API JOBS_ENABLED=false ve SMS_PROVIDER=console ile çalışıyor, çıktısı dosyaya yazılıyor.
// Kullanım (apps/api içinden): JOBS_ENABLED=false node dist/main.js > api.log 2>&1 &   sonra   node test/e2e-confirmation.mjs api.log
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

const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
// 4 haneli kimlik eski bir çalıştırmayla çakışabiliyor (aynı numaralar/plakalar): DB'de boş olana kadar yeniden üretilir
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90554${run}%'`) !== "0");
const phone = (n) => `+90554${run}${String(n).padStart(3, "0")}`;

// ── Hazırlık ──────────────────────────────────────────────────────
const sLogin = await login(phone(1));
const S = (await api("POST", "/me/roles", sLogin.accessToken, { roles: ["shipper"] })).body.accessToken;
const aLogin = await login(phone(2));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(2)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const base = {
  originDistrictId: district("Kahramanmaraş", "Çağlayancerit"), destDistrictId: district("Afyonkarahisar", "Sultandağı"),
  loadFrom: trDay(1), loadTo: trDay(3), cargoType: "genel", weightTon: 10, vehicleType: "tir", bodyType: null,
  priceType: "teklif", price: null,
};
/** Yayında (teyitli) bir ilan: moderasyondaysa yönetici onaylar. */
async function liveLoad() {
  const r = await api("POST", "/loads", S, base);
  if (r.body.status === "moderasyonda") await api("POST", `/admin/loads/${r.body.id}/review`, A, { decision: "onay" });
  return r.body.id;
}
const tick = async () => (await api("POST", "/admin/tick", A)).body;
const load = (id) => psql(`select status||'|'||coalesce(reminder_sent_at::text,'-') from load_posts where id='${id}'`).split("|");
const questions = (id) => psql(`select count(*) from load_confirmations where load_post_id='${id}'`);
/** Son SMS'teki token (bu ilanın sahibine giden) */
const lastSms = () => [...log().matchAll(new RegExp(`\\[SMS → \\${phone(1)}\\] (Seferna: .*?/t/([A-Za-z0-9_-]+))`, "g"))].at(-1);

console.log("\nYetki");
check("yönetici olmayan turu tetikleyemez 403", (await api("POST", "/admin/tick", S)).status === 403);

console.log("\n1. Hatırlatma (BR-02)");
const L1 = await liveLoad();
await tick();
check("zamanı gelmeden sorulmaz", questions(L1) === "0");
psql(`update load_posts set next_reminder_at = now() - interval '1 minute' where id='${L1}'`);
let t = await tick();
check("zamanı gelince sorulur", t.reminded >= 1 && questions(L1) === "1" && load(L1)[1] !== "-", JSON.stringify(t));
check("push bildirimi (log) gönderildi", log().includes(`"loadId":"${L1}"`));
await tick();
check("ikinci turda tekrar sorulmaz", questions(L1) === "1");

console.log("\n2. SMS yedeği");
await tick();
check("30 dk dolmadan SMS gitmez", psql(`select sms_sent_at is null from load_confirmations where load_post_id='${L1}'`) === "t");
psql(`update load_confirmations set asked_at = now() - interval '31 minutes' where load_post_id='${L1}'`);
const smsBefore = lastSms()?.[2];
t = await tick();
const sms = lastSms();
check("31 dk sonra SMS gider", t.smsSent >= 1 && sms && sms[2] !== smsBefore, JSON.stringify(t));
check("SMS tek parça (≤160) ve Türkçe harfsiz", sms[1].length <= 160 && /^[\x20-\x7E]+$/.test(sms[1]), `${sms[1].length}: ${sms[1]}`);
check("SMS'te il/ilçe ASCII", sms[1].includes("Kahramanmaras/Caglayancerit > Afyonkarahisar/Sultandagi"), sms[1]);
const token1 = sms[2];
check("token 16 karakter", token1.length === 16);
await tick();
check("aynı soru için ikinci SMS gitmez", lastSms()[2] === token1);
check("token veritabanında düz saklanmıyor", psql(`select count(*) from load_confirmations where sms_token_hash = '${token1}'`) === "0");

console.log("\n3. SMS linkiyle teyit");
let r = await api("GET", `/public/confirm/${token1}`);
check("link ilanı gösterir (giriş yok)", r.status === 200 && r.body.origin.district === "Çağlayancerit" && r.body.status === "teyitli", JSON.stringify(r.body));
check("bozuk / bilinmeyen token 404", (await api("GET", "/public/confirm/abc")).status === 404 && (await api("GET", "/public/confirm/AAAAAAAAAAAAAAAA")).status === 404);
check("geçersiz cevap 400", (await api("POST", `/public/confirm/${token1}`, null, { answer: "belki" })).status === 400);
r = await api("POST", `/public/confirm/${token1}`, null, { answer: "gecerli" });
check("'Evet' → teyitli, hatırlatma sıfırlandı", r.body.status === "teyitli" && load(L1)[1] === "-", JSON.stringify(r.body));
check("cevap sms kanalıyla kaydedildi", psql(`select answer||'|'||channel||'|'||(answered_at is not null) from load_confirmations where load_post_id='${L1}'`) === "gecerli|sms|true");
check("link tek kullanımlık (GET ve POST 404)", (await api("GET", `/public/confirm/${token1}`)).status === 404 && (await api("POST", `/public/confirm/${token1}`, null, { answer: "iptal" })).status === 404);
check("ilan hâlâ teyitli (ikinci cevap işlenmedi)", load(L1)[0] === "teyitli");

console.log("\n4. Cevapsız kalan ilan (BR-03, BR-04)");
const L2 = await liveLoad();
psql(`update load_posts set next_reminder_at = now() - interval '1 minute' where id='${L2}'`);
await tick();
psql(`update load_posts set reminder_sent_at = now() - interval '3 hours 50 minutes' where id='${L2}'`);
await tick();
check("4 saat dolmadan teyitli kalır", load(L2)[0] === "teyitli");
psql(`update load_posts set reminder_sent_at = now() - interval '4 hours 5 minutes' where id='${L2}'`);
psql(`update load_confirmations set asked_at = now() - interval '4 hours 5 minutes' where load_post_id='${L2}'`);
await tick();
check("4 saat cevapsız → teyit bekliyor", load(L2)[0] === "teyit_bekliyor");
const token2 = lastSms()[2];
check("teyit bekliyorken link hâlâ çalışır", (await api("GET", `/public/confirm/${token2}`)).status === 200);
psql(`update load_posts set reminder_sent_at = now() - interval '16 hours 5 minutes' where id='${L2}'`);
await tick();
check("12 saat daha cevapsız → süresi doldu", load(L2)[0] === "suresi_doldu");
check("soru 'cevapsız' kapandı", psql(`select answer from load_confirmations where load_post_id='${L2}'`) === "cevapsiz");
check("süresi dolan ilanın linki 404", (await api("GET", `/public/confirm/${token2}`)).status === 404);
check("süresi dolan ilan uygulamadan da teyit edilemez 409", (await api("POST", `/loads/${L2}/confirm`, S, { answer: "gecerli" })).status === 409);

console.log("\n5. Yükleme tarihi geçen ilan");
const L3 = await liveLoad();
psql(`update load_posts set load_from = current_date - 3, load_to = current_date - 1 where id='${L3}'`);
await tick();
check("tarih geçince süresi doldu (soru sorulmadan)", load(L3)[0] === "suresi_doldu" && questions(L3) === "0");

console.log("\n6. Çakışmalar");
const L4 = await liveLoad();
psql(`update load_posts set next_reminder_at = now() - interval '1 minute' where id='${L4}'`);
await api("POST", `/loads/${L4}/confirm`, S, { answer: "gecerli" });
await tick();
check("sahibi az önce teyit ettiyse sorulmaz", questions(L4) === "0");
const L5 = await liveLoad();
psql(`update load_posts set next_reminder_at = now() - interval '1 minute' where id='${L5}'`);
await tick();
await api("POST", `/loads/${L5}/confirm`, S, { answer: "gecerli" });
psql(`update load_confirmations set asked_at = now() - interval '31 minutes' where load_post_id='${L5}'`);
t = await tick();
check("uygulamadan cevaplanan soruya SMS gitmez", psql(`select sms_sent_at is null from load_confirmations where load_post_id='${L5}'`) === "t", JSON.stringify(t));
const L6 = await liveLoad();
psql(`update load_posts set next_reminder_at = now() - interval '1 minute' where id='${L6}'`);
await tick();
psql(`update load_confirmations set asked_at = now() - interval '31 minutes' where load_post_id='${L6}'`);
await tick();
const token6 = lastSms()[2];
await api("POST", `/loads/${L6}/close`, S, { reason: "arac_bulundu" });
check("uygulamadan kapatılan ilanın linki 404", (await api("GET", `/public/confirm/${token6}`)).status === 404);
check("kapatma açık soruyu cevapladı", psql(`select answer||'|'||channel from load_confirmations where load_post_id='${L6}'`) === "arac_bulundu|app");

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
