// İletişim ve kötüye kullanım kuralları — docs/03 BR-05, BR-12, BR-40

/**
 * BR-40: teklif kabulünden önce numara listede maskeli görünür ("Ara" ile açılır ve loglanır).
 * "+905321234567" → "0532 *** ** 67". Silinen hesabın numarası yoktur (FR-07): "—".
 */
export function maskPhone(e164: string | null): string {
  if (!e164) return "—";
  const d = e164.replace(/^\+90/, "");
  return `0${d.slice(0, 3)} *** ** ${d.slice(8)}`;
}

/** Kötüye kullanım sınırları (numara toplama ve şikayet spamine karşı); parametrik, kullanımda gözlenecek. */
export const ABUSE_LIMITS = {
  /** Bir kullanıcının 24 saatte numarasını açabileceği farklı ilan sayısı (BR-40) */
  callsPerDay: 30,
  /** Bir kullanıcının 24 saatte gönderebileceği şikayet sayısı */
  reportsPerDay: 20,
};

/**
 * BR-05'te sayılan şikayetçi. Kuraldaki "doğrulanmış kullanıcı" şartına ek olarak ilanı gerçekten aramış
 * kullanıcı da sayılır: ilan sahibini arayıp "yük gitti" cevabını alan kişi güvenilir tanıktır.
 * (2026-10-07 kararı: seviye hesabı henüz yokken kural hiç tetiklenmezdi; herkesi saymak da iki sahte
 * hesapla rakip ilanı düşürmeye açıktı. Etki sınırlı: ilan silinmez, sahibine anında teyit sorulur.)
 */
export const isQualifiedReporter = (r: { verificationLevel: number; calledThisLoad: boolean }) =>
  r.verificationLevel >= 1 || r.calledThisLoad;
