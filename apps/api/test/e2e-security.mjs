// NFR-04 kod isteği sınırları (numara başına 24 saatte 10 kod, IP başına saatte 20 farklı numara) ve X-Forwarded-For
// güveni — uçtan uca test. Ana test sunucusu (3000) IP sınırı kapalı çalışır (bütün takımlar tek makineden yüzlerce
// numarayla girer); bu takım sınırları açık kendi sunucularını başlatır: 3100 (TRUST_PROXY=loopback, varsayılan) ve
// 3101 (TRUST_PROXY=false, IP sınırı kapalı; yalnız hangi adresin kaydedildiğine bakılır).
// Yalıtım: +90530… numaraları; IP'ler belgeleme aralığından (2001:db8::/32), çalıştırma kimliğiyle.
// Ön koşul: npm run build (dist), DB ayakta. Kullanım (apps/api içinden): node test/e2e-security.mjs
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { adminSession } from "./lib/admin.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => execFileSync("docker", ["exec", "nakliye-db-1", "psql", "-U", "nakliye", "-d", "nakliye", "-tAc", q]).toString().trim();

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from otp_requests where phone like '+90530${run}%'`) !== "0" || psql(`select count(*) from users where phone like '+90530${run}%'`) !== "0");
const phone = (n) => `+90530${run}${String(n).padStart(3, "0")}`;
// Her n ayrı bir /64 ağı (sınır IPv6'da /64'e göre sayılır); host: aynı ağda başka adres
const ip = (n, host = 1) => `2001:db8:${run}:${n.toString(16)}::${host.toString(16)}`;
const ipKey = (n) => `2001:db8:${parseInt(run, 16).toString(16)}:${n.toString(16)}::/64`;
const DEMO = phone(400), DEMO_OTP = "135790";

// ── sunucular ──
const servers = [];
async function server(port, env) {
  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PORT: String(port), JOBS_ENABLED: "false", SMS_PROVIDER: "console", NO_COLOR: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const s = { port, out: "", child };
  child.stdout.on("data", (d) => (s.out += d));
  child.stderr.on("data", (d) => (s.out += d));
  servers.push(s);
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://localhost:${port}/api/v1/health`)).ok) return s; } catch { /* henüz açılmadı */ }
    if (child.exitCode !== null) break;
    await sleep(200);
  }
  throw new Error(`API ${port} açılmadı:\n${s.out}`);
}
const stopAll = () => { for (const s of servers) s.child.kill(); };
process.on("exit", stopAll);

const limits = { OTP_PHONE_DAILY_LIMIT: "10", OTP_IP_HOURLY_LIMIT: "20" };
const A = await server(3100, { ...limits, TRUST_PROXY: "loopback", DEMO_PHONE: DEMO, DEMO_OTP, UPLOAD_MAX_MS: "1500" });
const N = await server(3101, { OTP_PHONE_DAILY_LIMIT: "10", OTP_IP_HOURLY_LIMIT: "0", TRUST_PROXY: "false", DEMO_PHONE: "" });

