// Yük ilanı modülü uçtan uca test (docs/03 BR-01…BR-11, FR-10…FR-21).
// Ön koşul: Docker'da nakliye-db-1 çalışıyor, seed yapılmış, API SMS_PROVIDER=console ile çalışıyor ve çıktısı bir dosyaya yazılıyor
// (OTP kodları oradan okunur). Test, veritabanına test kullanıcıları ve ilanlar ekler.
// Kullanım (apps/api içinden): node dist/main.js > api.log 2>&1 &   sonra   node test/e2e-loads.mjs api.log
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { corridorEstimate, roadEstimate } from "@nakliye/shared";
import { adminSession } from "./lib/admin.mjs";

const LOG = process.argv[2];
const B = "http://localhost:3000/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (q) => execFileSync("docker", ["exec", "nakliye-db-1", "psql", "-U", "nakliye", "-d", "nakliye", "-tAc", q]).toString().trim();

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
  const codes = [...readFileSync(LOG, "utf8").matchAll(/\[SMS → (\+\d+)\] Seferna giriş kodunuz: (\d{6})/g)].filter((m) => m[1] === phone);
  const code = codes.at(-1)[2];
  const r = await api("POST", "/auth/otp/verify", null, { phone, code });
  return r.body;
}

async function userWithRoles(phone, roles) {
  const t = await login(phone);
  if (!roles.length) return t.accessToken;
  const r = await api("POST", "/me/roles", t.accessToken, { roles });
  return r.body.accessToken;
}

const trDay = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

// ── Hazırlık ──────────────────────────────────────────────────────
// 4 haneli kimlik eski bir çalıştırmayla çakışabiliyor (aynı numaralar/plakalar): DB'de boş olana kadar yeniden üretilir
let run;
do run = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
while (psql(`select count(*) from users where phone like '+90555${run}%'`) !== "0");
const phone = (n) => `+90555${run}${String(n).padStart(3, "0")}`;
const S = await userWithRoles(phone(1), ["shipper"]);
const S2 = await userWithRoles(phone(2), ["shipper"]);
const C = await userWithRoles(phone(3), ["carrier"]);
// Yönetici: rol elle verilir, sonra refresh ile yeni belirteç alınır
const adminLogin = await login(phone(4));
const adminId = psql(`select id from users where phone='${phone(4)}'`);
psql(`insert into user_roles(user_id, role) values ('${adminId}','admin') on conflict do nothing`);
const A = (await adminSession(api, adminLogin.accessToken)).accessToken; // NFR-04: yönetici rolü ikinci adımla

const locs = (await api("GET", "/locations")).body;
const district = (prov, name) => locs.find((p) => p.name === prov).districts.find((d) => d.name === name).id;
const KONAK = district("İzmir", "Konak"), EFELER = district("Aydın", "Efeler");

const base = {
  originDistrictId: KONAK, destDistrictId: EFELER, loadFrom: trDay(1), loadTo: trDay(3),
  cargoType: "palet", weightTon: 12, vehicleType: "tir", bodyType: null, priceType: "sabit", price: 15000, note: "Forklift var",
};

console.log("\nKonum listesi");
check("81 il, 973 ilçe", locs.length === 81 && locs.reduce((a, p) => a + p.districts.length, 0) === 973);
check("ilçe kimliği = plaka×100 + sıra (Konak 35xx, Efeler 9xx)", Math.floor(KONAK / 100) === 35 && Math.floor(EFELER / 100) === 9, `Konak=${KONAK} Efeler=${EFELER}`);

