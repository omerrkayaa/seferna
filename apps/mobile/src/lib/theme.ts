// Lacivert (güven) + turuncu vurgu, "Ara" yeşil; açık tema öncelikli. Web paneliyle aynı tonlar.
// NFR-06 (WCAG AA, axe taraması 2026-10-15): metin 4,5:1, grafik/durum 3:1. Turuncu zeminde yazı koyu (beyaz 2,9:1
// kalıyordu); yeşil koyulaştırıldı (#1F9D55'te beyaz 3,5:1, açık yeşil zeminde yazı 3,1:1 idi); turuncu metin ve
// seçili yıldız için koyu turuncu.
export const C = {
  primary: "#1E3A5F",
  primaryText: "#FFFFFF",
  accent: "#EA7A2B",
  /** Turuncu zemin üzerindeki yazı ve simge */
  accentOn: "#14202E",
  /** Beyaz/açık zeminde turuncu metin ve simge (5,5:1) */
  accentText: "#A8501A",
  call: "#157A41",
  bg: "#F4F6F9",
  card: "#FFFFFF",
  text: "#14202E",
  muted: "#5B6676",
  border: "#DDE2EA",
  danger: "#C62828",
  ok: "#157A41",
  okBg: "#E5F5EC",
  warn: "#8A5A00",
  warnBg: "#FFF3D6",
  idle: "#5B6676",
  idleBg: "#ECEFF3",
} as const;

/** Şoför dostu: en az 48 dp dokunma alanı */
export const TOUCH = 48;
