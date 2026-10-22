// FR-54 parametre yönetimi (teyit aralıkları, eşleştirme yarıçapı/toleransı/ağırlıkları, F7 fiyat katsayıları) —
// uçtan uca test: yetki, doğrulama (alan yolu + Türkçe mesaj), etki (yeni ilanın teyit zamanı, eşleşme, fiyat tahmini),
// işlem kaydı (eski → yeni farkı), varsayılana dönüş. Ayarlar küresel: test her durumda varsayılana döndürür (finally).
// Yalıtım: Iğdır (Merkez, Karakoyunlu, Aralık) ve +90537… numaraları. Kullanım: e2e-confirmation.mjs ile aynı.
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
const lastCode = (phone) =>
  [...log().matchAll(/\[SMS → (\+\d+)\] Seferna giriş kodunuz: (\d{6})/g)].filter((m) => m[1] === phone).at(-1)?.[2];
async function login(phone) {
  await api("POST", "/auth/otp/request", null, { phone });
  await sleep(300);
  return (await api("POST", "/auth/otp/verify", null, { phone, code: lastCode(phone) })).body;
}
const user = async (phone, roles) => (await api("POST", "/me/roles", (await login(phone)).accessToken, { roles })).body.accessToken;
const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90537${run}%'`) !== "0");
const phone = (n) => `+90537${run}${String(n).padStart(3, "0")}`;

const aLogin = await login(phone(1));
psql(`insert into user_roles(user_id, role) select id, 'admin' from users where phone='${phone(1)}' on conflict do nothing`);
const A = (await adminSession(api, aLogin.accessToken)).accessToken;
const Aid = psql(`select id from users where phone='${phone(1)}'`);
const S = await user(phone(2), ["shipper"]);
const C = await user(phone(3), ["carrier"]);

const locs = (await api("GET", "/locations")).body;
const district = (name) => locs.find((p) => p.name === "Iğdır").districts.find((d) => d.name === name).id;
const MERKEZ = district("Merkez"), KARAKOYUNLU = district("Karakoyunlu"), ARALIK = district("Aralık");
const resetAll = async () => { for (const k of ["confirmation", "matching", "price"]) await api("POST", `/admin/settings/${k}/reset`, A); };
const lastAudit = () => psql(`select action || '|' || admin_id || '|' || coalesce(note, '-') from admin_audit_log where target_type='setting' order by created_at desc limit 1`);

