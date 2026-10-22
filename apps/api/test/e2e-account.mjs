// FR-07 (KVKK): veri dökümü ve hesap silme (anonimleştirme); askıya almada belirtecin hemen düşmesi — uçtan uca test.
// Yalıtım: Tunceli/Ovacık → Bingöl/Karlıova ve +90541… numaraları. Çalıştırma kimliği DB'de boş olana kadar yeniden üretilir.
// Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı (JOBS_ENABLED=false). node test/e2e-account.mjs api.log
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
const lastCode = (phone, kind) =>
  [...log().matchAll(new RegExp(`\\[SMS → (\\+\\d+)\\] Seferna ${kind} kodunuz: (\\d{6})`, "g"))].filter((m) => m[1] === phone).at(-1)?.[2];
async function login(phone) {
  await api("POST", "/auth/otp/request", null, { phone });
  await sleep(300);
  return (await api("POST", "/auth/otp/verify", null, { phone, code: lastCode(phone, "giriş") })).body;
}
/** Giriş + rol; erişim (rollü) ve yenileme belirteci */
async function user(phone, roles) {
  const t = await login(phone);
  const access = roles.length ? (await api("POST", "/me/roles", t.accessToken, { roles })).body.accessToken : t.accessToken;
  return { access, refresh: t.refreshToken };
}
const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90541${run}%'`) !== "0");
const phone = (n) => `+90541${run}${String(n).padStart(3, "0")}`;
const idOf = (p) => psql(`select id from users where phone='${p}'`);

const S = await user(phone(1), ["shipper"]); // silinecek yük sahibi
const C = await user(phone(2), ["carrier"]);
const C2 = await user(phone(3), ["carrier"]); // silinecek nakliyeci
const S2 = await user(phone(4), ["shipper"]);
const aLogin = await login(phone(9));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(9)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla
const Sid = idOf(phone(1)), Cid = idOf(phone(2)), C2id = idOf(phone(3));

await api("PATCH", "/me", S.access, { name: "Ovacık Ahmet" });
await api("POST", "/companies", S.access, { title: `Ovacık Gıda ${run}`, taxNo: "1234567890", taxOffice: "Tunceli", address: "Cumhuriyet Mah. 12" });
await api("PATCH", "/me", C.access, { name: "Karlıova Nakliyat" });

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const OVACIK = district("Tunceli", "Ovacık"), KARLIOVA = district("Bingöl", "Karlıova");
const vehicle = async (t, plate) => (await api("POST", "/vehicles", t, { plate, vehicleType: "kamyon", bodyType: "kapali", capacityTon: 10 })).body.id;
const V = await vehicle(C.access, `62 AC ${run}`), V2 = await vehicle(C2.access, `62 AD ${run}`);

async function load(t, from, note = null) {
  const r = await api("POST", "/loads", t, {
    originDistrictId: OVACIK, destDistrictId: KARLIOVA, loadFrom: trDay(from), loadTo: trDay(from), cargoType: "genel",
    weightTon: 5, vehicleType: "kamyon", bodyType: null, priceType: "teklif", price: null, ...(note ? { note } : {}),
  });
  if (r.body.status === "moderasyonda") await api("POST", `/admin/loads/${r.body.id}/review`, A, { decision: "onay" });
  return r.body.id;
}
const offer = async (carrier, l, v, price = 9000, note) => (await api("POST", `/loads/${l}/offers`, carrier, { vehicleId: v, price, ...(note ? { note } : {}) })).body.id;
/** İlan → teklif → kabul → teslim → tamamlandı */
async function doneJob(shipper, carrier, v, from) {
  const l = await load(shipper, from);
  const o = await offer(carrier, l, v);
  const acc = (await api("POST", `/offers/${o}/accept`, shipper)).body;
  await api("POST", `/jobs/${acc.job.id}/deliver`, carrier, { code: acc.deliveryCode });
  await api("POST", `/jobs/${acc.job.id}/complete`, shipper);
  return acc.job.id;
}
const rate = (t, job, stars, comment) => api("POST", `/jobs/${job}/rating`, t, { stars, tags: ["zamaninda"], ...(comment ? { comment } : {}) });

// S'nin geçmişi: J0 iki taraf puanladı (görünür), J2'yi yalnız C2 puanladı (kör, gizli), J4'ü yalnız S puanladı
const J0 = await doneJob(S.access, C.access, V, 1);
await rate(S.access, J0, 5, "Ahmet Bey'den: çok iyi şoför");
await rate(C.access, J0, 4, "Ödeme zamanında");
const J2 = await doneJob(S.access, C2.access, V2, 2);
await rate(C2.access, J2, 2, "gizli kalmalı");
const J4 = await doneJob(S.access, C.access, V, 3);
await rate(S.access, J4, 5);
check("favori nakliyeci", (await api("PUT", `/me/carriers/${Cid}/favorite`, S.access)).status === 200);
// Açık ilan: C2'nin bekleyen teklifi
const L1 = await load(S.access, 5, "Arayın: 0532 000 00 00, Ahmet");
check("C2 açık ilana teklif", !!(await offer(C2.access, L1, V2, 9500, "C2 notu")));