async function api(srv, method, path, { token, body, xff } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (xff !== undefined) headers["x-forwarded-for"] = xff;
  const res = await fetch(`http://localhost:${srv.port}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const request = (p, xff, srv = A) => api(srv, "POST", "/auth/otp/request", { body: { phone: p }, xff });
/** 60 sn yeniden gönderme sınırını atlamak için bekleyen kod silinir (sınır sayımı otp_requests'te, ona dokunulmaz) */
const clearCode = (p) => psql(`delete from otp_codes where phone='${p}'`);
const smsCount = (srv, p) => [...srv.out.matchAll(/\[SMS → (\+\d+)\]/g)].filter((m) => m[1] === p).length;
const lastCode = (srv, p) => [...srv.out.matchAll(/\[SMS → (\+\d+)\] Seferna giriş kodunuz: (\d{6})/g)].filter((m) => m[1] === p).at(-1)?.[2];
const rows = (where) => Number(psql(`select count(*) from otp_requests where ${where}`));
async function login(p, xff) {
  await request(p, xff);
  await sleep(200);
  return (await api(A, "POST", "/auth/otp/verify", { body: { phone: p, code: lastCode(A, p) } })).body;
}

try {
  console.log("\nNumara başına 24 saatte 10 kod");
  const P = phone(1);
  let ok = 0;
  for (let i = 0; i < 10; i++) {
    clearCode(P);
    if ((await request(P, ip(1))).status === 204) ok++;
  }
  check("10 kod gönderildi", ok === 10 && smsCount(A, P) === 10, `${ok}`);
  clearCode(P);
  let r = await request(P, ip(1));
  check("11. istek 429, kalan süreyle", r.status === 429 && r.body.message === "Bu numara için çok fazla kod istendi. 24 saat sonra tekrar deneyin.", JSON.stringify(r.body));
  check("reddedilen istek kaydedilmez, SMS gitmez", rows(`phone='${P}'`) === 10 && smsCount(A, P) === 10);
  r = await request(P, ip(2));
  check("başka IP'den de 429 (sınır numaranın)", r.status === 429);
  psql(`update otp_requests set created_at = now() - interval '23 hours 30 minutes' where id = (select id from otp_requests where phone='${P}' order by created_at limit 1)`);
  r = await request(P, ip(1));
  check("en eski istek 23,5 saat önce: '30 dakika sonra'", r.status === 429 && r.body.message === "Bu numara için çok fazla kod istendi. 30 dakika sonra tekrar deneyin.", JSON.stringify(r.body));
  psql(`update otp_requests set created_at = now() - interval '25 hours' where id = (select id from otp_requests where phone='${P}' order by created_at limit 1)`);
  r = await request(P, ip(1));
  check("en eski istek 24 saati doldurunca bir hak açılır", r.status === 204, JSON.stringify(r.body));
  clearCode(P);
  r = await request(P, ip(1));
  check("ardından yine 429 (son 24 saatte 10)", r.status === 429);

  console.log("\nSilme kodu aynı sınıra sayılır; paralel istekler sınırı aşamaz");
  const Q = phone(2);
  const q = await login(Q, ip(3));
  psql(`insert into otp_requests(phone, ip, purpose, created_at) select '${Q}', null, 'giris', now() - interval '1 hour' from generate_series(1, 9)`);
  r = await api(A, "POST", "/me/deletion-code", { token: q.accessToken, xff: ip(3) });
  check("10 istekten sonra silme kodu 429", r.status === 429 && r.body.message?.startsWith("Bu numara için çok fazla kod istendi."), JSON.stringify(r.body));
  psql(`delete from otp_requests where id = (select id from otp_requests where phone='${Q}' order by created_at limit 1)`);
  clearCode(Q);
  const par = await Promise.all([request(Q, ip(3)), api(A, "POST", "/me/deletion-code", { token: q.accessToken, xff: ip(3) })]);
  check("9 kayıtta paralel giriş + silme kodu: biri 204, biri 429", par.map((x) => x.status).sort().join() === "204,429", par.map((x) => x.status).join());
  check("kayıt 10'da kaldı", rows(`phone='${Q}'`) === 10, `${rows(`phone='${Q}'`)}`);

  console.log("\nIP başına saatte 20 farklı numara");
  ok = 0;
  for (let n = 100; n < 120; n++) if ((await request(phone(n), ip(10))).status === 204) ok++;
  check("20 farklı numara", ok === 20, `${ok}`);
  r = await request(phone(120), ip(10));
  check("21. numara 429 'Çok fazla deneme yaptınız. 1 saat sonra…'", r.status === 429 && r.body.message === "Çok fazla deneme yaptınız. 1 saat sonra tekrar deneyin.", JSON.stringify(r.body));
  check("reddedilen numaraya SMS gitmez", smsCount(A, phone(120)) === 0 && rows(`phone='${phone(120)}'`) === 0);
  clearCode(phone(100));
  r = await request(phone(100), ip(10));
  check("sayılmış numaraya yeni kod: yeni numara sayılmaz (204)", r.status === 204, JSON.stringify(r.body));
  r = await request(phone(120), ip(11));
  check("başka IP'den aynı numara (204)", r.status === 204);
  psql(`update otp_requests set created_at = now() - interval '61 minutes' where phone='${phone(101)}' and ip='${ipKey(10)}'`);
  r = await request(phone(121), ip(10));
  check("bir numaranın isteği saati doldurunca yeni numaraya yer açılır", r.status === 204, JSON.stringify(r.body));
  psql(`update otp_requests set created_at = now() - interval '50 minutes' where phone='${phone(102)}' and ip='${ipKey(10)}'`);
  r = await request(phone(122), ip(10));
  check("en eskisi 50 dk önce: '10 dakika sonra'", r.status === 429 && r.body.message === "Çok fazla deneme yaptınız. 10 dakika sonra tekrar deneyin.", JSON.stringify(r.body));

  console.log("\nIP sınırında yarış: 19 numara + 5 paralel yeni numara");
  for (let n = 200; n < 219; n++) await request(phone(n), ip(20));
  const race = await Promise.all([219, 220, 221, 222, 223].map((n) => request(phone(n), ip(20))));
  check("yalnız biri geçer", race.filter((x) => x.status === 204).length === 1 && race.filter((x) => x.status === 429).length === 4, race.map((x) => x.status).join());
  check("IP'de 20 farklı numara", psql(`select count(distinct phone) from otp_requests where ip='${ipKey(20)}'`) === "20");

  console.log("\nIPv6 /64 ağına göre sayılır (abone koca bir /64 alır); IPv4-eşlemeli adres IPv4'tür");
  ok = 0;
  for (let n = 250; n < 270; n++) if ((await request(phone(n), ip(25, n))).status === 204) ok++;
  r = await request(phone(270), ip(25, 9999));
  check("aynı /64'te 20 farklı adresten 20 numara, 21.'si başka adresten de 429", ok === 20 && r.status === 429, `${ok} ${r.status}`);
  const v4 = `198.51.100.${Number(run) % 250}`;
  await request(phone(280), `::ffff:${v4}`);
  check("::ffff:a.b.c.d IPv4 olarak kaydedilir", psql(`select ip from otp_requests where phone='${phone(280)}'`) === v4);

  console.log("\nX-Forwarded-For: yalnız güvenilen vekilden (loopback) gelirse");
  const ipOf = (p) => psql(`select coalesce(ip, 'NULL') from otp_requests where phone='${p}' order by created_at desc limit 1`);
  await request(phone(300), ip(30));
  check("loopback'ten gelen başlık: istemci adresi (/64) kaydedilir", ipOf(phone(300)) === ipKey(30), ipOf(phone(300)));
  await request(phone(301), `198.51.100.7, ${ip(31)}`);
  check("zincirde en sağdaki (vekile bağlanan) adres", ipOf(phone(301)) === ipKey(31), ipOf(phone(301)));
  r = await request(phone(302), "yanlis-deger");
  check("IP olmayan değer: istek geçer, adres boş kalır", r.status === 204 && ipOf(phone(302)) === "NULL", `${r.status} ${ipOf(phone(302))}`);
  r = await request(phone(303), "x".repeat(200));
  check("uzun değer 500 vermez", r.status === 204 && ipOf(phone(303)) === "NULL", `${r.status}`);
  r = await request(phone(304), ip(32), N);
  const stored = ipOf(phone(304));
  check("TRUST_PROXY=false: başlık yok sayılır, soket adresi kaydedilir", r.status === 204 && /^(127\.0\.0\.1|0:0:0:0::\/64)$/.test(stored), `${r.status} ${stored}`);

  console.log("\nDemo numarası (yalnız geliştirme) sınırsız; 60 sn yeniden gönderme sınırı yerinde");
  ok = 0;
  for (let i = 0; i < 12; i++) {
    clearCode(DEMO);
    if ((await request(DEMO, ip(40))).status === 204) ok++;
  }
  check("demo numarasına 12 kod", ok === 12, `${ok}`);
  r = await api(A, "POST", "/auth/otp/verify", { body: { phone: DEMO, code: DEMO_OTP } });
  check("demo kodu ile giriş", r.status === 201 && typeof r.body.accessToken === "string", JSON.stringify(r.body).slice(0, 120));
  await request(phone(500), ip(41));
  r = await request(phone(500), ip(41));
  check("60 sn içinde ikinci istek 429 'Yeni kod için biraz bekleyin'", r.status === 429 && r.body.message === "Yeni kod için biraz bekleyin");

  console.log("\nBelge yüklemesinin süre sınırı: gövdesi bitmeyen istek kesilir, yuva boşalır (bu sunucuda 1,5 sn)");
  const up = await login(phone(700), ip(60));
  const carrier = (await api(A, "POST", "/me/roles", { token: up.accessToken, body: { roles: ["carrier"] } })).body.accessToken;
  const boundary = "----nakliye-sure";
  let ctrl;
  const started = Date.now();
  const slow = fetch(`http://localhost:${A.port}/api/v1/documents`, {
    method: "POST",
    headers: { authorization: `Bearer ${carrier}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    body: new ReadableStream({ start: (c) => { ctrl = c; c.enqueue(new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nsrc\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n`)); } }),
    duplex: "half",
  }).then((res) => res.status, () => "kesildi");
  const outcome = await Promise.race([slow, sleep(6000).then(() => "beklemede")]);
  check("bitmeyen yükleme süre dolunca kesilir", outcome === "kesildi" && Date.now() - started < 6000, `${outcome} ${Date.now() - started} ms`);
  try { ctrl.close(); } catch { /* akış zaten kapandı */ }
  const fd = new FormData();
  fd.append("type", "src");
  fd.append("file", new Blob([Buffer.from("%PDF-1.4\n% deneme\n")], { type: "application/pdf" }), "b.pdf");
  const again = await fetch(`http://localhost:${A.port}/api/v1/documents`, { method: "POST", headers: { authorization: `Bearer ${carrier}` }, body: fd });
  check("ardından aynı kullanıcı yükleyebilir (yuva boşaldı)", again.status === 201, `${again.status}`);
  // Temizlik: bekleyen belge kuyrukta birikmesin
  psql(`update documents set status='ret', reject_reason='Test temizliği', reviewed_at=now() where status='bekliyor' and owner_user_id=(select id from users where phone='${phone(700)}')`);

  console.log("\nZamanlayıcı 2 günden eski kayıtları siler");
  const adminPhone = phone(600);
  const a = await login(adminPhone, ip(50));
  psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${adminPhone}' on conflict do nothing`);
  const adminToken = (await adminSession((m, path, token, body) => api(A, m, path, { token, body }), a.accessToken)).accessToken;
  psql(`insert into otp_requests(phone, ip, purpose, created_at) values ('${phone(601)}', null, 'giris', now() - interval '49 hours'), ('${phone(602)}', null, 'giris', now() - interval '47 hours')`);
  r = await api(A, "POST", "/admin/tick", { token: adminToken });
  check("tur eski kaydı sildi, 2 günden yenisi kaldı", r.status === 200 && r.body.otpRequestsPurged >= 1 && rows(`phone='${phone(601)}'`) === 0 && rows(`phone='${phone(602)}'`) === 1, JSON.stringify(r.body).slice(0, 200));
} finally {
  stopAll();
}

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
