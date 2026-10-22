import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Yönetici iki adımlı doğrulaması (NFR-04, docs/04 §8): RFC 6238 TOTP — SHA-1, 6 hane, 30 sn. Google Authenticator ve
 * Microsoft Authenticator bu varsayılanları destekler (Google'ın bazı sürümleri algorithm/digits/period'u yok sayar;
 * bu yüzden varsayılandan sapılmaz). Harici servis yok: kod telefondaki uygulamada, saatten üretilir.
 */
export const TOTP_PERIOD_S = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("base32 değil");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 bit gizli anahtar (RFC 4226 önerisi) */
export const newTotpSecret = () => randomBytes(20);

export const totpStep = (ms: number) => Math.floor(ms / 1000 / TOTP_PERIOD_S);

/** RFC 4226 HOTP: HMAC-SHA-1, dinamik kesme */
export function hotp(key: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
}

/**
 * Kodun eşleştiği zaman adımı; saat kayması için bir önceki ve bir sonraki adım da kabul edilir (±30 sn). Yalnız
 * lastStep'ten büyük adımlar: kullanılmış kod (ya da daha eskisi) yeniden kabul edilmez (tekrar oynatma).
 */
export function matchTotp(key: Buffer, code: string, lastStep: number, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const cur = totpStep(nowMs);
  let found: number | null = null;
  for (let s = cur - 1; s <= cur + 1; s++) {
    // Sabit süreli karşılaştırma; döngü erken bitmez
    if (s > lastStep && timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(code))) found = s;
  }
  return found;
}

/** Uygulamanın tarayacağı adres (QR). Etiket hesabı ayırt eder; anahtar elle de girilebilir (base32). */
export function otpauthUrl(secret: Buffer, label: string): string {
  const issuer = "Seferna";
  const params = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(TOTP_PERIOD_S) });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?${params}`;
}

/**
 * Gizli anahtar DB'de AES-256-GCM ile şifreli: yalnız DB sızarsa (yedek, SQL enjeksiyonu) kodlar üretilemesin. Anahtar
 * TOTP_KEY, yoksa OTP_PEPPER'dan HKDF ile türetilir; değişirse kurulu uygulamalar geçersizleşir (yeniden kurulum). Kayıt
 * kullanıcı kimliğine bağlı (AAD): şifreli değer başka kullanıcının satırına taşınırsa açılmaz.
 */
function sealKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", process.env.TOTP_KEY || process.env.OTP_PEPPER || "", "", "nakliye-totp-secret-v1", 32));
}

export function sealSecret(secret: Buffer, userId: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", sealKey(), iv).setAAD(Buffer.from(userId));
  const ct = Buffer.concat([c.update(secret), c.final()]);
  return ["v1", iv, ct, c.getAuthTag()].map((x) => (typeof x === "string" ? x : x.toString("base64url"))).join(".");
}

export function openSecret(sealed: string, userId: string): Buffer {
  const [v, iv, ct, tag] = sealed.split(".");
  if (v !== "v1" || !iv || !ct || !tag) throw new Error("şifreli anahtar biçimi");
  const d = createDecipheriv("aes-256-gcm", sealKey(), Buffer.from(iv, "base64url")).setAAD(Buffer.from(userId));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]);
}

/** Kurtarma kodları: 10 adet, "ABCDE-FGH23" (karışan I, O, 0, 1 yok; kod başına 50 bit), tek kullanımlık */
const RC_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_COUNT = 10;
export function newRecoveryCode(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += RC_ALPHABET[randomInt(RC_ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
/** Kullanıcının yazdığı kurtarma kodu: büyük harfe, ayırıcısız; biçime uymuyorsa null */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  return new RegExp(`^[${RC_ALPHABET}]{10}$`).test(s) ? s : null;
}
/** Anahtarlı özet: DB sızsa da 50 bitlik kodlar çevrimdışı denenemez */
export const recoveryCodeHash = (userId: string, normalized: string) =>
  createHmac("sha256", process.env.OTP_PEPPER ?? "").update(`recovery:${userId}:${normalized}`).digest("hex");