console.log("\nVeri dökümü");
check("girişsiz 401", (await api("GET", "/me/export")).status === 401);
let r = await api("GET", "/me/export", S.access);
const ex = r.body;
check("200 ve biçim", r.status === 200 && ex.format === "nakliye-kisisel-veri/1" && !!ex.generatedAt, JSON.stringify(r.body).slice(0, 200));
check("hesap: numara, ad, rol", ex.account?.phone === phone(1) && ex.account?.name === "Ovacık Ahmet" && ex.account?.roles?.includes("shipper"));
check("firma bilgisi", ex.company?.title === `Ovacık Gıda ${run}` && ex.company?.taxNo === "1234567890");
check("ilanlar (4) ve teyit soruları dizisi", ex.loads?.length === 4 && ex.loads.every((l) => Array.isArray(l.confirmations)) && ex.loads.some((l) => l.id === L1 && l.origin.province === "Tunceli"), JSON.stringify(ex.loads?.map((l) => l.id)));
check("işler (3): rol, karşı taraf adı, zaman çizelgesi", ex.jobs?.length === 3 && ex.jobs.every((j) => j.role === "shipper" && j.events.length > 0) && ex.jobs.some((j) => j.id === J0 && j.counterpart === "Karlıova Nakliyat"));
check("gelen teklifler nakliyeci adıyla", ex.offersReceived?.length >= 4 && ex.offersReceived.some((o) => o.loadId === L1 && o.note === "C2 notu"));
check("verilen puanlar (2)", ex.ratingsGiven?.length === 2);
check("alınan puan yalnız görünür olan (J0; J2 kör)", ex.ratingsReceived?.length === 1 && ex.ratingsReceived[0].jobId === J0 && ex.ratingsReceived[0].stars === 4, JSON.stringify(ex.ratingsReceived));
check("favori nakliyeci adıyla", ex.favoriteCarriers?.length === 1 && ex.favoriteCarriers[0].carrier === "Karlıova Nakliyat");
check("oturumlar ve bildirimler", ex.sessions?.length >= 1 && ex.notifications?.length >= 1);
const exText = JSON.stringify(ex);
check("karşı tarafların numarası yok", ![phone(2), phone(3)].some((p) => exText.includes(p)));
check("özet/belirteç alanı yok", !/hash|token/i.test(Object.keys(ex).join() + exText.match(/"[a-zA-Z]+":/g).join()), "anahtar adlarında hash/token var");
const cEx = (await api("GET", "/me/export", C2.access)).body;
check("nakliyeci dökümü: araç, verilen teklif", cEx.vehicles?.some((v) => v.plate === `62AD${run}`) && cEx.offersMade?.some((o) => o.loadId === L1));

console.log("\nSilme engelleri");
// C'nin S2 ile süren işi: C silinemez
const L3 = await load(S2.access, 6);
const acc3 = (await api("POST", `/offers/${await offer(C.access, L3, V)}/accept`, S2.access)).body;
check("süren iş kuruldu", !!acc3.job?.id);
r = await api("POST", "/me/deletion-code", C.access);
check("süren taşıma varken kod gönderilmez 409", r.status === 409 && /Sonuçlanmamış 1 taşımanız var/.test(r.body.message), JSON.stringify(r.body));
check("silme de 409", (await api("DELETE", "/me", C.access, { code: "123456" })).status === 409);
r = await api("POST", "/me/deletion-code", A);
check("yönetici hesabı silinemez 409", r.status === 409 && r.body.message === "Yönetici hesabı silinemez.", JSON.stringify(r.body));
check("kodsuz 400", (await api("DELETE", "/me", S.access, {})).status === 400);
check("kısa kod 400", (await api("DELETE", "/me", S.access, { code: "12" })).status === 400);

console.log("\nYük sahibinin hesabını silme");
r = await api("POST", "/me/deletion-code", S.access);
check("silme kodu 204", r.status === 204, JSON.stringify(r.body));
await sleep(300);
const code = lastCode(phone(1), "hesap silme");
check("SMS'te silme kodu", !!code);
check("hemen yeniden kod 429", (await api("POST", "/me/deletion-code", S.access)).status === 429);
r = await api("DELETE", "/me", S.access, { code: code === "000000" ? "000001" : "000000" });
check("yanlış kod 400 (oturum hatası değil)", r.status === 400 && r.body.message === "Kod hatalı", JSON.stringify(r.body));
check("silinmeden önce hesap yerinde", psql(`select status from users where id='${Sid}'`) === "aktif");
r = await api("DELETE", "/me", S.access, { code });
check("silindi 200", r.status === 200 && r.body.deleted === true, JSON.stringify(r.body));
check("aynı kodla tekrar: erişim belirteci artık 401", (await api("DELETE", "/me", S.access, { code })).status === 401);
check("GET /me 401", (await api("GET", "/me", S.access)).status === 401);
check("oturum yenilenemez 401", (await api("POST", "/auth/refresh", null, { refreshToken: S.refresh })).status === 401);

const row = psql(`select coalesce(phone,'-')||'|'||name||'|'||status||'|'||(deleted_at is not null) from users where id='${Sid}'`);
check("numara boş, ad 'Silinmiş kullanıcı', durum silindi", row === "-|Silinmiş kullanıcı|silindi|true", row);
check("rol, firma, bildirim, favori, oturum kalmadı",
  psql(`select (select count(*) from user_roles where user_id='${Sid}')||','||(select count(*) from companies where owner_user_id='${Sid}')||','||(select count(*) from notifications where user_id='${Sid}')||','||(select count(*) from favorite_carriers where shipper_id='${Sid}')||','||(select count(*) from refresh_tokens where user_id='${Sid}')`) === "0,0,0,0,0");
