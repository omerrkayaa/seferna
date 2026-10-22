// NFR-04 yönetici iki adımlı doğrulaması (TOTP; Google/Microsoft Authenticator) — uçtan uca test. Kurulumsuz yöneticinin
// belirtecinde rol yok; kurulum (QR adresi, şifreli anahtar, kurtarma kodları, diğer oturumlar kapanır); giriş SMS +
// uygulama kodu; tekrar koruması; kurtarma kodu; 5 hatada kilit (paralel dahil); cihaz değiştirme; 12 saatlik oturum.
// Yalıtım: +90531… numaraları. Ön koşul ve kullanım: e2e-confirmation.mjs ile aynı. node test/e2e-mfa.mjs api.log
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { totp } from "./lib/admin.mjs";

const LOG = process.argv[2];
const B = "http://localhost:3000/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => execFileSync("docker", ["exec", "nakliye-db-1", "psql", "-U", "nakliye", "-d", "nakliye", "-tAc", q]).toString().trim();
const log = () => readFileSync(LOG, "utf8");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

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
/** SMS adımı: yeni kod (60 sn sınırı için bekleyen kod silinir) → doğrulama yanıtı (belirteç ya da challenge) */
async function smsStep(phone) {
  psql(`delete from otp_codes where phone='${phone}'`);
  const before = lastCode(phone);
  await api("POST", "/auth/otp/request", null, { phone });
  let code;
  for (let i = 0; i < 40 && (!(code = lastCode(phone)) || code === before); i++) await sleep(100);
  return (await api("POST", "/auth/otp/verify", null, { phone, code })).body;
}
const claims = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
const idOf = (p) => psql(`select id from users where phone='${p}'`);
const makeAdmin = (p) => psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${p}' on conflict do nothing`);
const lastStep = (p) => Number(psql(`select last_step from user_totp where user_id=(select id from users where phone='${p}')`));
/**
 * Şu anki kod, "uygulamada yeni kod çıktı" gibi: tekrar koruması aynı 30 sn'lik adımda tek kod geçirir; her başarılı
 * girişte gerçekten 30 sn beklememek için kullanılan son adım pencerenin dışına çekilir. Korumanın kendisi ayrıca sınanır.
 */
const freshCode = (secret, p) => {
  psql(`update user_totp set last_step = ${Math.floor(Date.now() / 30_000) - 2} where user_id=(select id from users where phone='${p}')`);
  return totp(secret);
};

let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90531${run}%'`) !== "0");
const phone = (n) => `+90531${run}${String(n).padStart(3, "0")}`;

console.log("\nKurulumsuz yönetici: belirteçte yönetici rolü yok");
const P = phone(1);
let t = await smsStep(P);
makeAdmin(P);
let r = await api("POST", "/auth/refresh", null, { refreshToken: t.refreshToken });
const preToken = r.body.accessToken, preRefresh = r.body.refreshToken;
check("yenilenen belirteçte rol yok", r.status === 201 && !claims(preToken).roles.includes("admin") && claims(preToken).mfa === undefined, JSON.stringify(claims(preToken)));
r = await api("GET", "/admin/reports", preToken);
check("yönetici ucu 403", r.status === 403);
r = await api("GET", "/me", preToken);
check("GET /me: roller DB'den (admin), adminMfa 'kurulum'", r.body.roles?.includes("admin") && r.body.adminMfa === "kurulum", JSON.stringify(r.body).slice(0, 160));
r = await api("GET", "/me/totp", preToken);
check("durum: kurulu değil", r.status === 200 && r.body.enabled === false && r.body.pending === false && r.body.recoveryCodesLeft === 0, JSON.stringify(r.body));
r = await api("POST", "/me/totp/enable", preToken, { code: "123456" });
check("kurulum başlamadan etkinleştirme 409", r.status === 409 && r.body.message === "Önce kurulumu başlatın.", JSON.stringify(r.body));
const U = await smsStep(phone(2));
r = await api("POST", "/me/totp/setup", U.accessToken, {});
check("yönetici olmayan kuramaz (403)", r.status === 403 && r.body.message === "İki adımlı doğrulama yalnız yönetici hesapları içindir", JSON.stringify(r.body));
r = await api("GET", "/me", U.accessToken);
check("yönetici olmayanda adminMfa null", r.body.adminMfa === null);