console.log("\nOluşturma ve doğrulama");
check("geçmiş tarih 400", (await api("POST", "/loads", S, { ...base, loadFrom: trDay(-3), loadTo: trDay(-2) })).status === 400);
check("olmayan ilçe 400", (await api("POST", "/loads", S, { ...base, originDistrictId: 99999 })).status === 400);
const zr = await api("POST", "/loads", S, { ...base, weightTon: "on iki", cargoType: "yok", originDistrictId: undefined });
const msg = Object.fromEntries((zr.body.errors ?? []).map((e) => [e.path, e.message]));
check("doğrulama mesajları Türkçe (zod haritası)", zr.status === 400 && msg.weightTon === "Sayı girin" && msg.cargoType === "Listeden bir seçenek seçin" && msg.originDistrictId === "Bu alan zorunlu", JSON.stringify(zr.body));
check("nakliyeci ilan veremez 403", (await api("POST", "/loads", C, base)).status === 403);
let r = await api("POST", "/loads", S, base);
const L1 = r.body.id;
check("ilk ilan moderasyonda (BR-11)", r.status === 201 && r.body.status === "moderasyonda" && r.body.moderation === "bekliyor", JSON.stringify(r.body).slice(0, 200));
check("il/ilçe adları ve paylaşım kimliği var", r.body.origin?.district === "Konak" && r.body.dest?.province === "Aydın" && r.body.shareId?.length === 10);
check("telefon yanıtta yok", !JSON.stringify(r.body).includes("+90"));

console.log("\nModerasyondaki ilan");
check("nakliyeci aramada görmez (tüm sayfalar)", !(await findAll("")));
check("nakliyeci detayda 404", (await api("GET", `/loads/${L1}`, C)).status === 404);
check("sahibi İlanlarım'da görür", (await api("GET", "/loads/mine", S)).body.items.some((l) => l.id === L1));
check("moderasyonda teyit 409", (await api("POST", `/loads/${L1}/confirm`, S, { answer: "gecerli" })).status === 409);
check("yönetici olmayan kuyruğa erişemez 403", (await api("GET", "/admin/loads", S)).status === 403);
// Kuyruk en eskiden başlar ve sayfalıdır: DB'de başka takımların bekleyen ilanları varsa yeni ilan sonraki sayfalarda
let queued;
for (let pg = 1; pg <= 50 && !queued; pg++) {
  r = await api("GET", `/admin/loads?page=${pg}`, A);
  queued = r.body.items?.find((l) => l.id === L1);
  if (!r.body.hasMore) break;
}
check("yönetici kuyrukta görür + telefon", queued?.shipperPhone === phone(1), JSON.stringify(r.body).slice(0, 120));
r = await api("POST", `/admin/loads/${L1}/review`, A, { decision: "onay" });
check("onay → teyitli", r.body.status === "teyitli" && r.body.moderation === "onay");

console.log("\nArama filtreleri");
/** Tüm sayfaları tarar: önceki test çalıştırmalarının ilanları L1'i ilk sayfadan itebilir. */
async function findAll(qs, id = L1) {
  for (let page = 1; page <= 100; page++) {
    const body = (await api("GET", `/loads?${qs}${qs ? "&" : ""}page=${page}`, C)).body;
    const hit = body.items?.find((l) => l.id === id);
    if (hit || !body.hasMore) return hit;
  }
}
const has = async (qs) => Boolean(await findAll(qs));
check("filtresiz bulunur", await has(""));
check("fromProvinceId=35 bulunur, =9 bulunmaz", (await has("fromProvinceId=35")) && !(await has("fromProvinceId=9")));
check("toProvinceId=9 bulunur", await has("toProvinceId=9"));
check("tarih aralık içinde bulunur, dışında bulunmaz", (await has(`date=${trDay(2)}`)) && !(await has(`date=${trDay(5)}`)));
check("araç tipi uyuşmazsa bulunmaz (kamyonet tır yükünü taşıyamaz)", !(await has("vehicleType=kamyonet")));
check("kasa tipi belirtilmemiş yük her kasaya uyar", await has("bodyType=frigo"));
check("tonaj sınırı", (await has("maxWeightTon=20")) && !(await has("maxWeightTon=10")));
const nearItem = await findAll("near=38.42,27.13&radiusKm=20");
check("Konak yakınında bulunur + mesafe", nearItem && nearItem.distanceKm < 5, JSON.stringify(nearItem?.distanceKm));
check("Aydın yakınında (20 km) bulunmaz", !(await has("near=37.85,27.84&radiusKm=20")));
check("bozuk konum 400", (await api("GET", "/loads?near=99,27", C)).status === 400);