check("açık ilan iptal, ilan notları silindi", psql(`select status||'|'||coalesce(note,'-') from load_posts where id='${L1}'`) === "iptal|-" && psql(`select count(*) from load_posts where shipper_id='${Sid}' and note is not null`) === "0");
check("verdiği puanın yorumu silindi, yıldız kaldı", psql(`select stars||'|'||coalesce(comment,'-') from ratings where job_id='${J0}' and rater_id='${Sid}'`) === "5|-");
check("C2'nin teklifi sonuçlanmadı (ret)", psql(`select status from offers where load_post_id='${L1}' and carrier_id='${C2id}'`) === "ret");
check("C2'ye 'sonuçlanmadı' bildirimi", (await api("GET", "/notifications", C2.access)).body.items.some((n) => n.type === "offer_result" && n.data?.loadId === L1));
r = await api("GET", `/jobs/${J0}`, C.access);
check("karşı tarafın iş geçmişi: 'Silinmiş kullanıcı', numara yok", r.status === 200 && r.body.counterpart?.displayName === "Silinmiş kullanıcı" && r.body.counterpart?.phone === null, JSON.stringify(r.body.counterpart));
check("silinen hesabın profili 404", (await api("GET", `/users/${Sid}/reputation`, C.access)).status === 404);
check("silinen hesaba yeni bildirim yazılmaz (C, J4'ü puanlar)", (await rate(C.access, J4, 3)).status === 201 && psql(`select count(*) from notifications where user_id='${Sid}'`) === "0");
r = await api("GET", `/users/${Cid}/reputation`, C2.access);
// J0 zaten görünürdü; J4 iki taraf puanlayınca açıldı: silinen hesabın verdiği iki puan da sayılır
check("karşı tarafın itibarı korunur (S'nin 2 puanı)", r.body.rating?.count === 2, JSON.stringify(r.body.rating));

check("numara yok, anahtarlı özeti saklandı", psql(`select (phone is null)||'|'||(length(phone_hmac) = 64) from users where id='${Sid}'`) === "true|true");
const early = await login(phone(1));
const opensAt = psql(`select to_char((deleted_at + interval '7 days') at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI') from users where id='${Sid}'`);
check("silmeden sonraki 7 gün giriş kapalı: mesajda açılış anı", !early.accessToken && typeof early.message === "string" && early.message.includes(`${opensAt} itibarıyla yeniden giriş`), JSON.stringify(early));
check("bekleme sırasında yeni hesap da açılmadı", psql(`select count(*) from users where phone='${phone(1)}'`) === "0");
psql(`update users set deleted_at = deleted_at - interval '8 days' where id='${Sid}'`);
const again = await login(phone(1));
check("7 gün geçince, 60 gün dolmadan: eski hesap geri açıldı", again.isNew === false && again.reopened === "silme" && idOf(phone(1)) === Sid, JSON.stringify({ isNew: again.isNew, reopened: again.reopened }));
const back = (await api("GET", "/me/export", again.accessToken)).body;
check("geçmiş geri geldi (4 ilan, 3 iş, 2 görünür puan); ad, firma, rol boş", back.loads?.length === 4 && back.jobs?.length === 3 && back.ratingsReceived?.length === 2 && back.account?.name === null && back.company === null && back.account?.roles?.length === 0, JSON.stringify({ a: back.account, l: back.loads?.length, j: back.jobs?.length, r: back.ratingsReceived?.length }));
check("durum aktif, özet silindi", psql(`select status||'|'||coalesce(phone_hmac,'-') from users where id='${Sid}'`) === "aktif|-");
r = await api("GET", `/users/${Sid}/reputation`, C.access);
check("profil yeniden görünür, puanlar duruyor", r.status === 200 && r.body.rating?.count === 2, JSON.stringify(r.body));

console.log("\nNakliyecinin hesabını silme");
// S2 ile tamamlanmış iş ve favori: silinince S2'nin listesinde kalır, favorisi silinir
const J6 = await doneJob(S2.access, C2.access, V2, 11);
check("S2 C2'yi favoriye ekler", !!J6 && (await api("PUT", `/me/carriers/${C2id}/favorite`, S2.access)).status === 200);
const L5 = await load(S2.access, 7);
check("C2 başka ilana teklif", !!(await offer(C2.access, L5, V2, 8000, "Beni arayın 0555 111 22 33")));
const cap = await api("POST", "/capacity", C2.access, { vehicleId: V2, originDistrictId: KARLIOVA, destDistrictId: null, availableFrom: trDay(8), availableTo: trDay(9) });
check("C2 boş araç ilanı", cap.status === 201, JSON.stringify(cap.body));
const al = await api("POST", "/alerts", C2.access, { originDistrictId: KARLIOVA, destDistrictId: null });
check("C2 rota alarmı", al.status === 201, JSON.stringify(al.body));
await api("POST", "/me/deletion-code", C2.access);
await sleep(300);
r = await api("DELETE", "/me", C2.access, { code: lastCode(phone(3), "hesap silme") });
check("nakliyeci silindi", r.status === 200, JSON.stringify(r.body));
check("araç silindi, plaka silindi", psql(`select status||'|'||plate from vehicles where id='${V2}'`) === "silindi|—");
check("boş araç ilanı iptal", psql(`select status from capacity_posts where id='${cap.body.id}'`) === "iptal");
check("rota alarmı silindi", psql(`select count(*) from route_alerts where user_id='${C2id}'`) === "0");
check("teklif geri çekildi, notu silindi", psql(`select status||'|'||coalesce(note,'-') from offers where load_post_id='${L5}' and carrier_id='${C2id}'`) === "geri_cekildi|-");
r = await api("GET", `/loads/${L5}/offers`, S2.access);
const o5 = r.body.items?.find((o) => o.status === "geri_cekildi");
check("yük sahibinin teklif listesinde 'Silinmiş kullanıcı', numara '—'", o5?.carrier?.displayName === "Silinmiş kullanıcı" && o5?.carrier?.phoneMasked === "—", JSON.stringify(o5?.carrier));
check("C2'nin verdiği kör puan kaldı (karşı tarafın puanı)", psql(`select count(*) from ratings where rater_id='${C2id}'`) === "1");
r = await api("GET", "/me/carriers", S2.access);
const c2row = r.body.items?.find((c) => c.id === C2id);
check("Nakliyecilerim: silinmiş nakliyeci adıyla, numarasız, favori değil", c2row?.displayName === "Silinmiş kullanıcı" && c2row?.phone === null && c2row?.favorite === false, JSON.stringify(c2row));
r = await api("PUT", `/me/carriers/${C2id}/favorite`, S2.access);
check("silinmiş nakliyeci favori olamaz 404", r.status === 404 && r.body.message === "Nakliyecinin hesabı silinmiş", JSON.stringify(r.body));

