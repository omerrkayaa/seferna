// NFR-05 yönetici işlem kaydı (kim, ne zaman, ne yaptı, kimi etkiledi) ve çıkar çatışması: yönetici kendi belgesine,
// ilanına, taraf olduğu şikayet ve itiraza karar veremez — uçtan uca test. Kişi kendi veri dökümünde hakkındaki
// işlemleri görür (yöneticinin kimliği olmadan); hesabı silinince kayıt kalır, gerekçe metni silinir.
// Yalıtım: Iğdır (Tuzluca → Aralık) ve +90536… numaraları. Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı.
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
async function upload(token, fields, bytes) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("file", new Blob([bytes], { type: "application/pdf" }), "belge.pdf");
  const res = await fetch(B + "/documents", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const lastCode = (phone, kind) =>
  [...log().matchAll(new RegExp(`\\[SMS → (\\+\\d+)\\] Seferna ${kind} kodunuz: (\\d{6})`, "g"))].filter((m) => m[1] === phone).at(-1)?.[2];
async function login(phone) {
  await api("POST", "/auth/otp/request", null, { phone });
  await sleep(300);
  return (await api("POST", "/auth/otp/verify", null, { phone, code: lastCode(phone, "giriş") })).body;
}
async function user(phone, roles) {
  const t = await login(phone);
  return (await api("POST", "/me/roles", t.accessToken, { roles })).body.accessToken;
}
/** Yönetici (ikinci adımla) + istenen roller; rol eklemek yönetici rolünü korur */
async function adminWith(phone, roles) {
  const t = await login(phone);
  psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone}' on conflict do nothing`);
  const a = (await adminSession(api, t.accessToken)).accessToken;
  return roles.length ? (await api("POST", "/me/roles", a, { roles })).body.accessToken : a;
}
const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90536${run}%'`) !== "0");
const phone = (n) => `+90536${run}${String(n).padStart(3, "0")}`;
const idOf = (p) => psql(`select id from users where phone='${p}'`);
/** Kayıt satırı: "işlem|yönetici|kişi|not" */
const audit = (targetId) => psql(`select string_agg(action || '|' || admin_id || '|' || coalesce(subject_user_id::text, '-') || '|' || coalesce(note, '-'), ';' order by created_at, subject_user_id) from admin_audit_log where target_id='${targetId}'`);

const A = await adminWith(phone(1), ["shipper", "carrier"]); // hem yönetici hem kullanıcı
const Bt = await adminWith(phone(2), []);
const S = await user(phone(3), ["shipper"]);
const C = await user(phone(4), ["carrier"]);
const Aid = idOf(phone(1)), Bid = idOf(phone(2)), Sid = idOf(phone(3)), Cid = idOf(phone(4));

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const TUZLUCA = district("Iğdır", "Tuzluca"), ARALIK = district("Iğdır", "Aralık");
const newLoad = async (t, from = 1) =>
  (await api("POST", "/loads", t, {
    originDistrictId: TUZLUCA, destDistrictId: ARALIK, loadFrom: trDay(from), loadTo: trDay(from + 1), cargoType: "genel",
    weightTon: 2, vehicleType: "kamyonet", bodyType: null, priceType: "teklif", price: null,
  })).body;
const SELF = "Kendi ilanınız hakkında karar veremezsiniz; başka bir yönetici incelemeli.";

console.log("\nİlan moderasyonu: kendi ilanına karar yok; karar kayda geçer");
const LA = await newLoad(A);
check("hazırlık: yöneticinin ilanı moderasyonda", LA.status === "moderasyonda", JSON.stringify(LA).slice(0, 120));
let r = await api("POST", `/admin/loads/${LA.id}/review`, A, { decision: "onay" });
check("kendi ilanını onaylayamaz (403)", r.status === 403 && r.body.message === SELF, JSON.stringify(r.body));
check("reddetmeye de izin yok, ilan değişmedi, kayıt yok", (await api("POST", `/admin/loads/${LA.id}/review`, A, { decision: "ret" })).status === 403 && psql(`select status from load_posts where id='${LA.id}'`) === "moderasyonda" && audit(LA.id) === "");
r = await api("POST", `/admin/loads/${LA.id}/review`, Bt, { decision: "onay" });
check("başka yönetici onaylar; kayıt: ilan_onay, yönetici B, kişi A", r.status === 200 && audit(LA.id) === `ilan_onay|${Bid}|${Aid}|-`, audit(LA.id));
const LS = await newLoad(S);
await api("POST", `/admin/loads/${LS.id}/review`, A, { decision: "ret" });
check("ret de kayda geçer (yönetici A, kişi S)", audit(LS.id) === `ilan_ret|${Aid}|${Sid}|-` && psql(`select status from load_posts where id='${LS.id}'`) === "iptal", audit(LS.id));

