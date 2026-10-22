import type { Metadata } from "next";
import { LegalPage } from "@/components/site-chrome";

export const metadata: Metadata = { title: "Kullanım şartları" };

/** W4: kullanım şartları (taslak). Kurallar platformda gerçekten uygulananlarla aynı (BR-05, BR-11, BR-31, BR-32, BR-40, FR-51). */
export default function TermsPage() {
  return (
    <LegalPage title="Kullanım şartları" updated="9 Ekim 2026">
      <section className="space-y-2">
        <h2>1. Hizmetin niteliği</h2>
        <p>
          Seferna, yük sahipleriyle nakliyecileri buluşturan bir teknoloji platformudur. Taşıma sözleşmesinin tarafı değildir; fiyat, ödeme ve
          taşımanın yürütülmesi taraflar arasındadır. Platform şu an deneme aşamasındadır ve kullanım için ücret
          alınmaz.
        </p>
      </section>
      <section className="space-y-2">
        <h2>2. Hesap</h2>
        <ul>
          <li>Hesap cep telefonu numarasıyla açılır; giriş kodu SMS ile gelir. Kodu kimseyle paylaşmayın.</li>
          <li>Girdiğiniz ad, firma ve araç bilgilerinin doğru olmasından siz sorumlusunuz.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>3. İlanlar</h2>
        <ul>
          <li>Yalnız gerçekten var olan yük ve boş araç için ilan verin. İlan metnine telefon numarası yazmayın.</li>
          <li>Yayındaki ilanınıza düzenli olarak &quot;hâlâ geçerli mi?&quot; diye sorulur; cevap verilmezse ilan listeden düşer.</li>
          <li>Yeni hesapların ilk ilanları yayından önce kontrol edilir. Birden çok &quot;yük yok&quot; şikayeti alan ilan hemen yeniden teyit istenir.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>4. Numaralar ve iletişim</h2>
        <p>
          İlan sahibinin numarası listede gizlidir; nakliyeci &quot;Ara&quot; dediğinde açılır ve bu kayda geçer. Günlük açılabilecek numara ve
          verilebilecek şikayet sayısı sınırlıdır. Numaraları ilan dışı amaçla (reklam, toplu mesaj vb.) kullanmak yasaktır.
        </p>
      </section>
      <section className="space-y-2">
        <h2>5. Teklif, taşıma ve teslim</h2>
        <ul>
          <li>Kabul edilen teklifle taşıma oluşur; taraflar birbirinin numarasını görür.</li>
          <li>Teslimde nakliyeci, alıcıdan aldığı 6 haneli teslim kodunu girer. Yük sahibi teslimden sonra 48 saat içinde itiraz edebilir; itiraz yoksa taşıma tamamlanır.</li>
          <li>İtirazları yönetici iki tarafı dinleyerek karara bağlar.</li>
          <li>İptal, teslimden önce gerekçeyle yapılabilir ve iptal edenin güven skoruna yansır.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>6. Puanlama ve güven skoru</h2>
        <p>
          Puan yalnız tamamlanan taşımadan sonra, 14 gün içinde ve bir kez verilir; iki taraf da puanlayınca ya da süre dolunca görünür. Güven
          skoru puanlar, tamamlanan işler, iptaller ve haklı bulunan şikayetlerden hesaplanır.
        </p>
      </section>
      <section className="space-y-2">
        <h2>7. Askıya alma</h2>
        <p>
          Sahte ilan, numaraların kötüye kullanılması ya da bu şartlara aykırılık hâlinde hesap askıya alınabilir; askıdaki hesabın yayındaki
          ilanları kaldırılır.
        </p>
      </section>
      <section className="space-y-2">
        <h2>8. Sorumluluk</h2>
        <p>
          Platform, ilan ve kullanıcı bilgilerinin doğruluğunu artırmak için önlemler alır ancak taşımanın kendisinden doğan zararlardan taraf
          olarak sorumlu değildir [sorumluluk sınırları hukuki incelemeyle belirlenecek].
        </p>
      </section>
    </LegalPage>
  );
}