console.log("\nYarıda kalan silme (zamanlayıcı tamamlar)");
const X = await user(phone(7), ["shipper"]);
const Xid = idOf(phone(7));
const LX = await load(X.access, 10);
// Silme işaretlendi ama anonimleştirme yapılmadı (çökme): 10 dk önce
psql(`update users set status='silindi', deleted_at=now() - interval '10 minutes' where id='${Xid}'`);
const Y = await user(phone(8), ["shipper"]);
const Yid = idOf(phone(8));
psql(`update users set status='silindi', deleted_at=now() where id='${Yid}'`);
await api("POST", "/auth/otp/request", null, { phone: phone(8) });
await sleep(300);
r = await api("POST", "/auth/otp/verify", null, { phone: phone(8), code: lastCode(phone(8), "giriş") });
check("silme sürerken aynı numarayla giriş 403", r.status === 403 && /Hesap silme işlemi sürüyor/.test(r.body.message), JSON.stringify(r.body));
r = await api("POST", "/admin/tick", A);
check("tur yarım silmeyi tamamladı", r.status === 200 && r.body.deletionsFinished >= 1, JSON.stringify(r.body));
check("X anonim, ilanı iptal", psql(`select coalesce(phone,'-')||'|'||name from users where id='${Xid}'`) === "-|Silinmiş kullanıcı" && psql(`select status from load_posts where id='${LX}'`) === "iptal");
check("5 dakikadan yeni olan (süren istek) beklenir", psql(`select phone is not null from users where id='${Yid}'`) === "t");
// Temizlik: Y'yi de tamamla (sonraki takımları etkilemesin)
psql(`update users set deleted_at=now() - interval '10 minutes' where id='${Yid}'`);
await api("POST", "/admin/tick", A);
check("Y de tamamlandı", psql(`select phone is null from users where id='${Yid}'`) === "t");

console.log("\nYönetici: silinmiş hesap askıya alınamaz");
r = await api("POST", `/admin/users/${C2id}/suspend`, A, { reason: "silinmiş hesabı deniyorum" });
check("409 'Hesap silinmiş'", r.status === 409 && r.body.message === "Hesap silinmiş", JSON.stringify(r.body));

console.log("\n60 gün sonra: özet silinir, yeni boş hesap");
psql(`update users set deleted_at = now() - interval '61 days' where id='${C2id}'`);
r = await api("POST", "/admin/tick", A);
check("tur süresi dolan özeti sildi", r.status === 200 && r.body.deletedLinksExpired >= 1 && psql(`select phone_hmac is null from users where id='${C2id}'`) === "t", JSON.stringify(r.body));
const fresh = await login(phone(3));
const freshId = idOf(phone(3));
check("aynı numarayla yeni, boş hesap; eski kayıt silinmiş kalır", fresh.isNew === true && !!freshId && freshId !== C2id && psql(`select status from users where id='${C2id}'`) === "silindi");
const freshEx = (await api("GET", "/me/export", fresh.accessToken)).body;
check("yeni hesabın dökümü boş", freshEx.vehicles?.length === 0 && freshEx.jobs?.length === 0 && freshEx.offersMade?.length === 0);

console.log("\nOTP: paralel tahmin, tek kullanım, amaç ayrımı");
const verify = (p, c) => api("POST", "/auth/otp/verify", null, { phone: p, code: c });
const otpFor = async (p) => {
  await api("POST", "/auth/otp/request", null, { phone: p });
  await sleep(300);
  return lastCode(p, "giriş");
};
const other = (c, i) => String((Number(c) + 1 + i) % 1e6).padStart(6, "0"); // i < 999999 için c'den farklı
let good = await otpFor(phone(10));
let burst = await Promise.all(Array.from({ length: 50 }, (_, i) => verify(phone(10), other(good, i))));
let judged = burst.filter((x) => x.body?.message === "Kod hatalı").length;
check("50 paralel yanlış koddan tam 5'i karşılaştırıldı, hepsi 401", judged === 5 && burst.every((x) => x.status === 401), `karşılaştırılan ${judged}`);
check("deneme sayacı 5", psql(`select attempts from otp_codes where phone='${phone(10)}' and purpose='giris'`) === "5");
r = await verify(phone(10), good);
check("hak bitince doğru kod da geçmez", r.status === 401 && /süresi doldu/.test(r.body.message), JSON.stringify(r.body));
good = await otpFor(phone(11));
burst = await Promise.all(Array.from({ length: 50 }, (_, i) => verify(phone(11), i === 25 ? good : other(good, i))));
judged = burst.filter((x) => x.body?.message === "Kod hatalı" || x.body?.accessToken).length;
check("doğru kod araya karışınca da en çok 5 deneme karşılaştırılır", judged <= 5 && burst.filter((x) => x.body?.accessToken).length <= 1, `karşılaştırılan ${judged}`);
good = await otpFor(phone(12));
burst = await Promise.all([verify(phone(12), good), verify(phone(12), good)]);
check("aynı kodla iki paralel girişten yalnız biri oturum alır", burst.filter((x) => x.body?.accessToken).length === 1, JSON.stringify(burst.map((x) => x.status)));

