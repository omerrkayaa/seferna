// NFR-07 kullanılabilirlik (docs/03): "ilk ilanı vermek < 90 sn". Yeni yük sahibinin giriş sayfasından ilk ilanını
// gönderene kadarki en kısa yolu arayüzde yürünür; tıklama, tuş, karar adımı ve el değiştirme sayılır, süre KLM ile
// tahmin edilir (usability.ts). Açılır listeler fare + harfle atlama ile seçilir (tıkla, ilk harfler, Enter).
// Yöntem ve sonuçlar arastirma/kullanilabilirlik/README.md; NFR07_OUT=<klasör> verilirse sonuçlar JSON olarak yazılır.
import { expect, test } from "@playwright/test";
import { localPhone, otpFor, phone, psql } from "./helpers";
import { Ops, report } from "./usability";

test("ilk ilan: yeni yük sahibi giriş sayfasından ilanını gönderir (< 90 sn)", async ({ page }) => {
  const me = phone(970);
  await page.goto("/giris");
  const tel = page.getByLabel("Cep telefonu");
  await expect(tel).toBeVisible();

  const u = new Ops(true);
  u.step("Telefon numarası");
  await u.type(tel, localPhone(me));
  await u.tap(page.getByRole("button", { name: "SMS kodu gönder" }));
  u.step("SMS kodu");
  const code = page.getByLabel(/numarasına gelen kod/);
  await expect(code).toBeVisible();
  await u.type(code, await otpFor(me));
  await u.tap(page.getByRole("button", { name: "Giriş yap" }));
  u.step("Rol: yük sahibi");
  await u.tap(page.getByRole("button", { name: "Yük sahibi olarak devam et" }));
  u.step("Yeni ilan");
  await u.tap(page.getByRole("link", { name: "Yeni ilan" }).first());
  await expect(page).toHaveURL(/\/panel\/ilanlar\/yeni$/);

  // Yalnız zorunlu alanlar; yükleme tarihleri (bugün), kasa (fark etmez) ve fiyat (teklif alayım) varsayılan
  const form = u.mark();
  for (const [label, value] of [
    ["Kalkış ili", "Aydın"],
    ["Kalkış ilçesi", "Nazilli"],
    ["Varış ili", "İstanbul"],
    ["Varış ilçesi", "Esenyurt"],
    ["Yük cinsi", "Palet"],
  ]) {
    u.step(label);
    await u.choose(page.getByLabel(label, { exact: true }), value);
  }
  u.step("Ağırlık");
  await u.type(page.getByLabel("Ağırlık (ton)"), "18");
  u.step("Araç tipi");
  await u.choose(page.getByLabel("Araç tipi"), "Tır");
  u.step("Yayınla");
  await u.tap(page.getByRole("button", { name: "İlanı yayınla" }));
  // Yeni hesabın ilk ilanı moderasyona düşer (BR-11): kullanıcının işi gönderimle biter
  await expect(page).toHaveURL(/\/panel\/ilanlar\/[0-9a-f-]{36}\?yeni=1$/);
  await expect(page.getByText("Onay bekliyor")).toBeVisible();

  const all = u.result("İlk ilan (yeni hesap): giriş sayfasından ilanın gönderilmesine");
  const onlyForm = u.result("İlan formu: formun açılmasından gönderilmesine", form);
  report(`web-${test.info().project.name}`, "ilk-ilan", all);
  report(`web-${test.info().project.name}`, "ilan-formu", onlyForm);
  psql(`update load_posts set status='iptal' where shipper_id=(select id from users where phone='${me}')`);
  expect(all.typicalSec).toBeLessThan(90);
});
