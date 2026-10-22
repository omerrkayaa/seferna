// SMS metinleri (F1 teyit SMS'i).
// Maliyet notu: ı, ş, ğ, ç gibi harfler GSM-7 alfabesinde yok; mesajda tek biri bile olsa SMS UCS-2'ye geçer ve
// bir SMS 160 yerine 70 karakter taşır. Link içeren teyit mesajı böylece 2–3 SMS'e bölünür. Bu yüzden teyit
// SMS'i ASCII'ye çevrilip tek SMS'e (160 karakter) sığdırılır.

const FOLD: Record<string, string> = {
  ı: "i", İ: "I", ş: "s", Ş: "S", ğ: "g", Ğ: "G", ç: "c", Ç: "C",
  ö: "o", Ö: "O", ü: "u", Ü: "U", â: "a", Â: "A", î: "i", Î: "I", û: "u", Û: "U",
};

/** Türkçe harfleri ASCII karşılığına çevirir (GSM-7'de güvenli). */
export const toGsm7 = (s: string) => s.replace(/[ıİşŞğĞçÇöÖüÜâÂîÎûÛ]/g, (c) => FOLD[c] ?? c);

/** Tek SMS'e sığan en fazla GSM-7 karakter sayısı. */
export const SINGLE_SMS_LENGTH = 160;

/**
 * "Hâlâ geçerli mi?" SMS'i. Önce il/ilçe ile dener; uzun alan adı vb. yüzünden 160'ı aşarsa yalnız il adlarını kullanır.
 * @param origin ör. { province: "İzmir", district: "Konak" }
 */
export function confirmationSmsText(
  origin: { province: string; district: string },
  dest: { province: string; district: string },
  link: string,
): string {
  const build = (o: string, d: string) => toGsm7(`Seferna: ${o} > ${d} ilaniniz hala gecerli mi? Yanitlayin: ${link}`);
  const full = build(`${origin.province}/${origin.district}`, `${dest.province}/${dest.district}`);
  return full.length <= SINGLE_SMS_LENGTH ? full : build(origin.province, dest.province);
}