const D = await user(phone(13), ["shipper"]);
const Did = idOf(phone(13));
check("silme kodu istendi", (await api("POST", "/me/deletion-code", D.access)).status === 204);
check("ardından giriş kodu istenebilir (ayrı kod, 429 değil)", (await api("POST", "/auth/otp/request", null, { phone: phone(13) })).status === 204);
await sleep(300);
const dCode = lastCode(phone(13), "hesap silme"), gCode = lastCode(phone(13), "giriş");
check("iki ayrı kod", !!dCode && !!gCode && dCode !== gCode && psql(`select count(*) from otp_codes where phone='${phone(13)}'`) === "2");
r = await api("DELETE", "/me", D.access, { code: gCode });
check("giriş kodu silmede geçmez 400", r.status === 400 && r.body.message === "Kod hatalı", JSON.stringify(r.body));
r = await verify(phone(13), dCode);
check("silme kodu girişte geçmez 401", r.status === 401 && r.body.message === "Kod hatalı", JSON.stringify(r.body));
r = await api("DELETE", "/me", D.access, { code: dCode });
check("giriş kodu istemek silme kodunu bozmadı: silindi", r.status === 200 && r.body.deleted === true, JSON.stringify(r.body));
check("silinen numaranın iki kodu da kalmadı", psql(`select count(*) from otp_codes where phone='${phone(13)}'`) === "0" && psql(`select phone is null from users where id='${Did}'`) === "t");
// Süre dolmuş ama zamanlayıcı özeti henüz silmemiş: giriş yine yeni hesap açar
psql(`update users set deleted_at = now() - interval '61 days' where id='${Did}'`);
const D2 = await login(phone(13));
const D2id = idOf(phone(13));
check("60 gün dolunca (tur çalışmadan da) yeni, boş hesap", D2.isNew === true && !!D2id && D2id !== Did && psql(`select phone_hmac is not null from users where id='${Did}'`) === "t");
await api("POST", "/me/deletion-code", D2.accessToken);
await sleep(300);
r = await api("DELETE", "/me", D2.accessToken, { code: lastCode(phone(13), "hesap silme") });
check("yeni hesap silinince özet ona geçer, eski bağ düşer", r.status === 200 && psql(`select (select phone_hmac is null from users where id='${Did}')||'|'||(select phone_hmac is not null from users where id='${D2id}')`) === "true|true", JSON.stringify(r.body));

console.log("\nAçık şikayet: nitelikli şikayetçi, en çok 14 gün erteleme");
// Yanlış kodla silme denemesi: 409 = ertelendi, 400 = engel yok (yalnız kod yanlış). Kod istemez, 60 sn sınırına takılmaz.
const probe = async (t) => (await api("DELETE", "/me", t, { code: "000000" })).status;
const holdUntil = (id) => psql(`select coalesce(to_char((deletion_requested_at + interval '14 days') at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI'), '-') from users where id='${id}'`);
const T = await user(phone(14), ["shipper"]);
const Tid = idOf(phone(14));
const LT = await load(T.access, 12);
const Rp = await user(phone(15), ["carrier"]); // ilan şikayetçisi; şikayet açıkken kendi hesabını siler
const U = await user(phone(16), ["shipper"]); // kullanıcı şikayetinin hedefi
const Uid = idOf(phone(16));
const LU = await load(U.access, 13);
r = await api("POST", "/reports", Rp.access, { targetType: "load_post", targetId: LT, reason: "sahte", note: "Rp'nin notu: 0532 999 88 77" });
const repLoad = r.body.id;
check("ilana şikayet", r.status === 201 && !!repLoad, JSON.stringify(r.body));
check("ilanı aramamış şikayetçi silmeyi ertelemez", (await probe(T.access)) === 400 && holdUntil(Tid) === "-");
await api("POST", `/loads/${LT}/call`, Rp.access);
r = await api("POST", "/me/deletion-code", T.access);
const until = holdUntil(Tid);
check("ilanı aramış şikayetçi: kod gönderilmez 409, mesajda erteleme bitişi (ilk istek + 14 gün)", r.status === 409 && /sonuçlanmamış bir inceleme/.test(r.body.message) && until !== "-" && r.body.message.includes(`en geç ${until} itibarıyla`), `${until} | ${JSON.stringify(r.body)}`);
check("sonraki deneme ertelemeyi uzatmaz", (await probe(T.access)) === 409 && holdUntil(Tid) === until);
psql(`update users set deletion_requested_at = now() - interval '15 days' where id='${Tid}'`);
check("14 gün dolunca şikayet açık olsa da kod gönderilir", (await api("POST", "/me/deletion-code", T.access)).status === 204);
await sleep(300);
r = await api("DELETE", "/me", T.access, { code: lastCode(phone(14), "hesap silme") });
check("T silindi; şikayet açık, notu karar için kaldı", r.status === 200 && psql(`select status||'|'||(note is not null) from reports where id='${repLoad}'`) === "acik|true", JSON.stringify(r.body));