console.log("\nKurulum: QR adresi, şifreli anahtar, kurtarma kodları, diğer oturumlar kapanır");
r = await api("POST", "/me/totp/setup", preToken, {});
const secret = r.body.secret;
const url = r.body.otpauthUrl ?? "";
check("anahtar base32 (160 bit = 32 karakter)", r.status === 201 && /^[A-Z2-7]{32}$/.test(secret ?? ""), JSON.stringify(r.body));
check("otpauth adresi: Seferna etiketi, maskeli numara, SHA1/6/30", url.startsWith("otpauth://totp/Seferna%3A") && url.includes(`secret=${secret}`) && url.includes("issuer=Nakliye") && url.includes("algorithm=SHA1") && url.includes("digits=6") && url.includes("period=30") && url.includes(encodeURIComponent("***")) && !url.includes(P.slice(3)), url);
const Pid = idOf(P);
const enc = psql(`select pending_enc from user_totp where user_id='${Pid}'`);
check("DB'de bekleyen anahtar şifreli (v1.…, düz anahtar yok), etkin anahtar boş", enc.startsWith("v1.") && !enc.includes(secret) && psql(`select secret_enc is null and enabled_at is null from user_totp where user_id='${Pid}'`) === "t");
r = await api("POST", "/me/totp/enable", preToken, { code: totp(secret) === "000000" ? "111111" : "000000" });
check("yanlış kodla etkinleşmez (400: oturum geçerli, kod hatalı)", r.status === 400 && r.body.message === "Kod hatalı", JSON.stringify(r.body));
r = await api("POST", "/me/totp/enable", preToken, { code: totp(secret) });
const rc = r.body.recoveryCodes ?? [];
let A = r.body.accessToken, Arefresh = r.body.refreshToken;
check("etkinleşti: 10 farklı kurtarma kodu (ABCDE-FGH23)", r.status === 201 && rc.length === 10 && new Set(rc).size === 10 && rc.every((c) => /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(c)), JSON.stringify(r.body).slice(0, 200));
check("yeni belirteç yönetici rolü ve ikinci adım anıyla", claims(A).roles.includes("admin") && typeof claims(A).mfa === "number");
check("kurtarma kodları DB'de anahtarlı özetle (düz kod yok)", psql(`select count(*) from totp_recovery_codes where user_id='${Pid}'`) === "10" && psql(`select count(*) from totp_recovery_codes where user_id='${Pid}' and code_hash in ('${rc.map((c) => c.replace("-", "")).join("','")}','${rc.map((c) => sha256(c)).join("','")}')`) === "0");
check("eski oturumların yenileme belirteci kapandı", (await api("POST", "/auth/refresh", null, { refreshToken: preRefresh })).status === 401 && (await api("POST", "/auth/refresh", null, { refreshToken: t.refreshToken })).status === 401);
r = await api("GET", "/admin/reports", A);
check("yönetici ucu açıldı", r.status === 200);
r = await api("GET", "/me", A);
check("adminMfa 'tamam'", r.body.adminMfa === "tamam");
r = await api("POST", "/me/roles", A, { roles: ["shipper"] });
check("rol eklemede yönetici rolü ve ikinci adım korunur", r.status === 201 && claims(r.body.accessToken).roles.includes("admin") && claims(r.body.accessToken).roles.includes("shipper"), JSON.stringify(r.body).slice(0, 120));
r = await api("POST", "/me/roles", preToken, { roles: ["shipper"] });
check("etkinleştirmeyle kapanan oturumun erişim belirteci rol ucundan yeni belirteç alamaz (401)", r.status === 401 && r.body.message === "Oturum süresi doldu", JSON.stringify(r.body));

