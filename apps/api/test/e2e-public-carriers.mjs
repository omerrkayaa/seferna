// Herkese açık nakliyeci profili: PATCH /companies { publicProfile } ve girişsiz GET /public/carriers/:id uçtan uca test.
// Karar 2026-10-17: isteğe bağlı (nakliyeci açar); firma adı, doğrulama, puan, tamamlanan iş, araç/kasa tipleri;
// telefon, kişi adı, plaka, vergi no ve adres yok. Kendi sunucusunu başlatır (3102, SMS sınırı kapalı; dist/ güncel olmalı:
// npm run build). Yalıtım: +90533… numaraları. node test/e2e-public-carriers.mjs
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 3102;
const B = `http://localhost:${PORT}/api/v1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => execFileSync("docker", ["exec", "nakliye-db-1", "psql", "-U", "nakliye", "-d", "nakliye", "-tAc", q]).toString().trim();

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

const child = spawn(process.execPath, ["dist/main.js"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, PORT: String(PORT), JOBS_ENABLED: "false", SMS_PROVIDER: "console", NO_COLOR: "1", OTP_IP_HOURLY_LIMIT: "0", DEMO_PHONE: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
process.on("exit", () => child.kill());
for (let i = 0; ; i++) {
  try { if ((await fetch(`${B}/health`)).ok) break; } catch { /* henüz açılmadı */ }
  if (child.exitCode !== null || i > 100) throw new Error(`API ${PORT} açılmadı:\n${out}`);
  await sleep(200);
}

async function api(method, path, token, body) {
  const res = await fetch(B + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}
async function login(phone) {
  await api("POST", "/auth/otp/request", null, { phone });
  let code;
  for (let i = 0; i < 25 && !code; i++) {
    await sleep(100);
    code = [...out.matchAll(/\[SMS → (\+\d+)\] Seferna giriş kodunuz: (\d{6})/g)].filter((m) => m[1] === phone).at(-1)?.[2];
  }
  return (await api("POST", "/auth/otp/verify", null, { phone, code })).body;
}

let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90533${run}%'`) !== "0");
const phone = (n) => `+90533${run}${String(n).padStart(3, "0")}`;

const c = await login(phone(1));
const C = (await api("POST", "/me/roles", c.accessToken, { roles: ["carrier"] })).body.accessToken;
await api("PATCH", "/me", C, { name: "Gizli Kişi Adı" });
const TAX = `9${run}12345`.slice(0, 10);
const company = (await api("POST", "/companies", C, { title: `Profil Nakliyat ${run}`, taxNo: TAX })).body;
const plates = [`34PR${run}`, `35PR${run}`, `06PR${run}`];
const veh = [];
for (const [plate, vehicleType, bodyType] of [[plates[0], "tir", "tenteli"], [plates[1], "tir", "frigo"], [plates[2], "kamyon", "acik"]]) {
  veh.push((await api("POST", "/vehicles", C, { plate, vehicleType, bodyType, capacityTon: vehicleType === "tir" ? 25 : 12 })).body);
}
const profile = () => api("GET", `/public/carriers/${company.id}`);

console.log("\nKapalı profil ve geçersiz adres");
let r = await profile();
check("profil varsayılan kapalı: 404", r.status === 404 && company.publicProfile === false, `${r.status} ${JSON.stringify(company)}`);
check("geçersiz kimlik 404 (500 değil)", (await api("GET", "/public/carriers/abc")).status === 404);
check("olmayan kimlik 404", (await api("GET", "/public/carriers/00000000-0000-4000-8000-000000000000")).status === 404);

console.log("\nNakliyeci açar");
r = await api("PATCH", "/companies", C, { publicProfile: true });
check("PATCH 200, publicProfile true", r.status === 200 && r.body.publicProfile === true, r.text.slice(0, 200));
r = await profile();
const p = r.body;
check("girişsiz 200: firma adı, kimlik", r.status === 200 && p.id === company.id && p.title === `Profil Nakliyat ${run}`, r.text.slice(0, 200));
check("yeni hesap: seviye 0, firma onaysız, iş 0, puan yok", p.verificationLevel === 0 && p.companyVerified === false && p.completedJobs === 0 && p.rating === null && p.ratingCount === 0);
check("üyelik tarihi var", typeof p.memberSince === "string" && !Number.isNaN(Date.parse(p.memberSince)));
check(
  "araçlar tipe göre, büyükten küçüğe; kasa tipleri",
  JSON.stringify(p.vehicles) === JSON.stringify([{ vehicleType: "tir", count: 2, bodyTypes: ["frigo", "tenteli"] }, { vehicleType: "kamyon", count: 1, bodyTypes: ["acik"] }]),
  JSON.stringify(p.vehicles),
);
const leaks = [phone(1), phone(1).slice(3), "Gizli Kişi Adı", TAX, ...plates].filter((x) => r.text.includes(x));
check("telefon, kişi adı, vergi no ve plaka yok", leaks.length === 0, leaks.join(", "));
check("yalnız beklenen alanlar", Object.keys(p).sort().join() === "companyVerified,completedJobs,id,memberSince,rating,ratingCount,title,vehicles,verificationLevel", Object.keys(p).join());

console.log("\nSilinen araç sayılmaz; askı ve kapatma");
await api("DELETE", `/vehicles/${veh[1].id}`, C);
r = await profile();
check("silinen tır düşer, frigo gider", JSON.stringify(r.body.vehicles?.[0]) === JSON.stringify({ vehicleType: "tir", count: 1, bodyTypes: ["tenteli"] }), JSON.stringify(r.body.vehicles));
psql(`update users set status='askida' where phone='${phone(1)}'`);
check("askıdaki hesap 404", (await profile()).status === 404);
psql(`update users set status='aktif' where phone='${phone(1)}'`);
check("askı kalkınca yine 200", (await profile()).status === 200);
r = await api("PATCH", "/companies", C, { publicProfile: false });
check("nakliyeci kapatır: 200, sonra 404", r.status === 200 && r.body.publicProfile === false && (await profile()).status === 404);

console.log("\nYük sahibi açamaz");
const s = await login(phone(2));
const S = (await api("POST", "/me/roles", s.accessToken, { roles: ["shipper"] })).body.accessToken;
const sc = (await api("POST", "/companies", S, { title: `Yük Sahibi ${run}` })).body;
r = await api("PATCH", "/companies", S, { publicProfile: true });
check("yük sahibi 403, Türkçe mesaj", r.status === 403 && r.body.message === "Herkese açık profil yalnız nakliyeciler içindir", r.text.slice(0, 200));
check("yük sahibinin firması kapalı kaldı", psql(`select public_profile from companies where id='${sc.id}'`) === "f");
// Zorla açılmış olsa bile nakliyeci olmayanın profili görünmez
psql(`update companies set public_profile=true where id='${sc.id}'`);
check("nakliyeci rolü yoksa 404", (await api("GET", `/public/carriers/${sc.id}`)).status === 404);
psql(`update companies set public_profile=false where id='${sc.id}'`);

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
child.kill();
process.exit(fail ? 1 : 0);