console.log("\nDüzenleme");
check("kalkış değiştirilemez 400", (await api("PATCH", `/loads/${L1}`, S, { originDistrictId: EFELER })).status === 400);
check("ters tarih 400", (await api("PATCH", `/loads/${L1}`, S, { loadTo: trDay(0) , loadFrom: trDay(2)})).status === 400);
check("sabit fiyatta fiyat silinemez 400", (await api("PATCH", `/loads/${L1}`, S, { price: null })).status === 400);
check("başka yük sahibi 404", (await api("PATCH", `/loads/${L1}`, S2, { note: "x" })).status === 404);
const before = (await api("GET", `/loads/${L1}`, S)).body.lastConfirmedAt;
await sleep(50);
r = await api("PATCH", `/loads/${L1}`, S, { priceType: "teklif", price: null, note: null });
check("teklif usulüne geçiş + not silme", r.status === 200 && r.body.priceType === "teklif" && r.body.price === null && r.body.note === null, JSON.stringify(r.body).slice(0, 200));
check("düzenleme teyit sayılır (son teyit yenilendi)", r.body.lastConfirmedAt > before);

console.log("\nTeyit (hatırlatma simülasyonu)");
psql(`update load_posts set status='teyit_bekliyor', reminder_sent_at=now()-interval '5 hours' where id='${L1}'`);
psql(`insert into load_confirmations(load_post_id, asked_at) values ('${L1}', now()-interval '5 hours')`);
check("teyit bekliyor hâlâ aramada (altta)", await has(""));
r = await api("POST", `/loads/${L1}/confirm`, S, { answer: "gecerli" });
check("'Evet' → teyitli, hatırlatma sıfırlandı", r.body.status === "teyitli" && r.body.reminderSentAt === null);
const conf = psql(`select answer||'|'||channel||'|'||(answered_at is not null) from load_confirmations where load_post_id='${L1}'`);
check("açık soru cevaplandı olarak kaydedildi", conf === "gecerli|app|true", conf);
await api("POST", `/loads/${L1}/confirm`, S, { answer: "gecerli" });
check("kendiliğinden teyit ek kayıt açmaz", psql(`select count(*) from load_confirmations where load_post_id='${L1}'`) === "1");

console.log("\nBR-11: onaylı ilan sayısı");
const ids = [];
for (let i = 0; i < 2; i++) {
  r = await api("POST", "/loads", S, base);
  ids.push(r.body.id);
  check(`${i + 2}. ilan moderasyonda`, r.body.status === "moderasyonda");
  await api("POST", `/admin/loads/${r.body.id}/review`, A, { decision: "onay" });
}
r = await api("POST", "/loads", S, base);
check("3 onaydan sonra 4. ilan doğrudan teyitli", r.body.status === "teyitli" && r.body.moderation === null, JSON.stringify(r.body).slice(0, 120));
r = await api("POST", "/loads", S2, base);
await api("POST", `/admin/loads/${r.body.id}/review`, A, { decision: "ret" });
check("ret → iptal", (await api("GET", `/loads/${r.body.id}`, S2)).body.status === "iptal");
r = await api("POST", "/loads", S2, base);
check("reddedilen ilan muafiyete sayılmaz", r.body.status === "moderasyonda");
const late = r.body.id;
psql(`update load_posts set load_from=current_date-3, load_to=current_date-2 where id='${late}'`);
r = await api("POST", `/admin/loads/${late}/review`, A, { decision: "onay" });
check("tarihi geçmiş ilan onaylanınca süresi doldu", r.body.status === "suresi_doldu" && r.body.moderation === "onay", JSON.stringify(r.body).slice(0, 160));
check("ikinci kez inceleme 409", (await api("POST", `/admin/loads/${late}/review`, A, { decision: "onay" })).status === 409);