console.log("\nGiriş: SMS kodu tek başına yetmez");
let v = await smsStep(P);
check("doğrulama belirteç değil challenge döner", v.mfaRequired === true && typeof v.challenge === "string" && v.accessToken === undefined && v.refreshToken === undefined, JSON.stringify(v).slice(0, 120));
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: totp(secret) === "999999" ? "999998" : "999999" });
check("yanlış kod 401 'Kod hatalı'", r.status === 401 && r.body.message === "Kod hatalı", JSON.stringify(r.body));
const used = totp(secret, lastStep(P) - Math.floor(Date.now() / 30_000));
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: used });
check("kullanılmış kod geçmez (tekrar koruması), kilide sayılmaz", r.status === 401 && r.body.message === "Bu kod az önce kullanıldı; uygulamada yeni kodun çıkmasını bekleyin." && psql(`select failed_count from user_totp where user_id='${Pid}'`) === "1", JSON.stringify(r.body));
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: freshCode(secret, P) });
check("doğru kodla giriş: yönetici rolüyle belirteç, hata sayacı sıfır", r.status === 201 && claims(r.body.accessToken).roles.includes("admin") && psql(`select failed_count from user_totp where user_id='${Pid}'`) === "0", JSON.stringify(r.body).slice(0, 120));
A = r.body.accessToken; Arefresh = r.body.refreshToken;
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: freshCode(secret, P) });
check("challenge tek kullanımlık", r.status === 401 && r.body.message === "Doğrulama süresi doldu; yeniden giriş yapın.", JSON.stringify(r.body));
r = await api("POST", "/auth/totp", null, { challenge: "x".repeat(43), code: "123456" });
check("uydurma challenge 401", r.status === 401);
const v1 = await smsStep(P), v2 = await smsStep(P);
const same = freshCode(secret, P);
const par = await Promise.all([v1, v2].map((x) => api("POST", "/auth/totp", null, { challenge: x.challenge, code: same })));
check("aynı kod iki girişte paralel: yalnız biri geçer", par.map((x) => x.status).sort().join() === "201,401", par.map((x) => `${x.status} ${x.body.message ?? ""}`).join(" | "));

console.log("\nKurtarma kodu: tek kullanımlık, biçim esnek");
v = await smsStep(P);
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: rc[0].toLowerCase().replace("-", "") });
check("küçük harf, tiresiz kurtarma koduyla giriş", r.status === 201 && claims(r.body.accessToken).roles.includes("admin"), JSON.stringify(r.body).slice(0, 120));
v = await smsStep(P);
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: rc[0] });
check("aynı kurtarma kodu ikinci kez geçmez", r.status === 401 && r.body.message === "Kod hatalı");
r = await api("GET", "/me/totp", A);
check("kalan kurtarma kodu 9", r.body.recoveryCodesLeft === 9 && r.body.enabled === true, JSON.stringify(r.body));

