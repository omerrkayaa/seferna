import { expect, test, type Page } from "@playwright/test";
import { acceptDialogs, api, btn, demoLogin, otpFor, phone, psql, seedDemo, vis } from "./helpers";
import { minPrefix, Ops, report } from "./usability";

// NFR-07 kullanılabilirlik (docs/03): "ilk ilanı vermek < 90 sn; yük aramaktan aramaya < 3 dokunuş". En kısa yol
// arayüzde yürünür; dokunuş, tuş ve karar adımları sayılır, süre KLM ile tahmin edilir (usability.ts). Yöntem ve
// sonuçlar arastirma/kullanilabilirlik/README.md; NFR07_OUT=<klasör> verilirse sonuçlar JSON olarak yazılır.
// Güzergâh: Aydın/Nazilli → İstanbul/Esenyurt (demo koridoru).

type Province = { name: string; districts: { name: string }[] };
let provinces: Province[];
test.beforeAll(async () => {
  provinces = (await api<Province[]>("GET", "/locations")).body;
});

/** Seçici: aç, aramaya hedef ilk sırada çıkana kadar yaz (arama kutusu kendiliğinden odakta), satıra dokun */
async function pick(u: Ops, page: Page, trigger: RegExp | string, n: number, search: string, names: string[], target: string) {
  await u.tap(btn(page, trigger).nth(n));
  const box = page.getByLabel(search).locator("visible=true");
  await u.type(box, minPrefix(names, target, "includes"));
  await u.tap(btn(page, target, true));
  await expect(box).toHaveCount(0);
}

/** İlan formunda il → ilçe (n: 0 kalkış, 1 varış) */
async function place(u: Ops, page: Page, n: number, label: string, province: string, district: string) {
  u.step(`${label} ili`);
  await pick(u, page, /^İl: /, n, "İl ara", provinces.map((p) => p.name), province);
  u.step(`${label} ilçesi`);
  await pick(u, page, /^İlçe: /, n, "İlçe ara", provinces.find((p) => p.name === province)!.districts.map((d) => d.name), district);
}

test("ilk ilan: yeni yük sahibi uygulamayı açtıktan sonra ilanını gönderir (< 90 sn)", async ({ page }) => {
  const me = phone(80);
  await page.goto("/");
  const tel = page.getByLabel("Cep telefonu").locator("visible=true");
  await expect(tel).toBeVisible({ timeout: 30_000 });

  const u = new Ops(false);
  u.step("Telefon numarası");
  await u.type(tel, `0${me.slice(3)}`);
  await u.tap(vis(page, "SMS kodu gönder"));
  u.step("SMS kodu");
  const code = page.getByLabel("SMS kodu").locator("visible=true");
  await expect(code).toBeVisible();
  await u.type(code, await otpFor(me));
  await u.tap(vis(page, "Giriş yap"));
  u.step("Rol: yük sahibi");
  await u.tap(vis(page, "Yük sahibiyim (yük veriyorum)"));
  await u.tap(vis(page, "Devam"));
  u.step("İlan ver");
  await u.tap(vis(page, "İlan ver", true));

  // Yalnız zorunlu alanlar; yükleme günü (bugün, 1 gün), kasa (fark etmez) ve fiyat (teklif alayım) varsayılan
  const form = u.mark();
  await place(u, page, 0, "Kalkış", "Aydın", "Nazilli");
  await place(u, page, 1, "Varış", "İstanbul", "Esenyurt");
  u.step("Yük cinsi");
  await u.tap(vis(page, "Palet", true));
  u.step("Ağırlık");
  await u.type(page.getByLabel("Ağırlık (ton)").locator("visible=true"), "18");
  u.step("Araç tipi");
  await u.tap(vis(page, "Tır", true));
  u.step("Yayınla");
  await u.tap(vis(page, "İlanı yayınla"));
  // Yeni hesabın ilk ilanı moderasyona düşer (BR-11): kullanıcının işi gönderimle biter
  await expect(vis(page, "Onay bekliyor")).toBeVisible();

  const all = u.result("İlk ilan (yeni hesap): uygulamayı açmaktan ilanın gönderilmesine");
  const onlyForm = u.result("İlan formu: formun açılmasından gönderilmesine", form);
  report("mobil", "ilk-ilan", all);
  report("mobil", "ilan-formu", onlyForm);
  psql(`update load_posts set status='iptal' where shipper_id=(select id from users where phone='${me}')`);
  expect(all.typicalSec).toBeLessThan(90);
});

test("aramadan aramaya: nakliyeci yük akışından yük sahibini arar (< 3 dokunuş)", async ({ page }) => {
  seedDemo();
  const dialogs = acceptDialogs(page);
  await demoLogin(page);
  await expect(vis(page, /^Teyitli ·/).first()).toBeVisible();
  // Web derlemesinde "Ara" numarayı uyarıyla gösterir; telefonda arama ekranı açılır ve orada bir dokunuş daha gerekir
  const called = async (n: number) => {
    await expect.poll(() => dialogs.length).toBe(n);
    expect(dialogs[n - 1]).toMatch(/^Yük sahibinin numarası: \+90\d{10}$/);
  };

  // a) Akıştaki kartın "Ara" düğmesi
  let u = new Ops(false);
  u.step("Kartta Ara");
  await u.tap(vis(page, "Ara", true).first());
  await called(1);
  u.outsideTap("Telefonun arama ekranında ara");
  const feed = u.result("Akıştaki karttan arama");

  // b) Önce kalkış ilini seçip (uygulamayı aç → rotayı seç → ara)
  u = new Ops(false);
  u.step("Nereden");
  await pick(u, page, "Nereden: Her yer", 0, "Nereden ara", provinces.map((p) => p.name), "Aydın");
  await expect(vis(page, /, Aydın$/).first()).toBeVisible();
  u.step("Kartta Ara");
  await u.tap(vis(page, "Ara", true).first());
  await called(2);
  u.outsideTap("Telefonun arama ekranında ara");
  const route = u.result("Kalkış ili seçip karttan arama");

  // b2) Uygulama yeniden açılınca son rota hatırlanır: yük akışı o rotayla gelir
  await page.reload();
  await expect(btn(page, "Nereden: Aydın")).toBeVisible({ timeout: 20_000 });
  await expect(vis(page, /, Aydın$/).first()).toBeVisible();
  u = new Ops(false);
  u.step("Kartta Ara");
  await u.tap(vis(page, "Ara", true).first());
  await called(3);
  u.outsideTap("Telefonun arama ekranında ara");
  const remembered = u.result("Hatırlanan rotayla (uygulama yeniden açılınca) karttan arama");

  // c) Kartı açıp yük detayından
  u = new Ops(false);
  u.step("Kartı aç");
  await u.tap(btn(page, / yükü$/).first());
  await expect(vis(page, "Yük sahibi", true)).toBeVisible();
  u.step("Detayda Ara");
  await u.tap(vis(page, "Ara", true));
  await called(4);
  u.outsideTap("Telefonun arama ekranında ara");
  const detail = u.result("Yük detayından arama");

  report("mobil", "arama-akistan", feed);
  report("mobil", "arama-rotayla", route);
  report("mobil", "arama-hatirlanan-rotayla", remembered);
  report("mobil", "arama-detaydan", detail);
  expect(feed.taps + feed.outsideTaps).toBeLessThan(3);
  expect(remembered.taps + remembered.outsideTaps).toBeLessThan(3);
});
