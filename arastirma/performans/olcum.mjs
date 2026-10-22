// NFR-01 performans ölçümü: "yük listesi API'si p95 < 300 ms (10.000 aktif ilanda); eşleşme bildirimi ilan yayınından
// itibaren < 60 sn". Geliştirme veritabanı kirlenmesin diye en son yedek (npm run db:backup) ayrı bir veritabanına
// (nakliye_perf) geri yüklenir, sentetik ilanlar oraya yazılır ve ona bağlı ikinci bir API (3200) ölçülür.
//
//   node arastirma/performans/olcum.mjs [--ilan=10000] [--istek=300] [--es=10] [--deneme=20] [--sakla]
//
// Ön koşul: Docker'da DB, apps/api derlenmiş (dist), en az bir yedek (backups/). Sonuçlar arastirma/performans/sonuclar/.
// Ölçülen süre istemci tarafı uçtan uca: istek gönderimi + API + veritabanı + gövdenin okunması (aynı makine, ağ yok).
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, totalmem } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (k, d) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
const LOADS = arg("ilan", 10_000), REQUESTS = arg("istek", 300), CONC = arg("es", 10), TRIALS = arg("deneme", 20);
const KEEP = process.argv.includes("--sakla");
const CONTAINER = "nakliye-db-1", DB = "nakliye_perf", PORT = 3200;
const B = `http://localhost:${PORT}/api/v1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const psql = (sql, db = DB) => {
  const r = spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "nakliye", "-d", db, "-v", "ON_ERROR_STOP=1", "-tA"], { input: sql, encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`psql: ${r.stderr}`);
  return r.stdout.trim();
};

// ── 1. Veritabanı: son yedekten geri yükle ───────────────────────────
function restore() {
  const dir = join(ROOT, "backups");
  const latest = existsSync(dir) ? readdirSync(dir).filter((n) => /^nakliye-.*Z$/.test(n) && existsSync(join(dir, n, "manifest.json"))).sort().at(-1) : undefined;
  if (!latest) throw new Error("Yedek yok: önce cd apps/api && npm run db:backup");
  psql(`drop database if exists ${DB}`, "nakliye");
  psql(`create database ${DB}`, "nakliye");
  return new Promise((ok, fail) => {
    const c = spawn("docker", ["exec", "-i", CONTAINER, "pg_restore", "-U", "nakliye", "-d", DB, "--no-owner", "--exit-on-error"]);
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => (code === 0 ? ok(latest) : fail(new Error(err))));
    createReadStream(join(dir, latest, "db.dump")).pipe(c.stdin);
  });
}

// ── 2. Sentetik veri ─────────────────────────────────────────────────
function seed() {
  // Önce mevcut aktif ilanlar/boş araçlar kapatılır: ölçüm yalnız sentetik 10.000 ilanla yapılsın
  psql(`update load_posts set status = 'kapandi' where status in ('teyitli', 'teyit_bekliyor', 'moderasyonda');
        update capacity_posts set status = 'doldu' where status = 'aktif';`);
  psql(`
    -- 500 yük sahibi (+90599…), 1.000 nakliyeci (+90598…)
    insert into users (phone, name, trust_score, verification_level)
      select '+90599' || lpad(g::text, 7, '0'), 'Perf Yük Sahibi ' || g, 0.3 + random() * 0.6, (random() < 0.4)::int from generate_series(1, 500) g;
    insert into users (phone, name, trust_score) select '+90598' || lpad(g::text, 7, '0'), 'Perf Nakliyeci ' || g, 0.3 + random() * 0.6 from generate_series(1, 1000) g;
    insert into user_roles (user_id, role) select id, 'shipper' from users where phone like '+90599%';
    insert into user_roles (user_id, role) select id, 'carrier' from users where phone like '+90598%';

    -- İlçeler: yarısı başlangıç koridorundan (Aydın, İzmir, Manisa, İstanbul), yarısı Türkiye geneli
    create temp table d_all as select id, geom, row_number() over (order by id) n from districts;
    create temp table d_cor as select d.id, d.geom, row_number() over (order by d.id) n from districts d where d.province_id in (9, 35, 45, 34);
    create temp table shippers as select id, row_number() over (order by phone) n from users where phone like '+90599%';
    select setseed(0.42);
    insert into load_posts (share_id, shipper_id, origin_district_id, origin_geom, dest_district_id, dest_geom, load_from, load_to,
                            cargo_type, weight_ton, vehicle_type, body_type, price_type, price, status, last_confirmed_at, next_reminder_at, moderation, matched_at)
    select substr(md5(random()::text || g), 1, 10),
           (select id from shippers where n = 1 + (g % 500)),
           o.id, o.geom, d.id, d.geom,
           current_date + f, current_date + f + (random() * 2)::int,
           (array['genel','palet','dokme','insaat','gida','soguk_zincir','makine','tarim'])[1 + (random() * 7)::int]::cargo_type,
           round((1 + random() * 24)::numeric, 1),
           (array['tir','kirkayak','kamyon','kamyonet','panelvan'])[1 + (random() * 4)::int]::vehicle_type,
           case when random() < 0.5 then null else (array['tenteli','acik','kapali','frigo','damper'])[1 + (random() * 4)::int]::body_type end,
           case when random() < 0.6 then 'teklif'::price_type else 'sabit'::price_type end,
           case when random() < 0.6 then null else round((3000 + random() * 40000)::numeric, -2) end,
           case when random() < 0.9 then 'teyitli'::load_status else 'teyit_bekliyor'::load_status end,
           now() - random() * interval '20 hours', now() + interval '24 hours', 'onay'::review_status, now()
    from generate_series(1, ${LOADS}) g
    cross join lateral (select (random() * 10)::int f, random() < 0.5 cor) x
    cross join lateral (select id, geom from d_all where x.cor = false and n = 1 + ((g::bigint * 7919) % (select count(*) from d_all))
                        union all select id, geom from d_cor where x.cor and n = 1 + ((g::bigint * 104729) % (select count(*) from d_cor)) limit 1) o
    cross join lateral (select id, geom from d_all where n = 1 + ((g::bigint * 15485863) % (select count(*) from d_all))) d;

    -- 1.000 araç ve boş araç ilanı (eşleştirmenin karşı tarafı)
    insert into vehicles (owner_user_id, plate, vehicle_type, body_type, capacity_ton)
      select id, 'PF' || lpad(row_number() over (order by phone)::text, 6, '0'), (array['tir','kirkayak','kamyon','kamyonet','panelvan'])[1 + (random() * 4)::int]::vehicle_type,
             (array['tenteli','acik','kapali','frigo','damper'])[1 + (random() * 4)::int]::body_type, round((3 + random() * 22)::numeric, 1)
      from users where phone like '+90598%';
    insert into capacity_posts (carrier_id, vehicle_id, origin_district_id, origin_geom, available_from, available_to, matched_at)
      select v.owner_user_id, v.id, d.id, d.geom, current_date, current_date + 5, now()
      from vehicles v join lateral (select id, geom from d_all where n = 1 + ((abs(hashtext(v.id::text)::bigint)) % (select count(*) from d_all))) d on true
      where v.plate like 'PF%';
    analyze;
  `);
  return Object.fromEntries(psql(`select status, count(*) from load_posts where status in ('teyitli','teyit_bekliyor') group by 1`).split("\n").map((l) => l.split("|")));
}

// ── 3. Ölçülen API ───────────────────────────────────────────────────
function startApi() {
  const env = { ...process.env, PORT: String(PORT), DATABASE_URL: `postgres://nakliye:nakliye@localhost:5432/${DB}`, JOBS_ENABLED: "false", SMS_PROVIDER: "console", OTP_PHONE_DAILY_LIMIT: "0", OTP_IP_HOURLY_LIMIT: "0", NO_COLOR: "1", DEMO_PHONE: "" };
  const child = spawn(process.execPath, ["dist/main.js"], { cwd: join(ROOT, "apps", "api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const s = { child, out: "" };
  child.stdout.on("data", (d) => (s.out += d));
  child.stderr.on("data", (d) => (s.out += d));
  return s;
}
async function waitUp(s) {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${B}/health`)).ok) return; } catch { /* açılıyor */ }
    await sleep(200);
  }
  throw new Error(`API açılmadı:\n${s.out}`);
}
const api = async (method, path, token, body) => {
  const r = await fetch(B + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
async function login(s, phone, roles) {
  await api("POST", "/auth/otp/request", null, { phone });
  let code;
  for (let i = 0; i < 50 && !code; i++) {
    code = [...s.out.matchAll(/\[SMS → (\+\d+)\] Nakliye giriş kodunuz: (\d{6})/g)].filter((m) => m[1] === phone).at(-1)?.[2];
    if (!code) await sleep(50);
  }
  const t = (await api("POST", "/auth/otp/verify", null, { phone, code })).body;
  return roles ? (await api("POST", "/me/roles", t.accessToken, { roles })).body.accessToken : t.accessToken;
}

// ── 4. Ölçüm ─────────────────────────────────────────────────────────
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
async function measure(token, makePath) {
  const times = [];
  let errors = 0, i = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < REQUESTS) {
      const path = makePath(i++);
      const t0 = performance.now();
      const r = await fetch(B + path, { headers: { authorization: `Bearer ${token}` } });
      const body = await r.text();
      times.push(performance.now() - t0);
      if (r.status !== 200 || !body.startsWith("{")) errors++;
    }
  }));
  const wall = (performance.now() - started) / 1000;
  const s = [...times].sort((a, b) => a - b);
  const r1 = (x) => Math.round(x * 10) / 10;
  return { n: times.length, errors, p50: r1(pct(s, 50)), p95: r1(pct(s, 95)), p99: r1(pct(s, 99)), max: r1(s.at(-1)), mean: r1(s.reduce((a, b) => a + b, 0) / s.length), rps: Math.round(times.length / wall) };
}

const day = (o) => new Date(Date.now() + 3 * 3600e3 + o * 86400e3).toISOString().slice(0, 10);
const scenarios = [
  ["Filtresiz ilk sayfa", () => "/loads"],
  ["Kalkış ili (İzmir)", () => "/loads?fromProvinceId=35"],
  ["Varış ili + araç tipi (İstanbul, tır)", () => "/loads?toProvinceId=34&vehicleType=tir"],
  ["Yükleme günü", () => `/loads?date=${day(3)}`],
  ["Yakınımdakiler (İzmir Konak, 50 km)", () => "/loads?near=38.4192,27.1287&radiusKm=50"],
  ["Derin sayfa (5. sayfa)", () => "/loads?page=5"],
  ["Karma (her istekte farklı süzgeç)", (i) => ["/loads", "/loads?fromProvinceId=9", "/loads?toProvinceId=45&maxWeightTon=10", `/loads?date=${day(i % 7)}`, "/loads?near=37.85,27.84&radiusKm=80", "/loads?vehicleType=kamyon&page=2"][i % 6]],
];

/** Eşleşme bildirimi gecikmesi: her denemede ayrı ilçede ayrı nakliyecinin boş aracı; ilan yayınlanınca matches.notified_at'e kadar */
async function matchingLatency(s, shipperToken) {
  const districts = psql(`select distinct on (province_id) id from districts where province_id not in (9, 35, 45, 34) order by province_id, id limit ${TRIALS}`).split("\n").map(Number);
  const out = [];
  for (let i = 0; i < districts.length; i++) {
    const carrier = await login(s, `+90597${String(i).padStart(7, "0")}`, ["carrier"]);
    const v = (await api("POST", "/vehicles", carrier, { plate: `34 PF ${String(i).padStart(3, "0")}`, vehicleType: "kamyon", bodyType: "kapali", capacityTon: 15 })).body.id;
    const k = (await api("POST", "/capacity", carrier, { vehicleId: v, originDistrictId: districts[i], destDistrictId: null, availableFrom: day(1), availableTo: day(5) })).body.id;
    const t0 = performance.now();
    const l = (await api("POST", "/loads", shipperToken, {
      originDistrictId: districts[i], destDistrictId: districts[(i + 1) % districts.length], loadFrom: day(2), loadTo: day(3), cargoType: "genel",
      weightTon: 5, vehicleType: "kamyon", bodyType: null, priceType: "teklif", price: null,
    })).body;
    if (l?.status !== "teyitli") throw new Error(`İlan doğrudan yayına çıkmadı: ${JSON.stringify(l)}`);
    let ms = null;
    for (let w = 0; w < 1200 && ms === null; w++) {
      if (psql(`select count(*) from matches where load_post_id='${l.id}' and capacity_post_id='${k}' and notified_at is not null`) === "1") ms = performance.now() - t0;
      else await sleep(50);
    }
    out.push(ms === null ? null : Math.round(ms));
  }
  return out;
}

// ── Akış ─────────────────────────────────────────────────────────────
const t0 = Date.now();
console.log(`Yedekten geri yükleniyor → ${DB}…`);
const backup = await restore();
console.log(`Sentetik veri: ${LOADS} ilan, 500 yük sahibi, 1.000 nakliyeci/araç/boş araç…`);
const active = seed();
console.log(`  aktif ilan: ${JSON.stringify(active)}`);
const s = startApi();
let result;
try {
  await waitUp(s);
  const carrier = await login(s, "+905961234567", ["carrier"]);
  for (let i = 0; i < 30; i++) await fetch(`${B}/loads?page=${1 + (i % 3)}`, { headers: { authorization: `Bearer ${carrier}` } }); // ısınma
  const rows = [];
  for (const [name, make] of scenarios) {
    const m = await measure(carrier, make);
    rows.push({ name, ...m });
    console.log(`  ${name.padEnd(40)} p50 ${m.p50} ms · p95 ${m.p95} ms · p99 ${m.p99} ms · ${m.rps} istek/sn${m.errors ? ` · HATA ${m.errors}` : ""}`);
  }
  // Önceden onaylı ilanı olan (BR-11 muaf) sentetik yük sahibi: ilan doğrudan yayına çıkar
  const shipper = await login(s, "+905990000001");
  const matching = await matchingLatency(s, shipper);
  const ok = matching.filter((x) => x !== null).sort((a, b) => a - b);
  console.log(`  eşleşme bildirimi (${matching.length} deneme): ${ok.length ? `en az ${ok[0]} ms · ortanca ${pct(ok, 50)} ms · en çok ${ok.at(-1)} ms` : "yok"}${ok.length < matching.length ? ` · ${matching.length - ok.length} denemede 60 sn içinde yok` : ""}`);
  result = {
    olcumTarihi: new Date().toISOString(),
    yedek: backup,
    ortam: { cpu: cpus()[0]?.model, cekirdek: cpus().length, belllekGB: Math.round(totalmem() / 2 ** 30), node: process.version, es: CONC, istek: REQUESTS },
    aktifIlan: active,
    listeleme: rows,
    eslesmeBildirimiMs: matching,
    nfr01: { listeP95Hedef: 300, listeP95EnKotu: Math.max(...rows.map((r) => r.p95)), eslesmeHedefMs: 60_000, eslesmeEnKotuMs: ok.at(-1) ?? null },
    sureSn: Math.round((Date.now() - t0) / 1000),
  };
} finally {
  s.child.kill();
  if (!KEEP) psql(`drop database if exists ${DB}`, "nakliye");
}
const outDir = join(ROOT, "arastirma", "performans", "sonuclar");
mkdirSync(outDir, { recursive: true });
// Aynı gün ikinci ölçüm öncekinin üzerine yazmasın
let file = join(outDir, `olcum-${result.olcumTarihi.slice(0, 10)}.json`);
for (let i = 2; existsSync(file); i++) file = join(outDir, `olcum-${result.olcumTarihi.slice(0, 10)}-${i}.json`);
writeFileSync(file, JSON.stringify(result, null, 2));
console.log(`NFR-01: liste p95 en kötü ${result.nfr01.listeP95EnKotu} ms (hedef < 300) · eşleşme bildirimi en kötü ${result.nfr01.eslesmeEnKotuMs} ms (hedef < 60.000)\nSonuç: ${file}`);