console.log("\nArdışık 5 hatalı kodda 15 dk kilit (paralel denemeler de sayılır)");
psql(`update user_totp set failed_count = 0, locked_until = null where user_id='${Pid}'`);
const bad = (i) => String((Number(totp(secret)) + 1000 + i) % 1_000_000).padStart(6, "0");
// Ayrı ayrı 10 giriş (challenge DB'ye doğrudan: 10 SMS numaranın günlük sınırını doldururdu); sayaç kullanıcıda
const chs = Array.from({ length: 10 }, (_, i) => `test-challenge-${run}-${i}-${"x".repeat(20)}`);
psql(`insert into mfa_challenges(token_hash, user_id, expires_at) values ${chs.map((c) => `('${sha256(c)}', '${Pid}', now() + interval '5 minutes')`).join(",")}`);
const burst = await Promise.all(chs.map((c, i) => api("POST", "/auth/totp", null, { challenge: c, code: bad(i) })));
const statuses = burst.map((x) => x.status);
check("10 ayrı girişten paralel yanlış kod: 4'ü 401, 6'sı 429 (sayaç yarışmadı)", statuses.filter((s) => s === 401).length === 4 && statuses.filter((s) => s === 429).length === 6, statuses.join());
check("kilit mesajı kalan süreyle", burst.some((x) => x.body.message === "Çok fazla hatalı kod. 15 dakika sonra tekrar deneyin."), JSON.stringify(burst.find((x) => x.status === 429)?.body));
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: freshCode(secret, P) });
check("kilitliyken doğru kod da 429", r.status === 429);
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: rc[1] });
check("kilitliyken kurtarma kodu da 429 (harcanmaz)", r.status === 429 && psql(`select count(*) from totp_recovery_codes where user_id='${Pid}'`) === "9");
r = await api("GET", "/me/totp", A);
check("durumda kilit bitişi", typeof r.body.lockedUntil === "string");
psql(`update user_totp set locked_until = now() - interval '1 second' where user_id='${Pid}'`);
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: freshCode(secret, P) });
check("kilit bitince doğru kod geçer", r.status === 201, JSON.stringify(r.body));
A = r.body.accessToken; Arefresh = r.body.refreshToken;

console.log("\nCihaz değiştirme: mevcut koddan sonra; eski anahtar yenisi onaylanana kadar geçerli");
r = await api("POST", "/me/totp/setup", A, {});
check("kodsuz 403", r.status === 403 && r.body.message === "Cihaz değiştirmek için mevcut uygulamadaki kodu ya da bir kurtarma kodunu girin.", JSON.stringify(r.body));
r = await api("POST", "/me/totp/setup", A, { code: bad(50) });
check("yanlış kodla 400", r.status === 400);
r = await api("POST", "/me/totp/setup", A, { code: freshCode(secret, P) });
const secret2 = r.body.secret;
check("doğru kodla yeni anahtar (öncekinden farklı); etkin anahtar değişmedi", r.status === 201 && secret2 && secret2 !== secret && psql(`select pending_enc is not null and secret_enc is not null from user_totp where user_id='${Pid}'`) === "t", JSON.stringify(r.body).slice(0, 80));
r = await api("POST", "/me/totp/enable", A, { code: freshCode(secret, P) });
check("eski uygulamanın koduyla yeni anahtar onaylanmaz", r.status === 400);
r = await api("POST", "/me/totp/enable", A, { code: totp(secret2) });
const rc2 = r.body.recoveryCodes ?? [];
check("yeni cihaz etkin; yeni 10 kurtarma kodu", r.status === 201 && rc2.length === 10 && !rc2.includes(rc[2]), JSON.stringify(r.body).slice(0, 80));
A = r.body.accessToken; Arefresh = r.body.refreshToken;
v = await smsStep(P);
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: rc[2] });
check("eski kurtarma kodları geçersiz", r.status === 401);
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: freshCode(secret, P) });
check("eski cihazın kodu geçersiz", r.status === 401);
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: freshCode(secret2, P) });
check("yeni cihazın koduyla giriş", r.status === 201);
A = r.body.accessToken; Arefresh = r.body.refreshToken;

console.log("\nKurtarma kodlarını yenileme");
r = await api("POST", "/me/totp/recovery-codes", A, { code: bad(60) });
check("yanlış kodla 400", r.status === 400);
r = await api("POST", "/me/totp/recovery-codes", A, { code: freshCode(secret2, P) });
const rc3 = r.body.recoveryCodes ?? [];
check("yeni 10 kod; öncekiler geçersiz", r.status === 201 && rc3.length === 10 && psql(`select count(*) from totp_recovery_codes where user_id='${Pid}'`) === "10" && !rc3.includes(rc2[0]));
r = await api("POST", "/me/totp/recovery-codes", U.accessToken, { code: "123456" });
check("yönetici olmayan 403", r.status === 403);

