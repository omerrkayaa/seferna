// FR-05/FR-50/FR-06 + BR-10: belge yükleme, imzalı dosya bağlantısı, yönetici kararı ve doğrulama seviyesi — uçtan uca test.
// Yalıtım: Hakkari/Yüksekova → Şırnak/Cizre ve +90549… numaraları. Çalıştırma kimliği DB'de boş olana kadar yeniden üretilir.
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false). node test/e2e-documents.mjs api.log
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
/** Çok parçalı yükleme: alanlar + (varsa) dosya */
async function upload(token, fields, bytes, name = "belge.bin", mime = "application/octet-stream") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  if (bytes) fd.append("file", new Blob([bytes], { type: mime }), name);
  const res = await fetch(B + "/documents", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: fd });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
/**
 * Gövdesi parça parça giden yükleme (SRC belgesi): başı hemen gider, end() ile biter, abort() ile kopar. Yükleme sürerken
 * sunucuyu sınamak için; response gövde bitmeden de çözülebilir (sunucu erken reddederse).
 */
function slowUpload(token) {
  const boundary = `----nakliye${Math.random().toString(16).slice(2)}`;
  const enc = (t) => new TextEncoder().encode(t);
  let ctrl;
  const body = new ReadableStream({ start: (c) => { ctrl = c; } });
  ctrl.enqueue(enc(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nsrc\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="belge.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n`));
  ctrl.enqueue(new Uint8Array(64 * 1024));
  const abort = new AbortController();
  const response = fetch(B + "/documents", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
    duplex: "half",
    signal: abort.signal,
  })
    .then(async (res) => {
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, body: json };
    })
    .catch((e) => ({ status: 0, body: String(e) }));
  return {
    response,
    end: () => { ctrl.enqueue(enc(`\r\n--${boundary}--\r\n`)); ctrl.close(); },
    abort: () => abort.abort(),
  };
}
/** Süre sınırlı bekleme: söz verilen sürede çözülmezse "beklemede" */
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => "beklemede")]);
/** İmzalı yoldan dosyayı indir */
async function fetchFile(path) {
  const res = await fetch(B + path);
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
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
  return roles.length ? (await api("POST", "/me/roles", t.accessToken, { roles })).body.accessToken : t.accessToken;
}
const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90549${run}%'`) !== "0");
const phone = (n) => `+90549${run}${String(n).padStart(3, "0")}`;
const idOf = (p) => psql(`select id from users where phone='${p}'`);
const level = (id) => psql(`select verification_level from users where id='${id}'`);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`png-${run}`)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpg-${run}`)]);
const PDF = Buffer.from(`%PDF-1.4\n% deneme ${run}\n`);
const HTML = Buffer.from("<html><script>alert(1)</script></html>");

const C = await user(phone(1), ["carrier"]);
const Cid = idOf(phone(1));
const S = await user(phone(2), ["shipper"]);
const Sid = idOf(phone(2));
const O = await user(phone(3), ["carrier"]); // başka nakliyeci
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla
const vehicle = async (t, plate) => (await api("POST", "/vehicles", t, { plate, vehicleType: "kamyon", bodyType: "kapali", capacityTon: 10 })).body.id;
const V1 = await vehicle(C, `30 DA ${run}`), V2 = await vehicle(C, `30 DB ${run}`), VO = await vehicle(O, `30 DC ${run}`);

console.log("\nYükleme kuralları");
check("girişsiz 401", (await upload(null, { type: "src" }, PDF)).status === 401);
let r = await upload(C, { type: "src" });
check("dosyasız 400", r.status === 400 && r.body.message === "Dosya seçin", JSON.stringify(r.body));
r = await upload(C, { type: "src" }, HTML, "belge.pdf", "application/pdf");
check("adı .pdf, beyanı application/pdf olan HTML 415", r.status === 415 && /PDF, JPEG ya da PNG/.test(r.body.message), JSON.stringify(r.body));
r = await upload(C, { type: "src" }, Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]), "buyuk.pdf");
check("10 MB'tan büyük 413 (Türkçe)", r.status === 413 && r.body.message === "Dosya en çok 10 MB olabilir", JSON.stringify(r.body).slice(0, 200));
r = await upload(C, { type: "ruhsat" }, PNG);
check("ruhsat araçsız 400", r.status === 400 && /Aracı seçin/.test(r.body.message), JSON.stringify(r.body));
check("başkasının aracına ruhsat 404", (await upload(C, { type: "ruhsat", vehicleId: VO }, PNG)).status === 404);
check("K belgesi araca bağlanamaz 400", (await upload(C, { type: "k_belgesi", vehicleId: V1 }, PDF)).status === 400);
check("geçersiz tür 400", (await upload(C, { type: "kimlik" }, PDF)).status === 400);
r = await upload(S, { type: "ruhsat", vehicleId: V1 }, PNG);
check("yük sahibi ruhsat yükleyemez 403", r.status === 403, JSON.stringify(r.body));
check("nakliyeci vergi levhası yükleyemez 403", (await upload(C, { type: "vergi_levhasi" }, PDF)).status === 403);
r = await upload(S, { type: "vergi_levhasi" }, PDF);
check("firması olmayan vergi levhası 409", r.status === 409 && r.body.message === "Önce firma bilgilerinizi girin", JSON.stringify(r.body));

console.log("\nYükleme, yerine geçme ve imzalı bağlantı");
r = await upload(C, { type: "ruhsat", vehicleId: V1 }, PNG, "ruhsat.jpg", "image/jpeg");
const D1 = r.body.id;
check("ruhsat yüklendi 201: incelemede, tür baytlardan (png)", r.status === 201 && r.body.status === "bekliyor" && r.body.contentType === "image/png" && r.body.plate === `30DA${run}`, JSON.stringify(r.body));
r = await api("GET", `/documents/${D1}/url`, C);
const url1 = r.body.path;
check("sahibine imzalı yol (5 dk)", r.status === 200 && /^\/files\/documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png\?exp=\d+&sig=/.test(url1) && Math.abs(new Date(r.body.expiresAt) - Date.now() - 300e3) < 10e3, JSON.stringify(r.body));
let f = await fetchFile(url1);
check("dosya aynı baytlarla, nosniff, önbelleksiz, inline", f.status === 200 && f.bytes.equals(PNG) && f.headers.get("content-type") === "image/png" && f.headers.get("x-content-type-options") === "nosniff" && /no-store/.test(f.headers.get("cache-control")) && /^inline/.test(f.headers.get("content-disposition")), `${f.status} ${f.headers.get("content-type")}`);
check("görselde betik engelleyen CSP", /default-src 'none'/.test(f.headers.get("content-security-policy") ?? ""));
check("imza değişince 403", (await fetchFile(url1.replace(/sig=./, (m) => (m.endsWith("A") ? "sig=B" : "sig=A")))).status === 403);
check("süre uzatılınca 403 (imza süreyi de kapsar)", (await fetchFile(url1.replace(/exp=(\d+)/, (_, e) => `exp=${Number(e) + 3600}`))).status === 403);
check("imzasız 403", (await fetchFile(url1.split("?")[0])).status === 403);
check("yol geçişi denemesi reddedilir", [403, 404].includes((await fetchFile(`/files/documents/..%2F..%2F${Cid}/x.png?exp=9999999999&sig=x`)).status));
check("başkası bağlantı alamaz 404", (await api("GET", `/documents/${D1}/url`, O)).status === 404);
check("yönetici bağlantı alır, açma işlem kaydına geçer (NFR-05)", (await api("GET", `/documents/${D1}/url`, A)).status === 200 && psql(`select count(*) from admin_audit_log where target_id='${D1}' and action='belge_goruntuleme' and subject_user_id='${Cid}'`) === "1");

r = await upload(C, { type: "ruhsat", vehicleId: V1 }, JPG, "ruhsat2.jpg");
const D1b = r.body.id;
check("incelemedeki belge yeniden yüklenince yerine geçer", r.status === 201 && D1b !== D1 && psql(`select count(*) from documents where owner_user_id='${Cid}' and type='ruhsat' and vehicle_id='${V1}'`) === "1");
check("eski dosya silindi (imzalı bağlantı 404)", (await fetchFile(url1)).status === 404);
r = await api("GET", "/documents", C);
check("belgelerim: plaka ve durumla", r.status === 200 && r.body.items.length === 1 && r.body.items[0].id === D1b && r.body.items[0].plate === `30DA${run}` && r.body.items[0].contentType === "image/jpeg", JSON.stringify(r.body));

console.log("\nYönetici kuyruğu ve karar");
check("yönetici olmayan kuyruğu göremez 403", (await api("GET", "/admin/documents", C)).status === 403);
r = await api("GET", "/admin/documents?status=bekliyor", A);
const q1 = r.body.items?.find((d) => d.id === D1b);
check("kuyrukta: sahip numarası, araç plakası, tür", r.status === 200 && q1?.owner?.phone === phone(1) && q1?.vehicle?.plate === `30DA${run}` && q1?.type === "ruhsat" && q1?.company === null, JSON.stringify(q1));
check("ret sebepsiz 400", (await api("POST", `/admin/documents/${D1b}/review`, A, { decision: "ret" })).status === 400);
r = await api("POST", `/admin/documents/${D1b}/review`, A, { decision: "ret", rejectReason: "Fotoğraf bulanık, plaka okunmuyor" });
check("ret 200", r.status === 200 && r.body.status === "ret", JSON.stringify(r.body));
check("ikinci karar 409", (await api("POST", `/admin/documents/${D1b}/review`, A, { decision: "onay" })).status === 409);
check("olmayan belge 404", (await api("POST", `/admin/documents/00000000-0000-4000-8000-000000000000/review`, A, { decision: "onay" })).status === 404);
let notes = (await api("GET", "/notifications", C)).body.items.filter((n) => n.type === "document_review");
check("sahibine ret bildirimi sebebiyle", notes.some((n) => n.title === "Belgeniz reddedildi" && n.body.includes(`30DA${run}`) && n.body.includes("plaka okunmuyor")), JSON.stringify(notes));
check("seviye hâlâ 0", level(Cid) === "0");
r = await api("GET", "/documents", C);
check("belgelerimde ret sebebi", r.body.items[0].status === "ret" && r.body.items[0].rejectReason === "Fotoğraf bulanık, plaka okunmuyor");

const D2 = (await upload(C, { type: "ruhsat", vehicleId: V1 }, PNG)).body.id;
check("geçmiş tarihli geçerlilik sonu 400", (await api("POST", `/admin/documents/${D2}/review`, A, { decision: "onay", expiresAt: trDay(-1) })).status === 400);
r = await api("POST", `/admin/documents/${D2}/review`, A, { decision: "onay" });
check("ruhsat onaylandı → seviye 1, rozet", r.status === 200 && level(Cid) === "1" && (await api("GET", `/users/${Cid}/reputation`, S)).body.verified === true);
check("onayla eski (reddedilen) kayıt silindi", psql(`select count(*) from documents where owner_user_id='${Cid}' and type='ruhsat'`) === "1");
check("güven skoru seviyeyle yeniden hesaplandı", Number(psql(`select trust_score from users where id='${Cid}'`)) > 0.25);
const Dk = (await upload(C, { type: "k_belgesi" }, PDF)).body.id;
const Ds = (await upload(C, { type: "src" }, PDF)).body.id;
await api("POST", `/admin/documents/${Dk}/review`, A, { decision: "onay" });
check("K belgesi tek başına seviye 2 yapmaz", level(Cid) === "1");
await api("POST", `/admin/documents/${Ds}/review`, A, { decision: "onay", expiresAt: trDay(30) });
check("+ SRC → seviye 2", level(Cid) === "2");
r = await api("GET", "/admin/documents?status=onay", A);
check("onaylılar kuyruğunda, karar tarihine göre", r.body.items?.[0]?.id === Ds && !!r.body.items[0].reviewedAt, JSON.stringify(r.body.items?.slice(0, 2).map((d) => d.id)));

console.log("\nSüresi geçen belge");
psql(`update documents set expires_at = '${trDay(-1)}' where id='${Ds}'`);
r = await api("POST", "/admin/tick", A);
check("tur süresi geçen belgeyi işledi → seviye 1", r.status === 200 && r.body.documentsExpired >= 1 && level(Cid) === "1", JSON.stringify(r.body));
const expiredNote = () => psql(`select count(*) from notifications where user_id='${Cid}' and ref_key='doc-expired:${Ds}'`);
check("sahibine 'süresi doldu' bildirimi", expiredNote() === "1");
await api("POST", "/admin/tick", A);
check("ikinci turda yeniden bildirilmez", expiredNote() === "1");

console.log("\nAraç silinince araca bağlı belgeler silinir");
const Dsig = (await upload(C, { type: "sigorta", vehicleId: V1 }, JPG)).body.id;
const sigUrl = (await api("GET", `/documents/${Dsig}/url`, C)).body.path;
const ruhsatUrl = (await api("GET", `/documents/${D2}/url`, C)).body.path;
check("silmeden önce dosyalar açılıyor", (await fetchFile(sigUrl)).status === 200 && (await fetchFile(ruhsatUrl)).status === 200);
check("araç silindi", (await api("DELETE", `/vehicles/${V1}`, C)).status === 204);
check("araca bağlı ruhsat ve sigorta satırları silindi; K belgesi ve SRC kaldı", psql(`select count(*) from documents where vehicle_id='${V1}'`) === "0" && psql(`select count(*) from documents where owner_user_id='${Cid}' and vehicle_id is null`) === "2");
check("dosyaları da silindi", (await fetchFile(sigUrl)).status === 404 && (await fetchFile(ruhsatUrl)).status === 404);
check("etkin araçta onaylı ruhsat kalmadı → seviye 0", level(Cid) === "0");
const D3 = (await upload(C, { type: "ruhsat", vehicleId: V2 }, PNG)).body.id;
await api("POST", `/admin/documents/${D3}/review`, A, { decision: "onay" });
check("diğer aracın ruhsatı onaylanınca seviye 1 (K belgesi var, SRC süresi geçti)", level(Cid) === "1");

console.log("\nYük sahibi: vergi levhası");
await api("POST", "/companies", S, { title: `Yüksekova Ticaret ${run}`, taxNo: "1234567890", taxOffice: "Hakkari", address: "Merkez" });
r = await upload(S, { type: "vergi_levhasi" }, PDF, "levha.pdf");
const Dv = r.body.id;
check("vergi levhası yüklendi (pdf)", r.status === 201 && r.body.contentType === "application/pdf", JSON.stringify(r.body));
r = await api("GET", "/admin/documents", A);
check("kuyrukta firma bilgisiyle", r.body.items?.find((d) => d.id === Dv)?.company?.title === `Yüksekova Ticaret ${run}`);
const pdfFile = await fetchFile((await api("GET", `/documents/${Dv}/url`, A)).body.path);
check("PDF application/pdf, CSP yok (görüntüleyici bozulmasın)", pdfFile.status === 200 && pdfFile.headers.get("content-type") === "application/pdf" && !pdfFile.headers.get("content-security-policy") && pdfFile.bytes.equals(PDF));
await api("POST", `/admin/documents/${Dv}/review`, A, { decision: "onay" });
r = await api("GET", "/me", S);
check("onay: firma doğrulandı, seviye 1", r.body.company?.verified === true && r.body.verificationLevel === 1, JSON.stringify(r.body));
const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
r = await api("POST", "/loads", S, {
  originDistrictId: district("Hakkari", "Yüksekova"), destDistrictId: district("Şırnak", "Cizre"), loadFrom: trDay(3), loadTo: trDay(3),
  cargoType: "genel", weightTon: 5, vehicleType: "kamyon", bodyType: null, priceType: "teklif", price: null,
});
check("seviye 1 yük sahibinin ilk ilanı moderasyonsuz (BR-11)", r.status === 201 && r.body.status !== "moderasyonda", JSON.stringify(r.body).slice(0, 160));
await api("POST", `/loads/${r.body.id}/close`, S, { reason: "iptal" });
await api("PATCH", "/companies", S, { title: `Yüksekova Lojistik ${run}` });
r = await api("GET", "/me", S);
check("unvan değişince firma onayı ve seviye düşer", r.body.company?.verified === false && r.body.verificationLevel === 0, JSON.stringify(r.body));

console.log("\nVergi levhası onayı yüklemedeki firma kimliğine bağlı");
const S2 = await user(phone(6), ["shipper"]);
const S2id = idOf(phone(6));
await api("POST", "/companies", S2, { title: `İlk Unvan ${run}`, taxNo: "1111111111" });
const Dw = (await upload(S2, { type: "vergi_levhasi" }, PDF)).body.id;
await api("PATCH", "/companies", S2, { title: `Başka Firma ${run}`, taxNo: "2222222222" });
r = await api("GET", "/admin/documents", A);
const qw = r.body.items?.find((d) => d.id === Dw);
check("kuyrukta yüklemedeki kimlik ve 'değişti' işareti", qw?.uploadedAs?.title === `İlk Unvan ${run}` && qw?.uploadedAs?.taxNo === "1111111111" && qw?.company?.title === `Başka Firma ${run}` && qw?.companyChanged === true, JSON.stringify(qw));
r = await api("POST", `/admin/documents/${Dw}/review`, A, { decision: "onay" });
check("kimlik değiştiyse onay 409, belge incelemede kalır, firma doğrulanmaz", r.status === 409 && /belge yüklendikten sonra değişti/.test(r.body.message) && psql(`select status from documents where id='${Dw}'`) === "bekliyor" && psql(`select verified_at is null from companies where owner_user_id='${S2id}'`) === "t" && level(S2id) === "0", JSON.stringify(r.body));
check("reddedilebilir", (await api("POST", `/admin/documents/${Dw}/review`, A, { decision: "ret", rejectReason: "Firma bilgisi değişmiş" })).status === 200);
const Dw2 = (await upload(S2, { type: "vergi_levhasi" }, PDF)).body.id;
check("güncel kimlikle yüklenen levha onaylanır", (await api("POST", `/admin/documents/${Dw2}/review`, A, { decision: "onay" })).status === 200 && level(S2id) === "1");

console.log("\nGünlük yükleme sınırı");
const U = await user(phone(4), ["carrier"]);
const Uid = idOf(phone(4));
psql(`insert into documents (owner_user_id, type, file_key, content_type, size_bytes, status) select '${Uid}', 'src', 'documents/${Uid}/' || gen_random_uuid() || '.pdf', 'application/pdf', 10, 'ret' from generate_series(1, 20)`);
r = await upload(U, { type: "src" }, PDF);
check("24 saatte 20 yüklemeden sonra 429", r.status === 429, JSON.stringify(r.body));
psql(`delete from documents where owner_user_id='${Uid}'`);

console.log("\nHesap silinince belgeler ve dosyaları silinir");
const X = await user(phone(5), ["carrier"]);
const Xid = idOf(phone(5));
const Dx = (await upload(X, { type: "src" }, PDF)).body.id;
const xUrl = (await api("GET", `/documents/${Dx}/url`, X)).body.path;
check("silmeden önce dosya açılıyor", (await fetchFile(xUrl)).status === 200);
await api("POST", "/me/deletion-code", X);
await sleep(300);
r = await api("DELETE", "/me", X, { code: lastCode(phone(5), "hesap silme") });
check("hesap silindi", r.status === 200, JSON.stringify(r.body));
check("belge satırı ve dosyası silindi, seviye 0", psql(`select count(*) from documents where owner_user_id='${Xid}'`) === "0" && (await fetchFile(xUrl)).status === 404 && level(Xid) === "0");

console.log("\nHesap silme ile yükleme aynı anda");
let orphans = 0, errors5xx = 0;
for (let i = 0; i < 6; i++) {
  const p = phone(20 + i);
  const t = await user(p, ["carrier"]);
  const id = idOf(p);
  await api("POST", "/me/deletion-code", t);
  await sleep(300);
  const code = lastCode(p, "hesap silme");
  // Yükleme 0–15 ms gecikmeli: kimi turda silmeden önce, kimi turda silme işaretlendikten sonra gelir
  const [del, up] = await Promise.all([api("DELETE", "/me", t, { code }), sleep((i % 4) * 5).then(() => upload(t, { type: "src" }, PDF))]);
  if (del.status >= 500 || up.status >= 500) errors5xx++;
  const dir = `storage/documents/${id}`;
  const files = existsSync(dir) ? readdirSync(dir).length : 0;
  if (del.status === 200 && (psql(`select count(*) from documents where owner_user_id='${id}'`) !== "0" || files !== 0)) orphans++;
}
check("silinen hesapta belge satırı ya da dosyası kalmaz, 5xx yok", orphans === 0 && errors5xx === 0, `kalan ${orphans}, 5xx ${errors5xx}`);

console.log("\nYükleme yuvası (multer'dan önce): kullanıcı başına aynı anda bir, sunucuda en çok 8; ret gövde okunmadan");
const Y1 = await user(phone(40), ["carrier"]);
const Y2 = await user(phone(41), ["carrier"]);
let slow = slowUpload(Y1);
await sleep(400);
r = await upload(Y1, { type: "src" }, PDF);
check("yükleme sürerken aynı kullanıcının ikincisi 429", r.status === 429 && r.body.message === "Önceki yüklemeniz sürüyor; bitince tekrar deneyin.", JSON.stringify(r.body));
check("başka kullanıcı aynı anda yükleyebilir", (await upload(Y2, { type: "src" }, PDF)).status === 201);
slow.end();
r = await slow.response;
check("yavaş yükleme bitince kaydedilir", r.status === 201, JSON.stringify(r.body).slice(0, 120));
check("ardından yeni yükleme yapılabilir (yuva boşaldı)", (await upload(Y1, { type: "src" }, PDF)).status === 201);
slow = slowUpload(Y1);
await sleep(400);
slow.abort();
await slow.response;
await sleep(300);
check("yarıda kopan yükleme yuvayı bırakır", (await upload(Y1, { type: "src" }, PDF)).status === 201);

const noRole = (await login(phone(42))).accessToken;
slow = slowUpload(noRole);
r = await within(slow.response, 3000);
check("rolsüz hesap gövde bitmeden 403", r !== "beklemede" && r.status === 403 && r.body.message === "Belge nakliyeci ya da yük sahibi hesabıyla yüklenir", JSON.stringify(r));
slow.abort();
const Y3 = await user(phone(43), ["carrier"]);
psql(`insert into documents(owner_user_id, type, file_key, content_type, size_bytes, status) select id, 'src', 'documents/test/' || g || '.pdf', 'application/pdf', 1, 'ret' from users, generate_series(1, 20) g where phone='${phone(43)}'`);
slow = slowUpload(Y3);
r = await within(slow.response, 3000);
check("24 saatte 20 yüklemeden sonra gövde bitmeden 429", r !== "beklemede" && r.status === 429 && r.body.message === "Bugün çok belge yüklediniz; yarın tekrar deneyin", JSON.stringify(r));
slow.abort();
psql(`delete from documents where owner_user_id=(select id from users where phone='${phone(43)}') and file_key like 'documents/test/%'`);

const many = [];
for (let i = 0; i < 9; i++) many.push(await user(phone(50 + i), ["carrier"]));
const holds = many.slice(0, 8).map((t) => slowUpload(t));
await sleep(600);
r = await upload(many[8], { type: "src" }, PDF);
check("8 yükleme sürerken 9.su 503", r.status === 503 && r.body.message === "Şu an çok sayıda yükleme yapılıyor; biraz sonra tekrar deneyin.", JSON.stringify(r.body));
holds.forEach((h) => h.end());
const done = await Promise.all(holds.map((h) => h.response));
check("bekleyen 8 yükleme tamamlanır", done.every((x) => x.status === 201), done.map((x) => x.status).join());
check("sonra 9. kullanıcı yükler", (await upload(many[8], { type: "src" }, PDF)).status === 201);

// Temizlik: bekleyenler yönetici kuyruğunda (eskiden yeniye, 20'lik sayfa) birikip başka takımların belgesini ilk
// sayfadan iterdi
const leftovers = psql(`select d.id from documents d join users u on u.id = d.owner_user_id where d.status = 'bekliyor' and u.phone like '+90549${run}%'`).split("\n").filter(Boolean);
for (const id of leftovers) await api("POST", `/admin/documents/${id}/review`, A, { decision: "ret", rejectReason: "Test temizliği" });
check("bu koşunun bekleyen belgesi kalmadı", psql(`select count(*) from documents d join users u on u.id = d.owner_user_id where d.status = 'bekliyor' and u.phone like '+90549${run}%'`) === "0");

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
