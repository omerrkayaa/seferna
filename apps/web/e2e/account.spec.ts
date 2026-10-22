// FR-07 (KVKK): Hesap sayfası — verileri indir, hesabı kodla sil; silinen nakliyecinin yük sahibi tarafında görünüşü;
// askıya alınan kullanıcının panelden girişe yönlenmesi; FR-08 dondurma. Hazırlık API ile; tarayıcı yük sahibidir.
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { adminToken, api, apiUser, createLoad, localPhone, otpFor, phone, psql, smsCode } from "./helpers";

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3001";
type User = Awaited<ReturnType<typeof apiUser>>;
let admin: string;
let S: User;
let C: User;
let context: BrowserContext;
let page: Page;
let jobId: string;

async function browserAs(browser: Browser, u: User) {
  const ctx = await browser.newContext({ baseURL: BASE });
  await ctx.addCookies([
    { name: "nk_at", value: u.accessToken, url: BASE, httpOnly: true },
    { name: "nk_rt", value: u.refreshToken, url: BASE, httpOnly: true },
  ]);
  return ctx;
}
/** İlan → teklif → kabul (iş anlaşıldı) */
async function acceptedJob(shipper: User, carrier: User, vehicleId: string) {
  const l = await createLoad(shipper.accessToken, admin);
  const o = (await api("POST", `/loads/${l}/offers`, carrier.accessToken, { vehicleId, price: 9000 })).body.id!;
  return (await api<{ job: { id: string }; deliveryCode: string }>("POST", `/offers/${o}/accept`, shipper.accessToken)).body;
}
// Plaka numaradan: aynı nakliyecinin ikinci aracı farklı harfle (plaka tekil)
const vehicleOf = async (u: User, n: number) =>
  (await api("POST", "/vehicles", u.accessToken, { plate: `48 H${"ABCDEFGH"[n % 8]} ${phone(n).slice(-7, -3)}`, vehicleType: "kamyon", bodyType: "tenteli", capacityTon: 10 })).body.id!;

test.beforeAll(async ({ browser }) => {
  admin = await adminToken(907);
  S = await apiUser(phone(801), "shipper", "Silinecek Deneme");
  C = await apiUser(phone(802), "carrier", "Hesap Nakliyat");
  const v = await vehicleOf(C, 802);
  const acc = await acceptedJob(S, C, v);
  jobId = acc.job.id;
  await api("POST", `/jobs/${jobId}/deliver`, C.accessToken, { code: acc.deliveryCode });
  await api("POST", `/jobs/${jobId}/complete`, S.accessToken);
  await createLoad(S.accessToken, admin); // açık ilan: silinince iptal olur
  context = await browserAs(browser, S);
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.close();
});