r = await api("POST", "/reports", C.access, { targetType: "user", targetId: Uid, reason: "sahte", note: "C'nin notu" });
const repUser = r.body.id;
check("kullanıcıya şikayet", r.status === 201 && !!repUser, JSON.stringify(r.body));
check("temassız şikayetçi (ilanını aramamış, taşıma yok) ertelemez", (await probe(U.access)) === 400);
await api("POST", `/loads/${LU}/call`, C.access);
check("ilanını aramış şikayetçi: hakkındaki şikayet erteler 409", (await probe(U.access)) === 409 && holdUntil(Uid) !== "-");
psql(`update users set deletion_requested_at = now() - interval '31 days' where id='${Uid}'`);
check("30 günden eski istek yeni başvuru: erteleme yeniden başlar", (await probe(U.access)) === 409 && psql(`select deletion_requested_at > now() - interval '1 minute' from users where id='${Uid}'`) === "t");
await api("POST", `/admin/reports/${repUser}/resolve`, A, { decision: "haksiz" });
check("şikayet sonuçlanınca erteleme kalkar", (await probe(U.access)) === 400);
check("şikayetçisi silinmeyen şikayetin notu kalır", psql(`select coalesce(note,'-')||'|'||status from reports where id='${repUser}'`) === "C'nin notu|haksiz");

check("şikayetçi olmak engel değil (Rp kod alır)", (await api("POST", "/me/deletion-code", Rp.access)).status === 204);
await sleep(300);
r = await api("DELETE", "/me", Rp.access, { code: lastCode(phone(15), "hesap silme") });
check("şikayetçi hesabını sildi", r.status === 200, JSON.stringify(r.body));
check("açık şikayetin notu karar için kaldı", psql(`select note is not null from reports where id='${repLoad}'`) === "t");
r = await api("POST", `/admin/reports/${repLoad}/resolve`, A, { decision: "haksiz", note: "İlan gerçek" });
check("şikayet sonuçlandı", r.status === 200, JSON.stringify(r.body));
check("şikayetçi silinmiş: not silindi, karar metni kaldı", psql(`select coalesce(note,'-')||'|'||resolution from reports where id='${repLoad}'`) === "-|İlan gerçek");

console.log("\nİptal ve itiraz sebebi");
const W = await user(phone(17), ["shipper"]);
const Wid = idOf(phone(17));
const K = await user(phone(18), ["carrier"]);
const VK = await vehicle(K.access, `62 AE ${run}`);
async function acceptedJob(from) {
  const l = await load(W.access, from);
  return (await api("POST", `/offers/${await offer(K.access, l, VK)}/accept`, W.access)).body;
}
const JW1 = (await acceptedJob(14)).job.id;
check("W iptal eder", (await api("POST", `/jobs/${JW1}/cancel`, W.access, { reason: "W'nin sebebi: Ahmet 0532 000 11 22" })).status === 200);
const JW2 = (await acceptedJob(15)).job.id;
check("K iptal eder", (await api("POST", `/jobs/${JW2}/cancel`, K.access, { reason: "K'nin sebebi: araç arızalandı" })).status === 200);
const acc3w = await acceptedJob(16);
const JW3 = acc3w.job.id;
await api("POST", `/jobs/${JW3}/deliver`, K.access, { code: acc3w.deliveryCode });
check("W itiraz eder", (await api("POST", `/jobs/${JW3}/dispute`, W.access, { reason: "W'nin itirazı: yük eksik" })).status === 200);
r = await api("POST", `/admin/disputes/${JW3}/resolve`, A, { outcome: "iptal", note: "Yöneticinin gerekçesi" });
check("yönetici iptal kararı", r.status === 200, JSON.stringify(r.body));
await api("POST", "/me/deletion-code", W.access);
await sleep(300);
check("W silindi", (await api("DELETE", "/me", W.access, { code: lastCode(phone(17), "hesap silme") })).status === 200);
const reasons = (j) => psql(`select coalesce(cancel_reason,'-') from jobs where id='${j}'`);
check("W'nin iptal sebebi silindi", reasons(JW1) === "-", reasons(JW1));
check("K'nin iptal sebebi kaldı", reasons(JW2) === "K'nin sebebi: araç arızalandı", reasons(JW2));
check("yönetici kararı metni kaldı (cancelled_by K)", reasons(JW3) === "Yönetici kararı: Yöneticinin gerekçesi", reasons(JW3));
check("W'nin olaylarında sebep kalmadı", psql(`select count(*) from job_events where actor_id='${Wid}' and meta ? 'reason'`) === "0" && psql(`select count(*) from job_events where actor_id='${Wid}' and type in ('iptal','itirazli')`) === "2");
check("K'nin olayındaki sebep ve yöneticinin notu kaldı",
  psql(`select meta->>'reason' from job_events where job_id='${JW2}' and type='iptal'`) === "K'nin sebebi: araç arızalandı" &&
  psql(`select meta->>'note' from job_events where job_id='${JW3}' and type='iptal'`) === "Yöneticinin gerekçesi");