console.log("\nYönetici oturumu ikinci adımdan 12 saat sonra kapanır");
psql(`update refresh_tokens set mfa_at = now() - interval '11 hours' where token_hash='${sha256(Arefresh)}'`);
r = await api("POST", "/auth/refresh", null, { refreshToken: Arefresh });
check("11 saatte yenileme: yönetici rolü sürer, ikinci adım anı taşınır", r.status === 201 && claims(r.body.accessToken).roles.includes("admin") && psql(`select extract(epoch from now() - mfa_at) between 39000 and 40000 from refresh_tokens where token_hash='${sha256(r.body.refreshToken)}'`) === "t", JSON.stringify(r.body).slice(0, 120));
Arefresh = r.body.refreshToken;
psql(`update refresh_tokens set mfa_at = now() - interval '12 hours 1 minute' where token_hash='${sha256(Arefresh)}'`);
r = await api("POST", "/auth/refresh", null, { refreshToken: Arefresh });
check("12 saat sonra yenileme 401 (yeniden giriş: SMS + uygulama)", r.status === 401 && r.body.message === "Yönetici oturumunun süresi doldu; yeniden giriş yapın.", JSON.stringify(r.body));

console.log("\nAnahtar kullanıcıya bağlı; çözülemezse kurtarma kodu yine geçer");
const Q = phone(3);
const q = await smsStep(Q);
makeAdmin(Q);
const qs = await api("POST", "/me/totp/setup", q.accessToken, {});
const qe = await api("POST", "/me/totp/enable", q.accessToken, { code: totp(qs.body.secret) });
const Qid = idOf(Q);
psql(`update user_totp set secret_enc = (select secret_enc from user_totp where user_id='${Pid}') where user_id='${Qid}'`);
v = await smsStep(Q);
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: freshCode(secret2, P) });
check("başka kullanıcıdan taşınan şifreli anahtar açılmaz: 401, 500 değil", r.status === 401, `${r.status} ${JSON.stringify(r.body)}`);
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: qe.body.recoveryCodes[0] });
check("kurtarma koduyla giriş yine olur", r.status === 201, JSON.stringify(r.body));

console.log("\nErişim belirteci oturuma bağlı: kapanan oturum rol ucundan kendini yenileyemez (inceleme 2026-10-15, bulgu 1)");
const W = phone(5);
let w = await smsStep(W);
check("belirteçte oturum kimliği (sid) var", typeof claims(w.accessToken).sid === "string");
r = await api("POST", "/me/roles", w.accessToken, { roles: ["carrier"] });
check("açık oturumda rol eklenir, yeni belirteç aynı oturuma bağlı", r.status === 201 && claims(r.body.accessToken).sid === claims(w.accessToken).sid, JSON.stringify(r.body).slice(0, 120));
const rolled = (await api("POST", "/auth/refresh", null, { refreshToken: w.refreshToken })).body;
r = await api("POST", "/me/roles", w.accessToken, { roles: ["shipper"] });
check("yenilemeden önceki erişim belirteci 401, rol eklenmez", r.status === 401 && psql(`select count(*) from user_roles where user_id=(select id from users where phone='${W}') and role='shipper'`) === "0", JSON.stringify(r.body));
r = await api("POST", "/me/roles", rolled.accessToken, { roles: ["shipper"] });
check("yenilenen belirteçle olur", r.status === 201);
await api("POST", "/auth/logout", null, { refreshToken: rolled.refreshToken });
r = await api("POST", "/me/roles", rolled.accessToken, { roles: ["carrier"] });
check("çıkıştan sonra 401 (önceden her çağrıda yeni belirteç basıyordu)", r.status === 401 && r.body.message === "Oturum süresi doldu", JSON.stringify(r.body));
r = await api("POST", "/me/roles", A, { roles: ["carrier"] });
const Asid = claims(A).sid;
psql(`update refresh_tokens set revoked_at = now() where id='${Asid}'`);
r = await api("POST", "/me/roles", A, { roles: ["carrier"] });
check("yöneticinin kapanan oturumu: ikinci adımlı belirteç de yenilenemez", r.status === 401, JSON.stringify(r.body));