console.log("\nBelge: kendi belgesine karar yok; başkasının belgesini açmak kayda geçer");
const D = (await upload(A, { type: "src" }, Buffer.from(`%PDF-1.4\n% denetim ${run}\n`))).body;
r = await api("POST", `/admin/documents/${D.id}/review`, A, { decision: "onay" });
check("kendi belgesini onaylayamaz (403)", r.status === 403 && r.body.message === "Kendi belgeniz hakkında karar veremezsiniz; başka bir yönetici incelemeli." && psql(`select status from documents where id='${D.id}'`) === "bekliyor", JSON.stringify(r.body));
r = await api("POST", `/admin/documents/${D.id}/review`, Bt, { decision: "ret", rejectReason: "Belge okunmuyor, yeniden yükleyin" });
check("başka yönetici reddeder; kayıt gerekçeyle", r.status === 200 && audit(D.id) === `belge_ret|${Bid}|${Aid}|Belge okunmuyor, yeniden yükleyin`, audit(D.id));
await api("GET", `/documents/${D.id}/url`, A);
check("sahibi kendi belgesini açınca kayıt yok", psql(`select count(*) from admin_audit_log where target_id='${D.id}' and action='belge_goruntuleme'`) === "0");
await api("GET", `/documents/${D.id}/url`, Bt);
check("yönetici başkasının belgesini açınca kayıt: belge_goruntuleme", psql(`select count(*) from admin_audit_log where target_id='${D.id}' and action='belge_goruntuleme' and admin_id='${Bid}' and subject_user_id='${Aid}'`) === "1");

console.log("\nŞikayet: kendi açtığı ya da kendisi hakkındaki şikayete karar yok");
const TAKEN = "Taraf olduğunuz bir şikayet hakkında karar veremezsiniz; başka bir yönetici incelemeli.";
const repAboutA = (await api("POST", "/reports", C, { targetType: "load_post", targetId: LA.id, reason: "sahte" })).body;
r = await api("POST", `/admin/reports/${repAboutA.id}/resolve`, A, { decision: "haksiz" });
check("kendisi hakkındaki şikayete karar veremez (403)", r.status === 403 && r.body.message === TAKEN, JSON.stringify(r.body));
r = await api("POST", `/admin/reports/${repAboutA.id}/resolve`, Bt, { decision: "haksiz", note: "İlan sahibiyle görüşüldü, yük gerçek" });
check("başka yönetici karar verir; kayıt: kişi ilanın sahibi", r.status === 200 && audit(repAboutA.id) === `sikayet_haksiz|${Bid}|${Aid}|İlan sahibiyle görüşüldü, yük gerçek`, audit(repAboutA.id));
const LS2 = await newLoad(S, 2);
if (LS2.status === "moderasyonda") await api("POST", `/admin/loads/${LS2.id}/review`, Bt, { decision: "onay" });
const repByA = (await api("POST", "/reports", A, { targetType: "load_post", targetId: LS2.id, reason: "yuk_yok" })).body;
r = await api("POST", `/admin/reports/${repByA.id}/resolve`, A, { decision: "hakli" });
check("kendi açtığı şikayete karar veremez (403)", r.status === 403 && r.body.message === TAKEN, JSON.stringify(r.body));
r = await api("POST", `/admin/reports/${repByA.id}/resolve`, Bt, { decision: "hakli" });
check("başka yönetici haklı bulur; kayıt: kişi S", r.status === 200 && audit(repByA.id) === `sikayet_hakli|${Bid}|${Sid}|-`, audit(repByA.id));
r = await api("POST", `/admin/reports/${repByA.id}/resolve`, Bt, { decision: "haksiz" });
check("ikinci karar 409, ikinci kayıt yok", r.status === 409 && audit(repByA.id) === `sikayet_hakli|${Bid}|${Sid}|-`);

