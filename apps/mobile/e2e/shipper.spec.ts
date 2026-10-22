import { expect, test } from "@playwright/test";
import { acceptDialogs, adminToken, api, apiLoad, apiUser, btn, collectErrors, demoLogin, demoToken, districtId, noHorizontalOverflow, otpFor, phone, pickDistrict, psql, shot, smsCodes, vis } from "./helpers";

// Yük sahibi (yeni hesap, arayüzden OTP girişi) tam döngü: profil → ilan ver → moderasyon → BR-05 teyit sorusu
// bildirimden cevaplanır → teklif bildirimi → kabul + teslim kodu → yeni kod → nakliyeci teslim eder → tamamla →
// iki taraf da puanlar (nakliyeci tarafı demo hesabıyla arayüzden) → kör puan açılır.
// Kalkış/varış Aydın/Nazilli → İstanbul/Esenyurt (demo koridoru; teklifi demo nakliyeci API'den verir).

test("yük sahibi: giriş → ilan → teyit → teklif kabul → teslim → puan", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  const dialogs = acceptDialogs(page);
  const me = phone(21);
  const admin = await adminToken(phone(29));
  const demo = await demoToken();
  let loadId = "";

  await test.step("OTP girişi ve yalnız yük sahibi rolü", async () => {
    await page.goto("/");
    await page.getByLabel("Cep telefonu").locator("visible=true").fill(`0${me.slice(3)}`);
    await vis(page, "SMS kodu gönder").click();
    await page.getByLabel("SMS kodu").locator("visible=true").fill(await otpFor(me));
    await vis(page, "Giriş yap").click();
    // Hiçbir rol önceden seçili değil: seçim yapılana kadar Devam pasif
    await expect(btn(page, "Devam")).toBeDisabled();
    await vis(page, "Yük sahibiyim (yük veriyorum)").click();
    await vis(page, "Devam").click();
    await expect(vis(page, /^Henüz ilanınız yok/)).toBeVisible({ timeout: 20_000 });
    // Nakliyeci sekmeleri yok
    await expect(page.getByRole("tab", { name: /Yükler/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Dönüş/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /İlanlarım/ })).toBeVisible();
  });

  await test.step("profil: ad ve firma", async () => {
    await page.getByRole("tab", { name: /Profil/ }).click();
    await page.getByLabel("Ad soyad").locator("visible=true").fill("Test Yük Sahibi");
    await page.getByLabel("Firma unvanı (isteğe bağlı)").locator("visible=true").fill("Örnek Mobil Test Ltd.");
    await expect(page.getByLabel("Vergi no (isteğe bağlı)").locator("visible=true")).toBeVisible();
    await vis(page, "Kaydet", true).click();
    await expect(vis(page, "✓ Kaydedildi")).toBeVisible();
    await shot(page, "s0-profil");
    await expect(page.getByRole("heading", { name: "Örnek Mobil Test Ltd." }).locator("visible=true")).toBeVisible();
    // Firma kayıtlı: vergi no alanı artık sorulmaz
    await expect(page.getByLabel("Vergi no (isteğe bağlı)").locator("visible=true")).toHaveCount(0);
  });

  await test.step("ilan ver: alan hataları, sonra yayınla", async () => {
    await page.getByRole("tab", { name: /İlanlarım/ }).click();
    await vis(page, "İlan ver", true).click();
    await vis(page, "İlanı yayınla").click();
    for (const m of ["Kalkış ilçesini seçin", "Varış ilçesini seçin", "Yük cinsini seçin", "Ağırlığı ton olarak girin (en fazla 60)", "Araç tipini seçin"])
      await expect(vis(page, m)).toBeVisible();
    await pickDistrict(page, 0, "Aydın", "Nazilli");
    await pickDistrict(page, 1, "İstanbul", "Esenyurt");
    await vis(page, "Yarın", true).click();
    await vis(page, "2 gün", true).click();
    await vis(page, "Palet", true).click();
    await page.getByLabel("Ağırlık (ton)").locator("visible=true").fill("18");
    await vis(page, "Tır", true).click();
    await vis(page, "Tenteli", true).click();
    // Araç tanıma: seçilen tipin resmi ve açıklaması
    await expect(page.getByTestId("vehicle-preview").locator("visible=true")).toContainText("Çekici ve yarı römorktan oluşur");
    await expect(page.getByTestId("vehicle-preview").locator("visible=true")).toContainText("Brandayla örtülü");
    // F7: güzergâh + araç seçilince tahmini aralık (Nazilli → Esenyurt ~ 600 km)
    await expect(vis(page, /^Tahmini piyasa aralığı: [\d.]+ ₺ – [\d.]+ ₺ \((karayolu|yaklaşık) \d+ km/)).toBeVisible();
    await vis(page, "Sabit fiyat", true).click();
    await vis(page, "İlanı yayınla").click();
    await expect(vis(page, "Tutarı TL olarak girin")).toBeVisible();
    await shot(page, "s1-ilan-formu");
    await page.getByLabel("Tutar (₺, KDV hariç)").locator("visible=true").fill("21000");
    expect(await noHorizontalOverflow(page)).toBe(true);
    await vis(page, "İlanı yayınla").click();
    await expect(vis(page, "21.000 ₺")).toBeVisible();
    loadId = page.url().split("/ilanim/")[1]!.split(/[?#]/)[0]!;
    expect(loadId).toMatch(/^[0-9a-f-]{36}$/);
  });

  await test.step("moderasyon → yönetici onayı → teyitli", async () => {
    // Yeni hesabın ilk ilanı moderasyona düşer (BR-11)
    await expect(vis(page, "Onay bekliyor")).toBeVisible();
    await expect(vis(page, /kısa bir kontrolden sonra yayına çıkar/)).toBeVisible();
    await expect(vis(page, "Teklifler", true)).toHaveCount(0);
    expect((await api("POST", `/admin/loads/${loadId}/review`, admin, { decision: "onay" })).status).toBe(200);
    await page.reload();
    await expect(vis(page, /^Teyitli ·/)).toBeVisible();
    await expect(vis(page, "Henüz teklif yok. Teklif gelince bildirim alırsınız.")).toBeVisible();
  });

  await test.step("BR-05: iki nakliyeci 'yük yok' der → teyit sorusu bildirimden cevaplanır", async () => {
    for (const n of [11, 12]) {
      const c = await apiUser(phone(n), ["carrier"]);
      expect((await api("POST", `/loads/${loadId}/call`, c)).status).toBe(200);
      expect((await api("POST", "/reports", c, { targetType: "load_post", targetId: loadId, reason: "yuk_yok" })).status).toBe(201);
    }
    await page.goBack(); // ilan detayından sekmelere
    await page.getByRole("tab", { name: /İlanlarım/ }).click();
    await expect(btn(page, /^Bildirimler, \d+ okunmamış$/)).toBeVisible();
    await btn(page, /^Bildirimler/).click();
    await expect(vis(page, "Yükünüzün gittiği bildirildi")).toBeVisible();
    await vis(page, "Evet, geçerli").click();
    await expect(vis(page, "✓ İlan teyit edildi")).toBeVisible();
    await shot(page, "s2-bildirimler");
    const l = (await api<{ status: string }>("GET", `/loads/${loadId}`, demo)).body;
    expect(l.status).toBe("teyitli");
    await page.goBack();
  });

  await test.step("teklif bildirimi → ilan → kabul → teslim kodu", async () => {
    const vehicles = (await api<{ id: string }[]>("GET", "/vehicles", demo)).body;
    expect((await api("POST", `/loads/${loadId}/offers`, demo, { vehicleId: vehicles[0]!.id, price: 20500, note: "Yarın sabah yüklerim" })).status).toBe(201);

    await page.getByRole("tab", { name: /İşlerim/ }).click();
    await page.getByRole("tab", { name: /İlanlarım/ }).click();
    await expect(vis(page, "1 teklif bekliyor")).toBeVisible();
    await btn(page, /^Bildirimler/).click();
    await btn(page, /^Okunmamış: Yeni teklif: 20\.500 ₺/).click();
    await expect(vis(page, "Yarın sabah yüklerim")).toBeVisible();
    await shot(page, "s3-teklifler");
    await expect(vis(page, /tamamlanan iş$/)).toBeVisible();
    await vis(page, "Kabul et", true).click();
    expect(dialogs.at(-1)).toContain("20.500 ₺ teklifi kabul edilsin mi?");
    await expect(vis(page, "Teklif kabul edildi, taşıma oluştu")).toBeVisible();
    await shot(page, "s4-kabul-kod");
    const shown = await page.getByLabel(/^Teslim kodu /).locator("visible=true").innerText();
    expect(shown).toMatch(/^\d{6}$/);
    expect(smsCodes(me, "Seferna teslim kodunuz").at(-1)).toBe(shown);
    await expect(vis(page, "Kabul edildi", true)).toBeVisible();
    await expect(vis(page, "Hâlâ geçerli")).toHaveCount(0); // ilan kapandı
    await vis(page, "Taşımaya git").click();
    await expect(vis(page, "Teslimi elle onayla")).toBeVisible();
    await expect(vis(page, "Ara · 0555 010 20 30")).toBeVisible(); // FR-32: kabulden sonra nakliyecinin numarası açık
    await shot(page, "s6-tasima-yuk-sahibi");
  });

  const jobId = page.url().split("/is/")[1]!.split(/[?#]/)[0]!;

  await test.step("yeni teslim kodu: eskisi geçersiz, yenisiyle teslim", async () => {
    const old = smsCodes(me, "Seferna teslim kodunuz").at(-1)!;
    await vis(page, "Yeni teslim kodu").click();
    expect(dialogs.at(-1)).toContain("Eski kod geçersiz olur");
    await expect(vis(page, "Yeni teslim kodunuz")).toBeVisible();
    const fresh = smsCodes(me, "Seferna teslim kodunuz").at(-1)!;
    expect(fresh).not.toBe(old);
    await expect(vis(page, fresh, true)).toBeVisible();

    expect((await api("POST", `/jobs/${jobId}/status`, demo, { status: "yuklendi" })).status).toBe(200);
    expect((await api("POST", `/jobs/${jobId}/deliver`, demo, { code: old })).status).toBe(400);
    expect((await api("POST", `/jobs/${jobId}/deliver`, demo, { code: fresh })).status).toBe(200);
  });

  await test.step("teslim edildi → tamamla → puan (kör)", async () => {
    await page.reload();
    await expect(vis(page, /^Nakliyeci teslim ettiğini bildirdi/)).toBeVisible();
    await vis(page, "Sorun yok, tamamla").click();
    expect(dialogs.at(-1)).toContain("Sonra itiraz edilemez");
    await expect(vis(page, "Tamamlandı", true)).toBeVisible();

    await vis(page, "Puanı gönder").click();
    await expect(vis(page, "1–5 arasında bir puan seçin")).toBeVisible();
    await btn(page, "5 yıldız").click();
    await vis(page, "Yüke özenli", true).click();
    await expect(vis(page, "Ödeme sorunsuz", true)).toHaveCount(0); // nakliyeciye uygun etiketler
    await page.getByLabel("Yorum (isteğe bağlı)").locator("visible=true").fill("Zamanında ve özenli teslim");
    await vis(page, "Puanı gönder").click();
    await expect(vis(page, "Verdiğiniz puan")).toBeVisible();
    await expect(vis(page, "Aldığınız puan")).toHaveCount(0);
    await shot(page, "s5-puan");
  });

  await test.step("nakliyeci (demo) arayüzden puanlar → iki tarafta da açılır", async () => {
    const ctx = await browser.newContext();
    const carrierPage = await ctx.newPage();
    const carrierErrors = collectErrors(carrierPage);
    await demoLogin(carrierPage);
    await carrierPage.goto(`/is/${jobId}`);
    await expect(vis(carrierPage, "Puanlama", true)).toBeVisible();
    await expect(vis(carrierPage, "Karşı taraf sizi puanladı. Puanı görmek için siz de puanlayın.")).toBeVisible();
    await expect(vis(carrierPage, "Yüke özenli", true)).toHaveCount(0); // yük sahibine uygun etiketler
    await btn(carrierPage, "4 yıldız").click();
    await vis(carrierPage, "Ödeme sorunsuz", true).click();
    await vis(carrierPage, "Puanı gönder").click();
    await expect(vis(carrierPage, "Aldığınız puan")).toBeVisible();
    await expect(vis(carrierPage, "Zamanında ve özenli teslim")).toBeVisible();
    expect(carrierErrors).toEqual([]);
    await ctx.close();

    await page.reload();
    await expect(vis(page, "Aldığınız puan")).toBeVisible();
    await expect(vis(page, "Ödeme sorunsuz")).toBeVisible();
  });

  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("yük sahibi: teslim edilen taşımaya itiraz (sebep zorunlu)", async ({ page }) => {
  const errors = collectErrors(page);
  const me = phone(31);
  const admin = await adminToken(phone(39));
  const demo = await demoToken();

  // Hazırlık API'den: ilan → demo teklif → kabul → yüklendi → teslim
  const shipper = await apiUser(me, ["shipper"]);
  const loadId = await apiLoad(shipper, admin, await districtId("Aydın", "Efeler"), await districtId("İzmir", "Bornova"));
  const vehicles = (await api<{ id: string }[]>("GET", "/vehicles", demo)).body;
  const offer = (await api<{ id: string }>("POST", `/loads/${loadId}/offers`, demo, { vehicleId: vehicles[0]!.id, price: 9000 })).body;
  const acc = (await api<{ job: { id: string }; deliveryCode: string }>("POST", `/offers/${offer.id}/accept`, shipper)).body;
  expect((await api("POST", `/jobs/${acc.job.id}/status`, demo, { status: "yuklendi" })).status).toBe(200);
  expect((await api("POST", `/jobs/${acc.job.id}/deliver`, demo, { code: acc.deliveryCode })).status).toBe(200);

  await page.goto("/");
  await page.getByLabel("Cep telefonu").locator("visible=true").fill(`0${me.slice(3)}`);
  await vis(page, "SMS kodu gönder").click();
  const codeInput = page.getByLabel("SMS kodu").locator("visible=true");
  await expect(codeInput).toBeVisible(); // yeni kod gönderildi (günlükte API girişinin eski kodu da var)
  await codeInput.fill(await otpFor(me));
  await vis(page, "Giriş yap").click();
  await page.getByRole("tab", { name: /İşlerim/ }).click();
  await btn(page, /Efeler, Aydın/).first().click();
  await expect(vis(page, "Teslim edildi", true)).toBeVisible();

  await vis(page, "İtiraz et").click();
  await page.getByLabel("Sorun nedir?").locator("visible=true").fill("Eks");
  await vis(page, "İtirazı gönder").click();
  await expect(vis(page, "Sebebi en az 5 karakterle yazın")).toBeVisible();
  await expect(page.getByLabel("Sorun nedir?").locator("visible=true")).toHaveValue("Eks"); // yazılan korunur
  await page.getByLabel("Sorun nedir?").locator("visible=true").fill("Eksik teslim: 2 palet gelmedi");
  await vis(page, "İtirazı gönder").click();
  await expect(vis(page, "İtirazlı", true)).toBeVisible();
  await expect(vis(page, "Sorun yok, tamamla")).toHaveCount(0);
  expect((await api<{ status: string }>("GET", `/jobs/${acc.job.id}`, shipper)).body.status).toBe("itirazli");
  // Kısa sebebin API'de reddi (400) tarayıcı konsoluna düşer; beklenen tek hata o
  expect(errors.filter((e) => !e.includes("status of 400"))).toEqual([]);
  expect(errors.filter((e) => e.includes("status of 400"))).toHaveLength(1);
});

test("yük sahibi: iptal edilen işin ilanı eski bilgilerle yeniden yayınlanır", async ({ page }) => {
  const errors = collectErrors(page);
  const me = phone(41);
  const admin = await adminToken(phone(49));
  const demo = await demoToken();

  // Hazırlık API'den: ilan → demo teklif → kabul → yük sahibi iptal eder
  const shipper = await apiUser(me, ["shipper"]);
  const loadId = await apiLoad(shipper, admin, await districtId("Manisa", "Turgutlu"), await districtId("İzmir", "Torbalı"));
  const vehicles = (await api<{ id: string }[]>("GET", "/vehicles", demo)).body;
  const offer = (await api<{ id: string }>("POST", `/loads/${loadId}/offers`, demo, { vehicleId: vehicles[0]!.id, price: 8000 })).body;
  const acc = (await api<{ job: { id: string } }>("POST", `/offers/${offer.id}/accept`, shipper)).body;
  expect((await api("POST", `/jobs/${acc.job.id}/cancel`, shipper, { reason: "Yük ertelendi" })).status).toBe(200);

  await page.goto("/");
  await page.getByLabel("Cep telefonu").locator("visible=true").fill(`0${me.slice(3)}`);
  await vis(page, "SMS kodu gönder").click();
  const codeInput = page.getByLabel("SMS kodu").locator("visible=true");
  await expect(codeInput).toBeVisible(); // yeni kod gönderildi (günlükte API girişinin eski kodu da var)
  await codeInput.fill(await otpFor(me));
  await vis(page, "Giriş yap").click();
  await page.getByRole("tab", { name: /İşlerim/ }).click();
  await vis(page, "Geçmiş", true).click();
  await btn(page, /Turgutlu, Manisa/).first().click();
  await vis(page, "İlanı yeniden yayınla").click();
  await expect(vis(page, /^Bilgiler eski ilanınızdan dolduruldu/)).toBeVisible();
  await expect(btn(page, "İl: Manisa")).toBeVisible();
  await expect(btn(page, "İlçe: Turgutlu")).toBeVisible();
  await expect(btn(page, "İlçe: Torbalı")).toBeVisible();
  await expect(page.getByLabel("Ağırlık (ton)").locator("visible=true")).toHaveValue("10");
  await vis(page, "İlanı yayınla").click();
  // Yeni hesap (BR-11): yeniden yayınlanan ilan da moderasyona düşer
  await expect(vis(page, /^Yeni hesapların ilk ilanları/)).toBeVisible({ timeout: 20_000 });
  const fresh = psql(`select id from load_posts where shipper_id=(select id from users where phone='${me}') and id<>'${loadId}'`);
  const cols = "origin_district_id, dest_district_id, cargo_type, weight_ton, vehicle_type, price_type, load_from, load_to";
  expect(psql(`select ${cols} from load_posts where id='${fresh}'`)).toBe(psql(`select ${cols} from load_posts where id='${loadId}'`));
  // Temizlik: moderasyonda kalırsa her koşuda biri birikiyor, yönetici kuyruğunun ilk sayfasını dolduruyordu
  expect((await api("POST", `/admin/loads/${fresh}/review`, admin, { decision: "ret" })).status).toBe(200);
  expect(errors).toEqual([]);
});