try {
  await resetAll(); // önceki yarım kalmış bir koşudan kalan ayar olmasın
  console.log("\nYetki ve görünüm");
  check("yönetici olmayan göremez (403)", (await api("GET", "/admin/settings", S)).status === 403);
  check("yönetici olmayan değiştiremez (403)", (await api("PUT", "/admin/settings/price", S, {})).status === 403);
  let r = await api("GET", "/admin/settings", A);
  const defaults = r.body.settings;
  check("üç ayar varsayılanında, değer = varsayılan", r.status === 200 && ["confirmation", "matching", "price"].every((k) => defaults[k].isDefault && JSON.stringify(defaults[k].value) === JSON.stringify(defaults[k].defaults)), JSON.stringify(r.body).slice(0, 160));
  check("fiyat önizlemesi: 500 km, beş araç tipi, büyükten küçüğe", r.body.pricePreview?.length === 5 && r.body.pricePreview[0].vehicleType === "tir" && r.body.pricePreview.every((p) => p.min > 0 && p.max >= p.min));
  check("bilinmeyen ayar 404", (await api("PUT", "/admin/settings/yok", A, {})).status === 404);

  console.log("\nDoğrulama: alan yolu ve Türkçe mesaj; geçersiz kayıt yazılmaz");
  const conf = defaults.confirmation.value, match = defaults.matching.value, price = defaults.price.value;
  r = await api("PUT", "/admin/settings/confirmation", A, { ...conf, reminderIntervalH: 8, loadDayIntervalH: 12 });
  check("yükleme günü aralığı normalden uzun olamaz (400)", r.status === 400 && r.body.errors?.some((e) => e.path === "loadDayIntervalH" && e.message === "Yükleme günü aralığı normal aralıktan uzun olamaz"), JSON.stringify(r.body));
  r = await api("PUT", "/admin/settings/matching", A, { ...match, weights: { ...match.weights, trust: 0.9 } });
  check("ağırlık toplamı 1 değilse 400", r.status === 400 && r.body.errors?.some((e) => e.path === "weights" && e.message === "Ağırlıkların toplamı 1 olmalı"), JSON.stringify(r.body));
  r = await api("PUT", "/admin/settings/price", A, { ...price, vehicles: { ...price.vehicles, tir: { ...price.vehicles.tir, fuelLitersPer100Km: 0 } } });
  check("araç bazında alan hatası (400)", r.status === 400 && r.body.errors?.some((e) => e.path === "vehicles.tir.fuelLitersPer100Km" && e.message === "Tır yakıt tüketimi en az 1"), JSON.stringify(r.body));
  check("eksik nesne 400", (await api("PUT", "/admin/settings/price", A, { fuelPricePerLiter: 70 })).status === 400);
  check("geçersizlerden hiçbiri kaydedilmedi", psql("select count(*) from settings") === "0");

  console.log("\nFiyat katsayıları tahmini hemen değiştirir; fark işlem kaydında");
  const est = async () => (await api("GET", `/price-estimate?from=${MERKEZ}&to=${ARALIK}&vehicleType=kamyon`, S)).body;
  const before = await est();
  r = await api("PUT", "/admin/settings/price", A, { ...price, fuelPricePerLiter: price.fuelPricePerLiter * 2 });
  const after = await est();
  check("yakıt fiyatı iki katı: aralık yükseldi", r.status === 200 && after.min > before.min && after.max > before.max, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  check("görünümde değişti, varsayılan değil, son değiştiren yönetici", r.body.settings.price.isDefault === false && r.body.settings.price.value.fuelPricePerLiter === price.fuelPricePerLiter * 2 && typeof r.body.settings.price.updatedAt === "string");
  check("işlem kaydı: ayar_degisikligi, yönetici, okunur ad ve eski → yeni", lastAudit() === `ayar_degisikligi|${Aid}|Fiyat aralığı: Motorin fiyatı (₺/L): ${price.fuelPricePerLiter} → ${price.fuelPricePerLiter * 2}`, lastAudit());
  const auditCount = psql("select count(*) from admin_audit_log where target_type='setting'");
  await api("PUT", "/admin/settings/price", A, { ...price, fuelPricePerLiter: price.fuelPricePerLiter * 2 });
  check("aynı değer yeniden kaydedilince kayıt yazılmaz", psql("select count(*) from admin_audit_log where target_type='setting'") === auditCount);
  r = await api("POST", "/admin/settings/price/reset", A);
  check("varsayılana dönüş: tahmin eski hâline, kayıt ayar_sifirlama", r.status === 200 && r.body.settings.price.isDefault && JSON.stringify(await est()) === JSON.stringify(before) && lastAudit().startsWith(`ayar_sifirlama|${Aid}|Fiyat aralığı: Motorin fiyatı (₺/L): ${price.fuelPricePerLiter * 2} → ${price.fuelPricePerLiter}`), lastAudit());

  console.log("\nTeyit aralığı yeni ilanın sonraki teyit zamanını belirler");
  r = await api("PUT", "/admin/settings/confirmation", A, { ...conf, reminderIntervalH: 12 });
  check("teyit aralığı 12 saat kaydedildi", r.status === 200 && r.body.settings.confirmation.value.reminderIntervalH === 12, JSON.stringify(r.body).slice(0, 160));
  const newLoad = async (originDistrictId, from) => {
    const l = (await api("POST", "/loads", S, {
      originDistrictId, destDistrictId: ARALIK, loadFrom: trDay(from), loadTo: trDay(from + 1), cargoType: "genel",
      weightTon: 2, vehicleType: "kamyonet", bodyType: null, priceType: "teklif", price: null,
    })).body;
    if (l.status === "moderasyonda") await api("POST", `/admin/loads/${l.id}/review`, A, { decision: "onay" });
    return l.id;
  };
  const L0 = await newLoad(MERKEZ, 5);
  const gapH = Number(psql(`select round(extract(epoch from next_reminder_at - last_confirmed_at) / 3600) from load_posts where id='${L0}'`));
  check("yükleme günü uzak ilan: sonraki teyit 12 saat sonra (varsayılan 24)", gapH === 12, `${gapH} saat`);
  await api("POST", "/admin/settings/confirmation/reset", A);

  console.log("\nEşleştirme yarıçapı: 5 km'de 12 km'deki araç eşleşmez, varsayılanda (50 km) eşleşir");
  const V = (await api("POST", "/vehicles", C, { plate: `76 AY ${run}`, vehicleType: "kamyonet", bodyType: "kapali", capacityTon: 3 })).body.id;
  const K = (await api("POST", "/capacity", C, { vehicleId: V, originDistrictId: MERKEZ, destDistrictId: null, availableFrom: trDay(1), availableTo: trDay(4) })).body.id;
  check("hazırlık: boş araç ilanı (Merkez, her yer)", typeof K === "string");
  const matchedDone = async (loadId) => {
    for (let i = 0; i < 50; i++) {
      if (psql(`select matched_at is not null from load_posts where id='${loadId}'`) === "t") return true;
      await sleep(100);
    }
    return false;
  };
  const pair = (loadId) => psql(`select count(*) from matches where load_post_id='${loadId}' and capacity_post_id='${K}'`);
  await api("PUT", "/admin/settings/matching", A, { ...match, originRadiusKm: 5 });
  const L1 = await newLoad(KARAKOYUNLU, 2);
  check("5 km yarıçapta Karakoyunlu yükü (12 km) eşleşmez", (await matchedDone(L1)) && pair(L1) === "0", pair(L1));
  await api("POST", "/admin/settings/matching/reset", A);
  const L2 = await newLoad(KARAKOYUNLU, 2);
  check("varsayılan yarıçapta aynı yük eşleşir", (await matchedDone(L2)) && pair(L2) === "1", pair(L2));
} finally {
  await resetAll();
}
check("test sonunda ayarlar varsayılanda (kayıt yok)", psql("select count(*) from settings") === "0");
// Temizlik: ilanlar başka takımların listelerine karışmasın
psql(`update load_posts set status='iptal' where status in ('teyitli','teyit_bekliyor','moderasyonda') and shipper_id=(select id from users where phone='${phone(2)}')`);

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
