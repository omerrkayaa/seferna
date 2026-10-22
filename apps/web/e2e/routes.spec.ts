// W2 güzergâh sayfaları (girişsiz, arama motoruna açık): /nakliye/<il>-<il>.
import { expect, test } from "@playwright/test";
import { adminToken, api, apiLogin, phone } from "./helpers";

test.use({ baseURL: "http://localhost:3001" });

interface RouteSummary {
  activeLoads: number;
  distanceKm: number;
  source: "karayolu" | "kus_ucusu";
  estimates: { vehicleType: string; min: number; max: number }[];
}
const summary = async () => (await api<RouteSummary>("GET", "/public/routes/9/34")).body;
const money = new Intl.NumberFormat("tr-TR");
const activeText = (n: number) => (n > 0 ? `Şu an yayında ${n} ilan` : "Şu an yayında ilan yok");

/** Önizleme görseli: og:image adresi 1200×630 PNG döner (PNG imzası ve IHDR'deki ölçü) */
async function expectOgImage(p: import("@playwright/test").Page) {
  const src = await p.locator('meta[property="og:image"]').getAttribute("content");
  expect(src).toBeTruthy();
  const img = await p.request.get(src!);
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toBe("image/png");
  const b = Buffer.from(await img.body());
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1200, 630]);
}

test("güzergâh sayfası: başlık, önizleme etiketleri, ilan sayısı ve fiyat tablosu API ile aynı", async ({ page }) => {
  const s = await summary();
  const res = await page.goto("/nakliye/aydin-istanbul");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aydın – İstanbul nakliye");
  await expect(page).toHaveTitle("Aydın İstanbul nakliye · Seferna");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "http://localhost:3001/nakliye/aydin-istanbul");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Aydın → İstanbul yük taşıma/);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0); // arama motoruna açık (paylaşım sayfasının aksine)
  await expectOgImage(page);
  await expect(page.getByTestId("active-loads")).toHaveText(activeText(s.activeLoads));

  const rows = page.getByTestId("price-table").locator("tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText("Tır");
  for (const [i, e] of s.estimates.entries()) await expect(rows.nth(i)).toContainText(`${money.format(e.min)} ₺ – ${money.format(e.max)} ₺`);
  await expect(page.getByText(`${s.source === "karayolu" ? "Karayolu" : "Yaklaşık"} ${s.distanceKm} km (il merkezleri arası)`)).toBeVisible();

  // Diğer güzergâhlar: önce ters yön, sonra Aydın çıkışlı 7 ve İstanbul varışlı 7 (hepsi değil)
  const others = page.getByRole("navigation", { name: "Diğer güzergâhlar" }).getByRole("link");
  await expect(others).toHaveCount(15);
  await expect(others.first()).toHaveText("İstanbul – Aydın nakliye");
  await expect(page.getByRole("navigation", { name: "Diğer güzergâhlar" }).getByRole("heading", { level: 3 })).toHaveText([
    "Aydın çıkışlı",
    "İstanbul varışlı",
  ]);
  const names = await others.allTextContents();
  expect(new Set(names).size).toBe(15);
  expect(names.slice(1, 8).every((n) => n.startsWith("Aydın – "))).toBe(true);
  expect(names.slice(8).every((n) => n.endsWith(" – İstanbul nakliye"))).toBe(true);
  expect(names).toContain("Aydın – Ankara nakliye");
  expect(names).toContain("Mersin – İstanbul nakliye");
  // Girişsiz "Yük ilanı ver" → giriş, sonra ilan formuna güzergâhın illeriyle döner (Aydın 9 → İstanbul 34)
  await page.getByRole("link", { name: "Yük ilanı ver" }).click();
  await expect(page).toHaveURL(/\/giris\?sonra=%2Fpanel%2Filanlar%2Fyeni%3Fnereden%3D9%26nereye%3D34$/);
});

