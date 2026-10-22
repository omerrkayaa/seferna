// Yük sahibinin ana akışı: teklif karşılaştırma ve kabul (P5) → taşıma (P6): teslim kodu, iptal, itiraz, tamamlama,
// puanlama. Nakliyeci tarafı (teklif, teslim) API ile yapılır; tarayıcı yük sahibidir.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminToken, api, apiUser, createLoad, phone, psql, smsCode } from "./helpers";

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3001";
const SP = phone(101);
let context: BrowserContext;
let page: Page;
let admin: string;
let S: Awaited<ReturnType<typeof apiUser>>;
let C1: Awaited<ReturnType<typeof apiUser>>;
let C2: Awaited<ReturnType<typeof apiUser>>;
let V1: string, V2: string, L: string, O1: string, J1: string, code: string, cancelledLoad: string;

const vehicle = async (token: string, plate: string) =>
  (await api("POST", "/vehicles", token, { plate, vehicleType: "kamyon", bodyType: "tenteli", capacityTon: 10 })).body.id!;
const offer = async (token: string, loadId: string, vehicleId: string, price: number, note?: string) =>
  (await api("POST", `/loads/${loadId}/offers`, token, { vehicleId, price, note })).body.id!;
/** API ile ilan + teklif + kabul → iş ve teslim kodu */
async function jobViaApi() {
  const l = await createLoad(S.accessToken, admin);
  const o = await offer(C2.accessToken, l, V2, 7000);
  const r = await api<{ job: { id: string }; deliveryCode: string }>("POST", `/offers/${o}/accept`, S.accessToken);
  return { id: r.body.job.id, code: r.body.deliveryCode };
}
const offerRow = (id: string) => page.locator(`li[data-offer-id="${id}"]`);

test.beforeAll(async ({ browser }) => {
  admin = await adminToken(901);
  S = await apiUser(SP, "shipper", "Ege Palet");
  C1 = await apiUser(phone(102), "carrier", "Kaya Nakliyat");
  C2 = await apiUser(phone(103), "carrier", "Deniz Lojistik");
  const run = SP.slice(-7, -3);
  V1 = await vehicle(C1.accessToken, `48 KY ${run}`);
  V2 = await vehicle(C2.accessToken, `48 DZ ${run}`);
  L = await createLoad(S.accessToken, admin);
  O1 = await offer(C1.accessToken, L, V1, 9000, "Yarın sabah yüklerim");
  await offer(C2.accessToken, L, V2, 8500);
  context = await browser.newContext({ baseURL: BASE });
  await context.addCookies([
    { name: "nk_at", value: S.accessToken, url: BASE, httpOnly: true },
    { name: "nk_rt", value: S.refreshToken, url: BASE, httpOnly: true },
  ]);
  page = await context.newPage();
});

test.afterAll(async () => {
  psql(`update load_posts set status='iptal' where status in ('teyitli','teyit_bekliyor','moderasyonda') and shipper_id in (select id from users where phone like '+90559%')`);
  await context.close();
});

test("İlanlarım'da bekleyen teklif sayısı, ilanın teklif bölümüne götürür", async () => {
  await page.goto("/panel/ilanlar");
  await page.locator(`tr[data-load-id="${L}"]`).getByRole("link", { name: "2 teklif" }).click();
  await expect(page).toHaveURL(new RegExp(`/panel/ilanlar/${L}#teklifler$`));
  await expect(page.getByRole("heading", { name: "Teklifler" })).toBeVisible();
});

test("teklifler ucuzdan pahalıya; puan, tamamlanan iş ve araçla; numara gizli", async () => {
  const prices = await page.locator("li[data-offer-id] > div:first-child").allTextContents();
  expect(prices).toEqual(["8.500 ₺", "9.000 ₺"]);
  await expect(offerRow(O1)).toContainText("Kaya Nakliyat");
  await expect(offerRow(O1)).toContainText("Henüz puan yok");
  await expect(offerRow(O1)).toContainText("0 tamamlanmış iş");
  await expect(offerRow(O1)).toContainText("Kamyon, tenteli, 10 ton");
  await expect(offerRow(O1)).toContainText("Yarın sabah yüklerim");
  expect(await page.content()).not.toContain(phone(102).slice(3));
});

test("kabul: onay sorulur, teslim kodu bir kez gösterilir ve SMS'tekiyle aynı", async () => {
  page.once("dialog", (d) => d.dismiss());
  await offerRow(O1).getByRole("button", { name: "Kabul et" }).click();
  await expect(page.getByTestId("delivery-code")).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await offerRow(O1).getByRole("button", { name: "Kabul et" }).click();
  await expect(page.getByTestId("delivery-code")).toHaveText(/^\d{6}$/);
  code = (await page.getByTestId("delivery-code").textContent())!;
  expect(code).toBe(await smsCode(SP, "Seferna teslim kodunuz"));
  // Sayfa yenilendi: ilan kapandı, teklifler sonuçlandı, kod ekranda kaldı
  await expect(page.getByText("Kapandı")).toBeVisible();
  await expect(offerRow(O1)).toContainText("Kabul edildi");
  await expect(page.locator("li[data-offer-id]").filter({ hasText: "8.500" })).toContainText("Sonuçlanmadı");
  await expect(page.getByTestId("delivery-code")).toHaveText(code);
});