console.log("\nKapatma");
r = await api("POST", `/loads/${L1}/close`, S, { reason: "arac_bulundu" });
check("araç bulundu → kapandı", r.body.status === "kapandi");
check("kapalı ilan teyit 409", (await api("POST", `/loads/${L1}/confirm`, S, { answer: "gecerli" })).status === 409);
check("kapalı ilan düzenleme 409", (await api("PATCH", `/loads/${L1}`, S, { note: "x" })).status === 409);
check("kapalı ilan nakliyeciye 404", (await api("GET", `/loads/${L1}`, C)).status === 404);
check("geçersiz uuid 400", (await api("GET", `/loads/abc`, C)).status === 400);

console.log("\nAraç büyüklüğü (büyük araç küçük yükü taşır)");
// Filtredeki tip nakliyecinin aracı: büyük araç küçük tip isteyen ilanı da görür
const Lk = (await api("POST", "/loads", S, { ...base, vehicleType: "kamyon", weightTon: 8 })).body.id;
if (psql(`select status from load_posts where id='${Lk}'`) === "moderasyonda") await api("POST", `/admin/loads/${Lk}/review`, A, { decision: "onay" });
check("tır filtresi kamyon isteyen ilanı da gösterir, kamyonet filtresi göstermez", Boolean(await findAll("vehicleType=tir", Lk)) && !(await findAll("vehicleType=kamyonet", Lk)));
psql(`update load_posts set status='iptal' where id='${Lk}'`);

console.log("\nFiyat aralığı (F7)");
check("girişsiz 401", (await api("GET", `/price-estimate?from=${KONAK}&to=${EFELER}&vehicleType=tir`)).status === 401);
r = await api("GET", `/price-estimate?from=${KONAK}&to=${EFELER}&vehicleType=tir`, C);
const straight = Number(psql(`select ST_Distance(o.geom::geography, d.geom::geography) / 1000 from districts o, districts d where o.id=${KONAK} and d.id=${EFELER}`));
// Kaynak: OSRM çalışıyorsa karayolu (önbelleğe yazılır), yoksa kuş uçuşu × katsayı
const cached = () => psql(`select distance_m from district_routes where origin_district_id=${KONAK} and dest_district_id=${EFELER}`);
const want = r.body.source === "karayolu" ? roadEstimate(Number(cached()) / 1000, "tir") : corridorEstimate(straight, "tir");
check(`Konak → Efeler tır (${r.body.source}): shared formülüyle aynı aralık`, r.status === 200 && ["karayolu", "kus_ucusu"].includes(r.body.source) && r.body.distanceKm === want.distanceKm && r.body.min === want.min && r.body.max === want.max && r.body.approximate === true, JSON.stringify([r.body, want]));
check("karayolu kaynağında mesafe önbellekte ve kuş uçuşundan uzun", r.body.source !== "karayolu" || (cached() !== "" && r.body.distanceKm > straight), `${r.body.distanceKm} / ${straight}`);
console.log(`  (kaynak: ${r.body.source}, ${r.body.distanceKm} km)`);
check("mesafe makul (90–200 km) ve aralık sıralı", r.body.distanceKm > 90 && r.body.distanceKm < 200 && r.body.min < r.body.max, JSON.stringify(r.body));
check("kamyonet tırdan ucuz", (await api("GET", `/price-estimate?from=${KONAK}&to=${EFELER}&vehicleType=kamyonet`, C)).body.max < r.body.max);
r = await api("GET", `/price-estimate?from=${KONAK}&to=${EFELER}&vehicleType=ucak`, C);
check("geçersiz araç tipi 400 (Türkçe)", r.status === 400 && r.body.errors?.[0]?.message === "Listeden bir seçenek seçin", JSON.stringify(r.body));
check("olmayan ilçe 404", (await api("GET", `/price-estimate?from=99999&to=${EFELER}&vehicleType=tir`, C)).status === 404);

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail ? 1 : 0;
