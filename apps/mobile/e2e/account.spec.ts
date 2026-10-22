// FR-07 (KVKK): Profil → Hesap ve veriler — verileri indir, hesabı kodla sil, FR-08 dondur; askı ve silinmiş karşı taraf; giriş ekranında
// yasal metin bağlantıları. Expo web derlemesinde (390 px).
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { acceptDialogs, adminToken, api, apiLoad, apiUser, btn, collectErrors, districtId, noHorizontalOverflow, otpFor, phone, psql, shot, smsCodes, vis } from "./helpers";

const deletionCode = async (p: string) => {
  for (let i = 0; i < 40; i++) {
    const c = smsCodes(p, "Seferna hesap silme kodunuz").at(-1);
    if (c) return c;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Silme kodu bulunamadı: ${p}`);
};

/** Arayüzden OTP girişi; rolü olmayan kullanıcı nakliyeci seçer */
async function uiLogin(page: Page, p: string, chooseRole: boolean) {
  await page.goto("/");
  await page.getByLabel("Cep telefonu").locator("visible=true").fill(`0${p.slice(3)}`);
  await vis(page, "SMS kodu gönder").click();
  const codeInput = page.getByLabel("SMS kodu").locator("visible=true");
  await expect(codeInput).toBeVisible(); // yeni kod gönderildi (günlükte API girişinin eski kodu da var)
  await codeInput.fill(await otpFor(p));
  await vis(page, "Giriş yap").click();
  if (chooseRole) {
    await vis(page, "Nakliyeciyim (aracım var)").click();
    await vis(page, "Devam").click();
  }
  await expect(page.getByRole("tab", { name: /Profil/ })).toBeVisible({ timeout: 20_000 });
}

test("hesap ve veriler: verileri indir, yanlış kod hatası, kodla sil → giriş ekranında not ve yasal bağlantılar", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const dialogs = acceptDialogs(page);
  const me = phone(51);

  await uiLogin(page, me, true);
  await page.getByRole("tab", { name: /Profil/ }).click();
  await vis(page, "Hesap ve veriler").click();
  await expect(vis(page, "Verilerimi indir", true).first()).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await shot(page, "hesap");

  const download = page.waitForEvent("download");
  await btn(page, "Verilerimi indir").click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^nakliye-verilerim-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(readFileSync((await d.path())!, "utf8"));
  expect(data.account.phone).toBe(me);
  expect(data.account.roles).toEqual(["carrier"]);
  await expect(vis(page, "✓ Dosya hazırlandı")).toBeVisible();

  await btn(page, "Silme kodu gönder").click();
  await expect(vis(page, /numarasına 6 haneli kod gönderildi/)).toBeVisible();
  const code = await deletionCode(me);
  await page.getByLabel("SMS'teki kod").locator("visible=true").fill(code === "000000" ? "000001" : "000000");
  await btn(page, "Hesabımı kalıcı olarak sil").click();
  await expect(vis(page, "Kod hatalı")).toBeVisible();
  expect(psql(`select status from users where phone='${me}'`)).toBe("aktif");

  await page.getByLabel("SMS'teki kod").locator("visible=true").fill(code);
  await btn(page, "Hesabımı kalıcı olarak sil").click();
  await expect(vis(page, /^Hesabınız silindi/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Cep telefonu").locator("visible=true")).toBeVisible();
  expect(dialogs.some((m) => m.startsWith("Hesabınız silinsin mi?"))).toBe(true);
  expect(psql(`select count(*) from users where phone='${me}'`)).toBe("0");
  // Yasal metinler giriş ekranında (W4)
  await expect(page.getByRole("link", { name: "Kullanım şartları" })).toBeVisible();
  await expect(page.getByRole("link", { name: "KVKK aydınlatma metni" })).toBeVisible();
  await shot(page, "hesap-silindi");
  // Oturum yerelde de kapandı: yenileyince giriş ekranı
  await page.reload();
  await expect(page.getByLabel("Cep telefonu").locator("visible=true")).toBeVisible({ timeout: 20_000 });
  expect(errors.filter((e) => !/status of 400/.test(e))).toEqual([]);
});

test("hesabı dondur (FR-08): onay → giriş ekranında not → kodla giriş hesabı açar, açıldı notu", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const dialogs = acceptDialogs(page);
  const me = phone(55);
  await uiLogin(page, me, true);
  await page.getByRole("tab", { name: /Profil/ }).click();
  await vis(page, "Hesap ve veriler").click();
  await btn(page, "Hesabımı dondur").click();
  await expect(vis(page, "Hesabınız donduruldu. Yeniden giriş yaptığınızda açılır.")).toBeVisible({ timeout: 20_000 });
  expect(dialogs.some((m) => m.startsWith("Hesabınız dondurulsun mu?"))).toBe(true);
  expect(psql(`select status from users where phone='${me}'`)).toBe("donduruldu");
  await shot(page, "hesap-donduruldu");

  psql(`delete from otp_codes where phone='${me}'`); // ilk girişin 60 sn yeniden gönderme sınırı
  await uiLogin(page, me, false);
  await expect.poll(() => dialogs.some((m) => m.startsWith("Hesabınız yeniden açıldı"))).toBe(true);
  expect(psql(`select status from users where phone='${me}'`)).toBe("aktif");
  expect(errors).toEqual([]);
});

test("askıya alınan kullanıcı ilk istekte oturumdan çıkar, giriş ekranında not", async ({ page }) => {
  const admin = await adminToken(phone(59));
  const me = phone(52);
  await uiLogin(page, me, true);
  const id = psql(`select id from users where phone='${me}'`);
  expect((await api("POST", `/admin/users/${id}/suspend`, admin, { reason: "Mobil testi için askı" })).status).toBe(200);
  await page.getByRole("tab", { name: /İşlerim/ }).click(); // sekme odaklanınca API'ye gider
  await expect(vis(page, "Hesabınız askıya alındı.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Cep telefonu").locator("visible=true")).toBeVisible();
  await api("POST", `/admin/users/${id}/unsuspend`, admin);
});

test("silinmiş yük sahibiyle iş: iş detayında 'Silinmiş kullanıcı', arama düğmesi yok", async ({ page }) => {
  const admin = await adminToken(phone(58));
  const S = await apiUser(phone(53), ["shipper"]);
  const C = await apiUser(phone(54), ["carrier"]);
  const v = (await api<{ id: string }>("POST", "/vehicles", C, { plate: `62 MH ${phone(54).slice(-7, -3)}`, vehicleType: "tir", bodyType: "tenteli", capacityTon: 25 })).body.id;
  const l = await apiLoad(S, admin, await districtId("Tunceli", "Ovacık"), await districtId("Bingöl", "Karlıova"));
  const o = (await api<{ id: string }>("POST", `/loads/${l}/offers`, C, { vehicleId: v, price: 15000 })).body.id;
  const acc = (await api<{ job: { id: string }; deliveryCode: string }>("POST", `/offers/${o}/accept`, S)).body;
  await api("POST", `/jobs/${acc.job.id}/deliver`, C, { code: acc.deliveryCode });
  await api("POST", `/jobs/${acc.job.id}/complete`, S);
  expect((await api("POST", "/me/deletion-code", S)).status).toBe(204);
  expect((await api("DELETE", "/me", S, { code: await deletionCode(phone(53)) })).status).toBe(200);

  await uiLogin(page, phone(54), false);
  await page.goto(`/is/${acc.job.id}`);
  await expect(vis(page, "Hesap silindi; numara yok.")).toBeVisible({ timeout: 20_000 });
  await expect(vis(page, "Silinmiş kullanıcı")).toBeVisible();
  await expect(btn(page, /^Ara · /)).toHaveCount(0);
});

test("herkese açık profil: firma yokken anahtar yok; firma kaydedilince aç → API'de açık, paylaş düğmesi; kapat", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const me = phone(56);
  await uiLogin(page, me, true);
  await page.getByRole("tab", { name: /Profil/ }).click();
  await expect(vis(page, "Herkese açık profil")).toBeVisible();
  await expect(vis(page, "Profil açmak için yukarıda firma unvanınızı kaydedin.")).toBeVisible();
  await expect(page.getByRole("switch", { name: /Herkese açık profil/ })).toHaveCount(0);

  await page.getByLabel("Firma unvanı (isteğe bağlı)").locator("visible=true").fill("Mobil Profil Nakliyat");
  await vis(page, "Kaydet").click();
  await expect(vis(page, "✓ Kaydedildi")).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Herkese açık profil kapalı" }).locator("visible=true");
  await toggle.click();
  await expect(page.getByRole("switch", { name: "Herkese açık profil açık" }).locator("visible=true")).toBeVisible();
  await expect(btn(page, "Profil bağlantısını paylaş")).toBeVisible();
  const t = await apiUser(me);
  const company = (await api<{ company: { id: string; publicProfile: boolean } }>("GET", "/me", t)).body.company;
  expect(company.publicProfile).toBe(true);
  expect((await api("GET", `/public/carriers/${company.id}`)).status).toBe(200);

  await page.getByRole("switch", { name: "Herkese açık profil açık" }).locator("visible=true").click();
  await expect(page.getByRole("switch", { name: "Herkese açık profil kapalı" }).locator("visible=true")).toBeVisible();
  await expect(btn(page, "Profil bağlantısını paylaş")).toHaveCount(0);
  expect((await api("GET", `/public/carriers/${company.id}`)).status).toBe(404);
  expect(errors).toEqual([]);
});
