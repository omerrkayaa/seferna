import { OG_SIZE, ogCard } from "@/lib/og";

export const alt = "Seferna: yük sahibiyle nakliyeciyi buluşturan, bayat ilanı listeden düşüren platform";
export const size = OG_SIZE;
export const contentType = "image/png";

/** Sitenin genel önizleme görseli (ana sayfa ve kendi görseli olmayan sayfalar) */
export default async function Image() {
  return ogCard({
    title: ["Gördüğün her yük gerçek", "ve şu an geçerli."],
    chips: ["Yük sahibi ile nakliyeci", "Bayat ilan listeden düşer"],
    footer: "Aydın – İzmir – Manisa – İstanbul hattında başlıyoruz",
  });
}