test("Hesap sayfası menüden açılır; verilerimi indir → JSON dosyası (karşı tarafın numarası yok)", async () => {
  await page.goto("/panel");
  await page.getByRole("link", { name: "Hesap", exact: true }).click();
  await expect(page).toHaveURL(/\/panel\/hesap$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hesap ve veriler");

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Verilerimi indir (JSON)" }).click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^nakliye-verilerim-\d{4}-\d{2}-\d{2}\.json$/);
  const text = readFileSync((await d.path())!, "utf8");
  const data = JSON.parse(text);
  expect(data.format).toBe("nakliye-kisisel-veri/1");
  expect(data.account.phone).toBe(phone(801));
  expect(data.loads).toHaveLength(2);
  expect(data.jobs).toHaveLength(1);
  expect(data.jobs[0].counterpart).toBe("Hesap Nakliyat");
  expect(text).not.toContain(phone(802));
});

test("süren taşıma varken silme kodu gönderilmez, sebep gösterilir", async () => {
  const v2 = await vehicleOf(C, 803);
  const acc = await acceptedJob(S, C, v2);
  await page.goto("/panel/hesap");
  await page.getByRole("button", { name: "Silme kodu gönder" }).click();
  // Next'in sayfa duyurucusu da role=alert: metinle süz
  await expect(page.getByRole("alert").filter({ hasText: "Sonuçlanmamış" })).toHaveText("Sonuçlanmamış 1 taşımanız var. Hesabınızı silmeden önce tamamlanmalı ya da iptal edilmeli.");
  await expect(page.getByLabel("SMS'teki kod")).toHaveCount(0);
  await api("POST", `/jobs/${acc.job.id}/cancel`, S.accessToken, { reason: "Test için iptal" });
});

test("hesabı sil: kod → onay vazgeçilirse bir şey olmaz → yanlış kod hatası → doğru kodla silinir, girişe döner", async () => {
  await page.goto("/panel/hesap");
  await page.getByRole("button", { name: "Silme kodu gönder" }).click();
  await expect(page.getByRole("status")).toContainText("numarasına 6 haneli kod gönderildi.");
  const code = await smsCode(phone(801), "Seferna hesap silme kodunuz");

  // Onay penceresinde vazgeç: gönderilmez
  await page.getByLabel("SMS'teki kod").fill(code);
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Hesabımı kalıcı olarak sil" }).click();
  await expect(page).toHaveURL(/\/panel\/hesap$/);
  expect(psql(`select status from users where phone='${phone(801)}'`)).toBe("aktif");

  // Yanlış kod: alanın altında değil, genel hata (API 400 "Kod hatalı"; oturum düşmez)
  await page.getByLabel("SMS'teki kod").fill(code === "000000" ? "000001" : "000000");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Hesabımı kalıcı olarak sil" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Kod" })).toHaveText("Kod hatalı");
  await expect(page).toHaveURL(/\/panel\/hesap$/);

  await page.getByLabel("SMS'teki kod").fill(code);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Hesabımı kalıcı olarak sil" }).click();
  await expect(page).toHaveURL(/\/giris\?hesap=silindi$/);
  await expect(page.getByRole("status")).toContainText("Hesabınız silindi");
  expect((await context.cookies()).some((c) => c.name === "nk_at" || c.name === "nk_rt")).toBe(false);
  expect(psql(`select count(*) from users where phone='${phone(801)}'`)).toBe("0");
  expect(psql(`select status from load_posts where shipper_id='${S.id}' and status <> 'kapandi' order by created_at desc limit 1`)).toBe("iptal");

  await page.goto("/panel");
  await expect(page).toHaveURL(/\/giris/);
});

test("silinen nakliyeci: yük sahibinin listesinde 'Silinmiş kullanıcı', numara ve favori düğmesi yok; taşımada numara yok", async ({ browser }) => {
  const S2 = await apiUser(phone(804), "shipper", "Kalan Yük Sahibi");
  const C3 = await apiUser(phone(805), "carrier", "Gidecek Nakliyat");
  const acc = await acceptedJob(S2, C3, await vehicleOf(C3, 805));
  await api("POST", `/jobs/${acc.job.id}/deliver`, C3.accessToken, { code: acc.deliveryCode });
  await api("POST", `/jobs/${acc.job.id}/complete`, S2.accessToken);
  expect((await api("POST", "/me/deletion-code", C3.accessToken)).status).toBe(204);
  const del = await api("DELETE", "/me", C3.accessToken, { code: await smsCode(phone(805), "Seferna hesap silme kodunuz") });
  expect(del.status).toBe(200);

  const ctx = await browserAs(browser, S2);
  const p = await ctx.newPage();
  await p.goto("/panel/nakliyecilerim");
  const row = p.locator(`[data-carrier-id="${C3.id}"]`);
  await expect(row).toContainText("Silinmiş kullanıcı");
  await expect(row).toContainText("Hesap silindi");
  await expect(row.getByRole("link")).toHaveCount(0); // tel: bağlantısı yok
  await expect(row.getByRole("button")).toHaveCount(0); // favori düğmesi yok

  await p.goto(`/panel/tasimalar/${acc.job.id}`);
  await expect(p.getByText("— (hesap silindi)")).toBeVisible();
  await expect(p.locator('a[href^="tel:"]')).toHaveCount(0);
  await ctx.close();
});

test("askıya alınan kullanıcı panelde hata sayfası yerine girişe yönlenir", async ({ browser }) => {
  const S3 = await apiUser(phone(806), "shipper", "Askı Deneme");
  const ctx = await browserAs(browser, S3);
  const p = await ctx.newPage();
  await p.goto("/panel/hesap");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Hesap ve veriler");
  expect((await api("POST", `/admin/users/${S3.id}/suspend`, admin, { reason: "Web testi için askı" })).status).toBe(200);
  await p.reload();
  await expect(p).toHaveURL(/\/giris\?oturum=askida$/);
  await expect(p.getByRole("status")).toHaveText("Hesabınız askıya alındı.");
  await api("POST", `/admin/users/${S3.id}/unsuspend`, admin);
  await ctx.close();
});