test("taşıma sayfası: nakliyecinin numarası ve plaka açık, zaman çizelgesi", async () => {
  await page.getByRole("link", { name: "Taşımaya git" }).click();
  await expect(page).toHaveURL(/\/panel\/tasimalar\/[0-9a-f-]{36}$/);
  J1 = page.url().split("/").at(-1)!;
  await expect(page.getByRole("link", { name: `0${phone(102).slice(3)}` })).toHaveAttribute("href", `tel:${phone(102)}`);
  await expect(page.getByText(`48KY${SP.slice(-7, -3)}`)).toBeVisible();
  await expect(page.getByText("Anlaşıldı")).toBeVisible();
  // Next 16 önceki sayfayı (ilan sayfasındaki kabul bandı) gizli tutar: zaman çizelgesi öğesine bakılır
  await expect(page.getByRole("listitem").filter({ hasText: "Teklif kabul edildi, taşıma oluştu" })).toBeVisible();
});

test("Taşımalar listesi: süren taşıma görünür", async () => {
  await page.goto("/panel/tasimalar");
  await expect(page.locator(`tr[data-job-id="${J1}"]`)).toContainText("Kaya Nakliyat");
  await expect(page.locator(`tr[data-job-id="${J1}"]`)).toContainText("9.000 ₺");
  await page.locator(`tr[data-job-id="${J1}"]`).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/panel/tasimalar/${J1}$`));
});

test("yeni teslim kodu: eski kod geçersizleşir", async () => {
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Yeni teslim kodu" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Yeni teslim kodunuz" })).toBeVisible();
  const fresh = (await page.getByRole("status").filter({ hasText: "Yeni teslim kodunuz" }).locator(".font-mono").textContent())!;
  expect(fresh).toMatch(/^\d{6}$/);
  expect(fresh).toBe(await smsCode(SP, "Seferna teslim kodunuz"));
  if (fresh !== code) expect((await api("POST", `/jobs/${J1}/deliver`, C1.accessToken, { code })).status).toBe(400);
  code = fresh;
});

test("iptal sebebi kısa: API hatası alanda gösterilir, yazılan korunur; vazgeçilebilir", async () => {
  await page.getByRole("button", { name: "Taşımayı iptal et" }).click();
  await page.getByLabel("İptal sebebi").fill("yok");
  await page.getByRole("button", { name: "İptal et", exact: true }).click();
  await expect(page.getByText("Sebebi en az 5 karakterle yazın")).toBeVisible();
  await expect(page.getByLabel("İptal sebebi")).toHaveValue("yok");
  await page.getByRole("button", { name: "Vazgeç" }).click();
  expect(psql(`select status from jobs where id='${J1}'`)).toBe("anlasildi");
});

test("nakliyeci kodla teslim edince itiraz süresi gösterilir; tamamla", async () => {
  expect((await api("POST", `/jobs/${J1}/deliver`, C1.accessToken, { code })).status).toBe(200);
  await page.reload();
  await expect(page.getByText("Teslim edildi", { exact: true })).toBeVisible();
  await expect(page.getByText(/tarihine kadar itiraz edin/)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sorun yok, tamamla" }).click();
  await expect(page.getByText("Tamamlandı", { exact: true })).toBeVisible();
  expect(psql(`select status from jobs where id='${J1}'`)).toBe("tamamlandi");
});

test("puanlama: yıldız zorunlu; puan kör tutulur, karşı taraf puanlayınca ikisi görünür", async () => {
  await page.getByRole("button", { name: "Puanı gönder" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "1–5 arasında bir puan seçin" })).toBeVisible();
  await page.getByLabel("4 yıldız").check({ force: true });
  await page.getByLabel("Zamanında").check();
  await page.getByLabel("Yüke özenli").check();
  await page.getByLabel("Yorum (isteğe bağlı)").fill("Özenli taşıdı");
  await page.getByRole("button", { name: "Puanı gönder" }).click();
  await expect(page.getByText("Verdiğiniz puan")).toBeVisible();
  await expect(page.getByLabel("4 yıldız", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Zamanında · Yüke özenli")).toBeVisible();
  // Kör: nakliyecinin profilinde henüz görünmez
  expect((await api("GET", `/users/${C1.id}/reputation`, S.accessToken)).body.rating).toMatchObject({ count: 0 });
  expect((await api("POST", `/jobs/${J1}/rating`, C1.accessToken, { stars: 5, tags: ["odeme_sorunsuz"] })).status).toBe(201);
  await page.reload();
  await expect(page.getByText("Aldığınız puan")).toBeVisible();
  await expect(page.getByText("Ödeme sorunsuz")).toBeVisible();
  expect((await api("GET", `/users/${C1.id}/reputation`, S.accessToken)).body.rating).toMatchObject({ count: 1, average: 4 });
});

test("iptal: sebep yazılır, durum ve zaman çizelgesinde görünür", async () => {
  const j = await jobViaApi();
  await page.goto(`/panel/tasimalar/${j.id}`);
  await page.getByRole("button", { name: "Taşımayı iptal et" }).click();
  await page.getByLabel("İptal sebebi").fill("Yük hazır olmadı");
  await page.getByRole("button", { name: "İptal et", exact: true }).click();
  await expect(page.getByText("Taşıma iptal edildi: “Yük hazır olmadı”")).toBeVisible();
  await expect(page.getByText("Taşıma iptal edildi", { exact: true })).toBeVisible();
  expect(psql(`select cancelled_by from jobs where id='${j.id}'`)).toBe(S.id);
  cancelledLoad = psql(`select load_post_id from jobs where id='${j.id}'`);
});

test("iptal edilen taşımadan ilan yeniden yayınlanır: form eski ilanla dolu gelir", async () => {
  await page.getByRole("link", { name: "İlanı yeniden yayınla" }).click();
  await expect(page).toHaveURL(new RegExp(`/panel/ilanlar/yeni\\?kopya=${cancelledLoad}$`));
  await expect(page.getByText("Bilgiler eski ilanınızdan dolduruldu")).toBeVisible();
  await expect(page.getByLabel("Kalkış ili")).toHaveValue("48");
  await expect(page.getByLabel("Kalkış ilçesi").locator("option:checked")).toHaveText("Menteşe");
  await expect(page.getByLabel("Varış ilçesi").locator("option:checked")).toHaveText("Muratpaşa");
  await expect(page.getByLabel("Yük cinsi")).toHaveValue("palet");
  await expect(page.getByLabel("Ağırlık (ton)")).toHaveValue("7");
  await expect(page.getByLabel("Araç tipi")).toHaveValue("kamyon");
  await expect(page.getByLabel("Sabit fiyat veriyorum")).toBeChecked();
  await expect(page.getByLabel("Tutar (₺, KDV hariç)")).toHaveValue("12500");
  await page.getByRole("button", { name: "İlanı yayınla" }).click();
  await expect(page).toHaveURL(/\/panel\/ilanlar\/[0-9a-f-]{36}\?yeni=1$/);
  const fresh = page.url().split("/").at(-1)!.split("?")[0]!;
  expect(fresh).not.toBe(cancelledLoad);
  const cols = "origin_district_id, dest_district_id, cargo_type, weight_ton, vehicle_type, price_type, price";
  expect(psql(`select ${cols} from load_posts where id='${fresh}'`)).toBe(psql(`select ${cols} from load_posts where id='${cancelledLoad}'`));
  expect(psql(`select status from load_posts where id='${cancelledLoad}'`)).toBe("kapandi");
});

test("yayında olmayan ilanda 'Benzerini yayınla'; yayındakinde yok", async () => {
  await page.goto(`/panel/ilanlar/${L}`);
  await expect(page.getByRole("link", { name: "Benzerini yayınla" })).toHaveAttribute("href", `/panel/ilanlar/yeni?kopya=${L}`);
  const live = await createLoad(S.accessToken, admin);
  await page.goto(`/panel/ilanlar/${live}`);
  await expect(page.getByRole("button", { name: "Hâlâ geçerli" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Benzerini yayınla" })).toHaveCount(0);
  // Başkasının ilanı kopyalanamaz: boş form
  const other = await apiUser(phone(104), "shipper");
  const foreign = await createLoad(other.accessToken, admin);
  await page.goto(`/panel/ilanlar/yeni?kopya=${foreign}`);
  await expect(page.getByLabel("Yük cinsi")).toHaveValue("");
  await expect(page.getByText("Bilgiler eski ilanınızdan dolduruldu")).toHaveCount(0);
});

test("itiraz: teslimden sonra sebeple; yönetici incelemesine düşer", async () => {
  const j = await jobViaApi();
  await api("POST", `/jobs/${j.id}/deliver`, C2.accessToken, { code: j.code });
  await page.goto(`/panel/tasimalar/${j.id}`);
  await page.getByRole("button", { name: "İtiraz et" }).click();
  await page.getByLabel(/Sorun nedir/).fill("İki koli hasarlı geldi");
  await page.getByRole("button", { name: "İtirazı gönder" }).click();
  await expect(page.getByText("İtirazınız alındı; yönetici inceleyecek.")).toBeVisible();
  await expect(page.getByText("İtirazlı")).toBeVisible();
});

test("Geçmiş sekmesi: tamamlanan, iptal ve itirazlı taşımalar", async () => {
  await page.goto("/panel/tasimalar");
  await expect(page.getByText("Süren taşıma yok")).toBeVisible();
  await page.getByRole("link", { name: "Geçmiş" }).click();
  await expect(page.locator("tr[data-job-id]")).toHaveCount(3);
  await expect(page.locator(`tr[data-job-id="${J1}"]`)).toContainText("Tamamlandı");
});

test("telefon genişliğinde (390 px) panel sayfalarında yatay taşma yok", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/panel", `/panel/tasimalar/${J1}`, "/panel/tasimalar", `/panel/ilanlar/${L}`, "/panel/ilanlar/yeni"]) {
    await page.goto(path);
    await page.locator("main h1").first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