test("ilan sayısı istek anında: yayına çıkan ilan sayfada görünür, kapanınca düşer", async ({ page }) => {
  const A = await adminToken(906);
  const t = await apiLogin(phone(701));
  const S = (await api("POST", "/me/roles", t.accessToken, { roles: ["shipper"] })).body.accessToken!;
  const locs = (await api<{ name: string; districts: { id: number; name: string }[] }[]>("GET", "/locations")).body;
  const d = (prov: string, name: string) => locs.find((p) => p.name === prov)!.districts.find((x) => x.name === name)!.id;
  const day = (o: number) => new Date(Date.now() + 3 * 3600e3 + o * 86400e3).toISOString().slice(0, 10);

  const before = (await summary()).activeLoads;
  const l = (
    await api<{ id: string; status: string }>("POST", "/loads", S, {
      originDistrictId: d("Aydın", "Nazilli"), destDistrictId: d("İstanbul", "Esenyurt"), loadFrom: day(1), loadTo: day(2),
      cargoType: "genel", weightTon: 12, vehicleType: "tir", bodyType: null, priceType: "teklif", price: null,
    })
  ).body;
  if (l.status === "moderasyonda") await api("POST", `/admin/loads/${l.id}/review`, A, { decision: "onay" });
  await page.goto("/nakliye/aydin-istanbul");
  await expect(page.getByTestId("active-loads")).toHaveText(activeText(before + 1));

  await api("POST", `/loads/${l.id}/close`, S, { reason: "iptal" });
  await page.reload();
  await expect(page.getByTestId("active-loads")).toHaveText(activeText(before));
});

test("listede olmayan güzergâh 404", async ({ page }) => {
  // Görsel alt yolu yalnız listedeki güzergâhta (proxy); başka alt yol da 404
  for (const path of ["/nakliye/aydin-antalya", "/nakliye/aydin-aydin", "/nakliye/aydin", "/nakliye/aydin-antalya/opengraph-image", "/nakliye/aydin-istanbul/baska"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});

test("tanıtımdan güzergâhlara; site haritası ve robots", async ({ page, request }) => {
  await page.goto("/");
  const links = page.getByRole("navigation", { name: "Güzergâhlar" }).getByRole("link");
  await expect(links).toHaveCount(72); // 9 il, her çift iki yön
  await expect(page.getByRole("navigation", { name: "Güzergâhlar" }).getByRole("heading", { level: 3 })).toHaveCount(9);
  await links.filter({ hasText: "Manisa – İzmir nakliye" }).click();
  await expect(page).toHaveURL(/\/nakliye\/manisa-izmir$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Manisa – İzmir nakliye");

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap.match(/<loc>http:\/\/localhost:3001\/nakliye\/[a-z]+-[a-z]+<\/loc>/g)).toHaveLength(72);
  expect(sitemap).toContain("<loc>http://localhost:3001/</loc>");
  expect(sitemap).not.toContain("/panel");
  expect(await (await request.get("/robots.txt")).text()).toContain("Sitemap: http://localhost:3001/sitemap.xml");
});

test("yeni iller: Ankara – Mersin sayfası API'deki karayolu mesafesi ve fiyatlarla açılır", async ({ page }) => {
  const s = (await api<RouteSummary>("GET", "/public/routes/6/33")).body;
  expect(s.source).toBe("karayolu"); // OSRM tüm Türkiye
  const res = await page.goto("/nakliye/ankara-mersin");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankara – Mersin nakliye");
  await expect(page.getByText(`Karayolu ${s.distanceKm} km (il merkezleri arası)`)).toBeVisible();
  const rows = page.getByTestId("price-table").locator("tbody tr");
  for (const [i, e] of s.estimates.entries()) await expect(rows.nth(i)).toContainText(`${money.format(e.min)} ₺ – ${money.format(e.max)} ₺`);
});

test("telefon genişliğinde (390 px) güzergâh sayfası yatay taşmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/nakliye/aydin-istanbul");
  await expect(page.getByTestId("price-table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/guzergah-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await page.screenshot({ path: `${process.env.SHOTS}/guzergah.png`, fullPage: true });
  }
});