console.log("\nAnonimleştirme yarıda kalırsa");
const F = await user(phone(19), ["shipper"]);
const Fid = idOf(phone(19));
const LF = await load(F.access, 17);
const G = await user(phone(20), ["shipper"]);
const Gid = idOf(phone(20));
// Geçici tetikleyici: F'nin ilanı kapatılamasın (ör. iyimser kilit çakışması yerine)
const trig = `e2e_account_fail_${run}`;
psql(`create function ${trig}() returns trigger language plpgsql as $$ begin raise exception 'e2e: ilan kapatılamadı'; end $$`);
psql(`create trigger ${trig} before update on load_posts for each row when (old.id = '${LF}' and new.status is distinct from old.status) execute function ${trig}()`);
try {
  await api("POST", "/me/deletion-code", F.access);
  await sleep(300);
  r = await api("DELETE", "/me", F.access, { code: lastCode(phone(19), "hesap silme") });
  check("anonimleştirme hata verse de 200 { deleted: true }", r.status === 200 && r.body.deleted === true, JSON.stringify(r.body));
  check("hesap silindi işaretli, numara henüz duruyor, ilan açık", psql(`select status||'|'||(phone is not null) from users where id='${Fid}'`) === "silindi|true" && psql(`select status from load_posts where id='${LF}'`) !== "iptal");
  check("erişim belirteci kapandı", (await api("GET", "/me", F.access)).status === 401);
  check("hata loglandı", /Hesap .* anonimleştirmesi yarıda kaldı/.test(log()));
  psql(`update users set deleted_at=now() - interval '10 minutes' where id='${Fid}'`);
  psql(`update users set status='silindi', deleted_at=now() - interval '10 minutes' where id='${Gid}'`);
  r = await api("POST", "/admin/tick", A);
  check("tur: hatalı hesap diğerini bekletmedi (G tamamlandı)", r.status === 200 && psql(`select phone is null from users where id='${Gid}'`) === "t", JSON.stringify(r.body));
  check("F hâlâ yarım", psql(`select phone is not null from users where id='${Fid}'`) === "t");
} finally {
  psql(`drop trigger if exists ${trig} on load_posts`);
  psql(`drop function if exists ${trig}()`);
}
r = await api("POST", "/admin/tick", A);
check("engel kalkınca sonraki tur F'yi tamamladı", psql(`select coalesce(phone,'-')||'|'||name from users where id='${Fid}'`) === "-|Silinmiş kullanıcı" && psql(`select status from load_posts where id='${LF}'`) === "iptal", JSON.stringify(r.body));

console.log("\nHesap dondurma (FR-08)");
const freeze = (t) => api("POST", "/me/freeze", t);
r = await freeze(C.access);
check("süren taşıması olan dondurulamaz 409", r.status === 409 && r.body.message === "Sonuçlanmamış 1 taşımanız var. Hesabınızı dondurmadan önce tamamlanmalı ya da iptal edilmeli.", JSON.stringify(r.body));
r = await freeze(A);
check("yönetici hesabı dondurulamaz 409", r.status === 409 && r.body.message === "Yönetici hesabı dondurulamaz.", JSON.stringify(r.body));
check("girişsiz 401", (await freeze(null)).status === 401);

const Z = await user(phone(40), ["shipper"]);
const Zid = idOf(phone(40));
await api("PATCH", "/me", Z.access, { name: "Dondurulan Zeki" });
const LZ = await load(Z.access, 18);
const Q = await user(phone(41), ["carrier"]);
const Qid = idOf(phone(41));
const VQ = await vehicle(Q.access, `62 AF ${run}`);
const JQ = await doneJob(S2.access, Q.access, VQ, 19); // S2'nin "Nakliyecilerim" listesinde Q
const OQ = await offer(Q.access, LZ, VQ, 7000);
check("Q, Z'nin ilanına teklif verdi", !!OQ);

r = await freeze(Z.access);
check("Z dondurdu 200", r.status === 200 && r.body.frozen === true, JSON.stringify(r.body));
check("durum donduruldu; ad ve iş geçmişi duruyor", psql(`select status||'|'||name from users where id='${Zid}'`) === "donduruldu|Dondurulan Zeki");
check("açık ilanı kapandı (iptal)", psql(`select status from load_posts where id='${LZ}'`) === "iptal");
check("Q'nun teklifi sonuçlanmadı, Q'ya bildirim", psql(`select status from offers where id='${OQ}'`) === "ret" && (await api("GET", "/notifications", Q.access)).body.items.some((n) => n.type === "offer_result" && n.data?.loadId === LZ));
r = await api("GET", "/me", Z.access);
check("erişim belirteci hemen kapandı 401", r.status === 401 && /donduruldu/.test(r.body.message), JSON.stringify(r.body));
check("oturum yenilenemez 401", (await api("POST", "/auth/refresh", null, { refreshToken: Z.refresh })).status === 401);
r = await api("POST", "/me/freeze", Z.access);
check("dondurulmuş hesap yeniden dondurulamaz (401)", r.status === 401);

// Rota alarmı: dondurulan nakliyeciye bildirim gitmez; aynı alarmı kuran aktif nakliyeci karşılaştırma
const Q2 = await user(phone(42), ["carrier"]);
const Q2id = idOf(phone(42));
const Q3 = await user(phone(43), ["carrier"]);
const Q3id = idOf(phone(43));
for (const t of [Q2.access, Q3.access]) await api("POST", "/alerts", t, { originDistrictId: OVACIK, destDistrictId: KARLIOVA });
check("Q2 dondurdu", (await freeze(Q2.access)).status === 200);
const LA = await load(S2.access, 20);
const alertNote = (id) => psql(`select count(*) from notifications where user_id='${id}' and type='route_alert' and data->>'loadId'='${LA}'`);
for (let i = 0; i < 40 && alertNote(Q3id) === "0"; i++) await sleep(150);
check("aktif nakliyeciye rota alarmı bildirimi geldi (karşılaştırma)", alertNote(Q3id) === "1");
check("dondurulan nakliyeciye gelmedi", alertNote(Q2id) === "0");