console.log("\nİtiraz: taraf olduğu taşımaya karar yok; iki tarafa da kayıt");
const V = (await api("POST", "/vehicles", A, { plate: `76 DN ${run}`, vehicleType: "kamyonet", bodyType: "kapali", capacityTon: 3 })).body.id;
const L3 = await newLoad(S, 4);
if (L3.status === "moderasyonda") await api("POST", `/admin/loads/${L3.id}/review`, Bt, { decision: "onay" });
const offer = (await api("POST", `/loads/${L3.id}/offers`, A, { vehicleId: V, price: 3000 })).body;
const acc = (await api("POST", `/offers/${offer.id}/accept`, S)).body;
await api("POST", `/jobs/${acc.job.id}/deliver`, A, { code: acc.deliveryCode });
const disp = await api("POST", `/jobs/${acc.job.id}/dispute`, S, { reason: "Yükün bir kısmı eksik geldi" });
check("hazırlık: itirazlı iş (nakliyeci yönetici A)", disp.body.status === "itirazli", JSON.stringify(disp.body));
r = await api("POST", `/admin/disputes/${acc.job.id}/resolve`, A, { outcome: "tamamlandi", note: "Kendi lehime karar" });
check("taraf olduğu itiraza karar veremez (403), iş itirazlı kalır", r.status === 403 && r.body.message === "Taraf olduğunuz bir taşımanın itirazı hakkında karar veremezsiniz; başka bir yönetici incelemeli." && psql(`select status from jobs where id='${acc.job.id}'`) === "itirazli", JSON.stringify(r.body));
r = await api("POST", `/admin/disputes/${acc.job.id}/resolve`, Bt, { outcome: "tamamlandi", note: "Teslim fotoğrafı tam" });
const pair = [Sid, Aid].sort();
check("başka yönetici karar verir; iki tarafa birer kayıt", r.status === 200 && audit(acc.job.id) === pair.map((id) => `itiraz_tamamlandi|${Bid}|${id}|Teslim fotoğrafı tam`).join(";"), audit(acc.job.id));

console.log("\nAskı ve askıyı kaldırma");
r = await api("POST", `/admin/users/${Cid}/suspend`, Bt, { reason: "Sahte ilan şikayetleri, inceleniyor" });
await api("POST", `/admin/users/${Cid}/unsuspend`, Bt);
check("iki işlem sırayla kayıtta", audit(Cid) === `askiya_alma|${Bid}|${Cid}|Sahte ilan şikayetleri, inceleniyor;askiyi_kaldirma|${Bid}|${Cid}|-`, audit(Cid));

console.log("\nYönetim paneli listesi");
r = await api("GET", "/admin/audit", Bt);
const top = r.body.items?.[0];
check("yeniden eskiye: en üstte son işlem (askıyı kaldırma), yönetici ve kişi adıyla", r.status === 200 && top?.action === "askiyi_kaldirma" && top.admin.id === Bid && top.subject?.id === Cid && r.body.items[1]?.action === "askiya_alma", JSON.stringify(r.body).slice(0, 200));
check("sıralama azalan", r.body.items.every((x, i, a) => i === 0 || a[i - 1].createdAt >= x.createdAt));
check("yönetici olmayan göremez (403)", (await api("GET", "/admin/audit", S)).status === 403);

console.log("\nVeri dökümünde hakkındaki işlemler (yöneticinin kimliği yok)");
r = await api("GET", "/me/export", S);
const acts = (r.body.adminActions ?? []).map((x) => x.action);
check("S'nin dökümünde: ilan reddi, haklı şikayet, itiraz kararı", r.status === 200 && ["ilan_ret", "sikayet_hakli", "itiraz_tamamlandi"].every((a) => acts.includes(a)), JSON.stringify(acts));
check("dökümde yönetici kimliği yok", !JSON.stringify(r.body.adminActions).includes(Aid) && !JSON.stringify(r.body.adminActions).includes(Bid) && !JSON.stringify(r.body.adminActions).includes(phone(2)));
r = await api("GET", "/me/export", A);
check("yöneticinin kendi dökümünde de hakkındaki işlemler (belge açma dahil)", (r.body.adminActions ?? []).some((x) => x.action === "belge_goruntuleme" && x.targetId === D.id));

console.log("\nHesap silinince kayıt kalır, gerekçe metni silinir");
await api("POST", "/me/deletion-code", C);
await sleep(300);
r = await api("DELETE", "/me", C, { code: lastCode(phone(4), "hesap silme") });
check("hesap silindi", r.status === 200, JSON.stringify(r.body));
check("kayıtlar duruyor, notlar boş", psql(`select count(*) || '|' || count(note) from admin_audit_log where subject_user_id='${Cid}'`) === "2|0", psql(`select count(*) || '|' || count(note) from admin_audit_log where subject_user_id='${Cid}'`));

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
