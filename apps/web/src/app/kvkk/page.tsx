import { ACCOUNT_DELETION } from "@nakliye/shared";
import type { Metadata } from "next";
import { LegalPage } from "@/components/site-chrome";

export const metadata: Metadata = { title: "KVKK aydınlatma metni" };

/** W4: 6698 sayılı KVKK md. 10 aydınlatma metni (taslak). İşlenen veriler kodda gerçekten tutulanlarla sınırlı. */
export default function KvkkPage() {
  return (
    <LegalPage title="Kişisel verilerin işlenmesine ilişkin aydınlatma metni" updated="9 Ekim 2026">
      <section className="space-y-2">
        <h2>1. Veri sorumlusu</h2>
        <p>
          6698 sayılı Kişisel Verilerin Korunması Kanunu (&quot;KVKK&quot;) uyarınca veri sorumlusu [veri sorumlusunun unvanı ve adresi]&apos;dir
          (&quot;Seferna&quot;).
        </p>
      </section>
      <section className="space-y-2">
        <h2>2. İşlenen kişisel veriler</h2>
        <ul>
          <li>Kimlik ve iletişim: cep telefonu numarası, ad soyad.</li>
          <li>Firma bilgileri (girilirse): unvan, vergi ya da T.C. kimlik numarası, vergi dairesi, adres.</li>
          <li>Araç bilgileri (nakliyeciler): plaka, araç ve kasa tipi, kapasite.</li>
          <li>İlan ve işlem bilgileri: yük ve boş araç ilanları (ilçe düzeyinde konum), teklifler, taşımalar, teslim olayları, puan ve yorumlar, şikayetler.</li>
          <li>Kullanım kayıtları: ilan sahibinin numarasının hangi kullanıcıya ne zaman gösterildiği, bildirimler, oturum kayıtları.</li>
        </ul>
        <p>
          Konumunuz saklanmaz: &quot;yakınımdaki yükler&quot; araması için konum yalnız o arama sırasında kullanılır. Teslim kodu ve SMS
          bağlantıları veritabanında okunamaz (özetlenmiş) biçimde tutulur.
        </p>
      </section>
      <section className="space-y-2">
        <h2>3. İşleme amaçları</h2>
        <ul>
          <li>Hesap oluşturma ve telefonla giriş (tek kullanımlık SMS kodu).</li>
          <li>Yük sahibiyle nakliyeciyi buluşturma: ilan yayınlama, eşleştirme, teklif ve taşıma süreçleri.</li>
          <li>İlanların güncelliğini sağlama: ilan sahibine düzenli teyit sorusu (uygulama içi bildirim ve SMS).</li>
          <li>Güvenlik ve kötüye kullanımın önlenmesi: numara gösterme ve şikayet sınırları, sahte ilan incelemesi, hesap askıya alma.</li>
          <li>Güven skoru ve puanlama; platformu geliştirmek için anonim istatistik (ör. haftalık tamamlanan taşıma sayısı).</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>4. Hukuki sebepler ve toplama yöntemi</h2>
        <p>
          Veriler, uygulama ve web paneli üzerinden sizin girdiğiniz bilgilerle ve kullanım sırasında elektronik ortamda toplanır. Hukuki sebepler:
          bir sözleşmenin kurulması ve ifası (KVKK md. 5/2-c), veri sorumlusunun meşru menfaati (md. 5/2-f; güvenlik ve kötüye kullanımın
          önlenmesi) ve kanuni yükümlülükler (md. 5/2-ç). Pazarlama amaçlı ileti gönderilmez; gönderilecekse ayrıca açık rızanız alınır.
        </p>
      </section>
      <section className="space-y-2">
        <h2>5. Aktarım</h2>
        <p>
          Bir teklif kabul edildiğinde taşımanın tarafları birbirinin adını ve telefon numarasını görür. Veriler, hizmetin yürütülmesi için
          barındırma ve SMS hizmeti sağlayıcılarına [sağlayıcıların adı ve bulunduğu ülke] aktarılabilir. Kanunen yetkili kurumların talebi
          hâlinde ilgili mevzuat çerçevesinde paylaşılır.
        </p>
      </section>
      <section className="space-y-2">
        <h2>6. Saklama süresi</h2>
        <p>
          Hesabınız açık kaldığı sürece ve ilgili mevzuattaki zamanaşımı süreleri boyunca saklanır [kesin süreler]. Hesap silindiğinde adınız,
          numaranız, firma bilgileriniz, plakalarınız, bildirimleriniz ve yazdığınız notlar silinir; tamamlanmış taşımalar ve verdiğiniz puanlar,
          karşı tarafın geçmişi ve istatistik için “Silinmiş kullanıcı” adıyla kalır. Silip yeniden kaydolarak puanların sıfırlanmasını önlemek
          için numaranızdan üretilen bir özet (numaranın kendisi değil) {ACCOUNT_DELETION.restoreDays} gün saklanır; bu sürede aynı numarayla giriş
          yaparsanız hesabınız puanları ve iş geçmişiyle yeniden açılır, süre dolunca özet silinir. Hesabınızla ilgili sonuçlanmamış bir şikayet
          varsa silme, inceleme sonuçlanana kadar ve en çok {ACCOUNT_DELETION.reportHoldDays} gün ertelenir.
        </p>
      </section>
      <section className="space-y-2">
        <h2>7. Haklarınız (KVKK md. 11)</h2>
        <p>
          Kişisel verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı
          üçüncü kişileri bilme, eksik ya da yanlış işlenmişse düzeltilmesini, silinmesini ya da yok edilmesini isteme, itiraz etme ve zarara
          uğradıysanız giderilmesini talep etme haklarına sahipsiniz. Verilerinizi panelde Hesap sayfasından (mobil uygulamada Profil’den)
          indirebilir, hesabınızı silebilirsiniz. Diğer başvurularınızı{" "}
          <a href="/iletisim" className="text-primary underline underline-offset-4">
            iletişim sayfasındaki
          </a>{" "}
          kanallardan iletebilirsiniz.
        </p>
      </section>
    </LegalPage>
  );
}