test("hesabı dondur (FR-08): vazgeçilirse bir şey olmaz → onayla dondurulur, ilan kapanır → kodla giriş açar, göstergede not", async ({ browser }) => {
  const F = await apiUser(phone(808), "shipper", "Dondurulan Deneme");
  const loadId = await createLoad(F.accessToken, admin);
  const ctx = await browserAs(browser, F);
  const p = await ctx.newPage();
  await p.goto("/panel/hesap");
  p.once("dialog", (d) => d.dismiss());
  await p.getByRole("button", { name: "Hesabımı dondur" }).click();
  await expect(p).toHaveURL(/\/panel\/hesap$/);
  expect(psql(`select status from users where id='${F.id}'`)).toBe("aktif");

  p.once("dialog", (d) => d.accept());
  await p.getByRole("button", { name: "Hesabımı dondur" }).click();
  await expect(p).toHaveURL(/\/giris\?hesap=donduruldu$/);
  await expect(p.getByRole("status")).toHaveText("Hesabınız donduruldu. Yeniden giriş yaptığınızda açılır.");
  expect((await ctx.cookies()).some((c) => c.name === "nk_at" || c.name === "nk_rt")).toBe(false);
  expect(psql(`select status from users where id='${F.id}'`)).toBe("donduruldu");
  expect(psql(`select status from load_posts where id='${loadId}'`)).toBe("iptal");

  psql(`delete from otp_codes where phone='${phone(808)}'`); // hazırlıktaki API girişinin 60 sn yeniden gönderme sınırı
  await p.getByLabel("Cep telefonu").fill(localPhone(phone(808)));
  await p.getByRole("button", { name: "SMS kodu gönder" }).click();
  const codeInput = p.getByLabel(/numarasına gelen kod/);
  await expect(codeInput).toBeVisible(); // yeni kod gönderildi (günlükte hazırlıktaki girişin eski kodu da var)
  await codeInput.fill(await otpFor(phone(808)));
  await p.getByRole("button", { name: "Giriş yap" }).click();
  await expect(p).toHaveURL(/\/panel\?acildi=dondurma$/);
  await expect(p.getByRole("status").filter({ hasText: "yeniden açıldı" })).toHaveText(
    "Hesabınız yeniden açıldı. Dondururken kapanan ilanlarınızı “Benzerini yayınla” ile yeniden açabilirsiniz.",
  );
  expect(psql(`select status from users where id='${F.id}'`)).toBe("aktif");
  expect(psql(`select status from load_posts where id='${loadId}'`)).toBe("iptal");
  await ctx.close();
});

test("dondurulmuş nakliyeci: yük sahibinin listesinde işaretli, numara ve favori düğmesi duruyor", async ({ browser }) => {
  const S5 = await apiUser(phone(809), "shipper", "Listeli Yük Sahibi");
  const C5 = await apiUser(phone(810), "carrier", "Mola Nakliyat");
  const acc = await acceptedJob(S5, C5, await vehicleOf(C5, 812)); // 812 % 8 = 4: diğer testlerin plakalarıyla çakışmaz
  await api("POST", `/jobs/${acc.job.id}/deliver`, C5.accessToken, { code: acc.deliveryCode });
  await api("POST", `/jobs/${acc.job.id}/complete`, S5.accessToken);
  expect((await api("POST", "/me/freeze", C5.accessToken)).status).toBe(200);
  const ctx = await browserAs(browser, S5);
  const p = await ctx.newPage();
  await p.goto("/panel/nakliyecilerim");
  const row = p.locator(`[data-carrier-id="${C5.id}"]`);
  await expect(row).toContainText("Mola Nakliyat");
  await expect(row).toContainText("Hesabı dondurulmuş");
  await expect(row.locator('a[href^="tel:"]')).toHaveCount(1);
  await expect(row.getByRole("button")).toHaveCount(1);
  await ctx.close();
});

test("telefon genişliğinde (390 px) hesap sayfası yatay taşmaz", async ({ browser }) => {
  const S4 = await apiUser(phone(807), "shipper");
  const ctx = await browserAs(browser, S4);
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto("/panel/hesap");
  await expect(p.getByRole("button", { name: "Silme kodu gönder" })).toBeVisible();
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/hesap-390.png`, fullPage: true });
  await ctx.close();
});