r = await freeze(Q.access);
check("Q (iş geçmişi var, süren işi yok) dondurdu", r.status === 200, JSON.stringify(r.body));
r = await api("GET", "/me/carriers", S2.access);
const qRow = r.body.items?.find((c) => c.id === Qid);
check("Nakliyecilerim: dondurulmuş işaretli, numara ve favori duruyor", qRow?.frozen === true && qRow?.phone === phone(41) && !!JQ, JSON.stringify(qRow));
check("dondurulmuş nakliyeci favoriye eklenebilir (bildirim gitmez)", (await api("PUT", `/me/carriers/${Qid}/favorite`, S2.access)).status === 200);

const zBack = await login(phone(40));
check("SMS koduyla giriş hesabı açtı", !!zBack.accessToken && zBack.reopened === "dondurma" && zBack.isNew === false && psql(`select status from users where id='${Zid}'`) === "aktif", JSON.stringify({ reopened: zBack.reopened, isNew: zBack.isNew }));
check("kapanan ilan kapalı kaldı, ad duruyor", psql(`select status from load_posts where id='${LZ}'`) === "iptal" && (await api("GET", "/me", zBack.accessToken)).body.name === "Dondurulan Zeki");
const zAgain = await api("POST", "/auth/refresh", null, { refreshToken: zBack.refreshToken });
check("açılan hesabın oturumu yenilenir", zAgain.status === 201 && !!zAgain.body.accessToken);

r = await api("POST", `/admin/users/${Q2id}/suspend`, A, { reason: "dondurulmuşken askı denemesi" });
check("dondurulmuş hesap askıya alınabilir (dondurma askıdan kaçış olmasın)", r.status === 200 && psql(`select status from users where id='${Q2id}'`) === "askida", JSON.stringify(r.body));
r = await login(phone(42));
check("askıdaki (önce dondurulmuş) hesap girişle açılmaz 403", !r.accessToken && r.message === "Hesabınız askıya alındı.", JSON.stringify(r));
check("askı kalkınca aktif", (await api("POST", `/admin/users/${Q2id}/unsuspend`, A)).status === 200 && psql(`select status from users where id='${Q2id}'`) === "aktif");

// Yarıda kalan kapatma: dondurulmuş hesapta açık ilan kalmışsa tur kapatır
const Zl = await load(zBack.accessToken, 21);
psql(`update users set status='donduruldu' where id='${Zid}'`);
r = await api("POST", "/admin/tick", A);
check("tur dondurulmuş hesapta kalan ilanı kapattı", r.body.frozenClosed >= 1 && psql(`select status from load_posts where id='${Zl}'`) === "iptal", JSON.stringify(r.body));

console.log("\nOturum yenileme: tek kullanım, dondurmayla yarış");
const refreshWith = (t) => api("POST", "/auth/refresh", null, { refreshToken: t });
const R1 = await login(phone(44));
burst = await Promise.all([refreshWith(R1.refreshToken), refreshWith(R1.refreshToken)]);
check("aynı yenileme belirteciyle iki paralel istekten yalnız biri yeni oturum alır", burst.filter((x) => x.status === 201).length === 1 && burst.some((x) => x.status === 401), JSON.stringify(burst.map((x) => x.status)));
let leaked = 0, errs = 0, frozeN = 0;
// Yenileme 0–9 ms gecikmeli: kimi turda dondurmadan önce, kimi turda kilit beklerken gelir
for (let i = 0; i < 8; i++) {
  const p = phone(50 + i);
  const t = await login(p);
  const id = idOf(p);
  const [fr, rf] = await Promise.all([api("POST", "/me/freeze", t.accessToken), sleep((i % 4) * 3).then(() => refreshWith(t.refreshToken))]);
  if (fr.status >= 500 || rf.status >= 500) errs++;
  if (fr.status === 200) frozeN++;
  if (fr.status === 200 && psql(`select count(*) from refresh_tokens where user_id='${id}' and revoked_at is null`) !== "0") leaked++;
}
check("dondurma ile yenileme yarışında 5xx (kilitlenme) yok, dondurulan hesapta açık yenileme belirteci kalmaz", errs === 0 && leaked === 0 && frozeN === 8, `5xx ${errs}, kaçak ${leaked}, dondurulan ${frozeN}`);

console.log("\nAskıya alma ile silme aynı anda");
let both = 0, lost = 0;
// Askı 0–15 ms gecikmeli: kimi turda silme kazanır, kimi turda askı silme isteği guard'ı geçtikten sonra gelir
for (let i = 0; i < 8; i++) {
  const p = phone(30 + i);
  const Z = await user(p, ["shipper"]);
  const Zid = idOf(p);
  await api("POST", "/me/deletion-code", Z.access);
  await sleep(300);
  const zc = lastCode(p, "hesap silme");
  const [del, sus] = await Promise.all([api("DELETE", "/me", Z.access, { code: zc }), sleep((i % 4) * 5).then(() => api("POST", `/admin/users/${Zid}/suspend`, A, { reason: "aynı anda deneme" }))]);
  const st = psql(`select status from users where id='${Zid}'`);
  if (del.status === 200 && sus.status === 200) both++;
  if (sus.status === 200 && st !== "askida") lost++;
}
check("askı ve silme ikisi birden başarılı olmaz; başarılı askı kalır", both === 0 && lost === 0, `ikisi birden ${both}, kaybolan askı ${lost}`);

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