console.log("\nBekleyen kurulum: 10 dk geçerli, 5 hatalı kodda atılır (inceleme 2026-10-15, bulgu 2)");
const R = phone(6);
const rv = await smsStep(R);
makeAdmin(R);
const Rid = idOf(R);
let rs = (await api("POST", "/me/totp/setup", rv.accessToken, {})).body;
const wrong = (i) => String((Number(totp(rs.secret)) + 2000 + i) % 1_000_000).padStart(6, "0");
const tries = [];
for (let i = 0; i < 5; i++) tries.push(await api("POST", "/me/totp/enable", rv.accessToken, { code: wrong(i) }));
check("4 hatalı kod 400, 5.'si 429 'kurulumu yeniden başlatın'", tries.slice(0, 4).every((x) => x.status === 400) && tries[4].status === 429 && tries[4].body.message === "Çok fazla hatalı kod; kurulumu yeniden başlatın.", tries.map((x) => x.status).join());
check("bekleyen anahtar atıldı", psql(`select pending_enc is null from user_totp where user_id='${Rid}'`) === "t");
r = await api("POST", "/me/totp/enable", rv.accessToken, { code: totp(rs.secret) });
check("atılan anahtarın doğru koduyla da etkinleşmez (409)", r.status === 409 && r.body.message === "Önce kurulumu başlatın.", JSON.stringify(r.body));
rs = (await api("POST", "/me/totp/setup", rv.accessToken, {})).body;
psql(`update user_totp set pending_at = now() - interval '11 minutes' where user_id='${Rid}'`);
r = await api("POST", "/me/totp/enable", rv.accessToken, { code: totp(rs.secret) });
check("10 dakikası dolan kurulum etkinleşmez (409)", r.status === 409 && r.body.message === "Kurulumun süresi doldu (10 dakika); yeniden başlatın.", JSON.stringify(r.body));
rs = (await api("POST", "/me/totp/setup", rv.accessToken, {})).body;
await api("POST", "/me/totp/enable", rv.accessToken, { code: wrong(9) });
r = await api("POST", "/me/totp/enable", rv.accessToken, { code: totp(rs.secret) });
check("yeni kurulum sayacı sıfırdan: hatalı koddan sonra doğru kodla etkinleşir", r.status === 201 && psql(`select pending_enc is null and pending_attempts = 0 and enabled_at is not null from user_totp where user_id='${Rid}'`) === "t", JSON.stringify(r.body).slice(0, 120));

console.log("\nChallenge süresi ve zamanlayıcı");
v = await smsStep(P);
psql(`update mfa_challenges set expires_at = now() - interval '1 second' where token_hash='${sha256(v.challenge)}'`);
r = await api("POST", "/auth/totp", null, { challenge: v.challenge, code: freshCode(secret2, P) });
check("süresi dolan challenge 401", r.status === 401 && r.body.message === "Doğrulama süresi doldu; yeniden giriş yapın.");
const v3 = await smsStep(P);
r = await api("POST", "/auth/totp", null, { challenge: v3.challenge, code: freshCode(secret2, P) });
A = r.body.accessToken;
r = await api("POST", "/admin/tick", A);
check("tur süresi dolanı sildi", r.status === 200 && r.body.mfaChallengesPurged >= 1 && psql(`select count(*) from mfa_challenges where token_hash='${sha256(v.challenge)}'`) === "0", JSON.stringify(r.body).slice(0, 160));

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
