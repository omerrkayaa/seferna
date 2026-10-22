import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/** WhatsApp/Telegram önizleme kartı (Open Graph) ölçüsü */
export const OG_SIZE = { width: 1200, height: 630 };

const NAVY = "#1b365d"; // --primary
const ORANGE = "#ec7a2a"; // --brand-accent
const SLOGAN = "Gördüğün her yük gerçek ve şu an geçerli.";

/**
 * Sitenin yazı tipi Inter, Latin + Latin-ext (ş, ğ, ı, İ Latin-ext'te). İki alt küme ayrı aile adıyla: aynı adla
 * verilince satori eksik harfi listedeki sıradaki dosyadan (kalın başlıkta da normal kalınlıktan) alıyordu. Satori woff
 * okur, woff2 okumaz; dosyalar @fontsource/inter paketinden diskten okunur (ağdan yazı tipi çekilmez).
 */
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" }[]> | undefined;
function loadFonts() {
  const resolve = createRequire(join(process.cwd(), "package.json")).resolve;
  const file = (subset: string, weight: 400 | 700) => readFile(resolve(`@fontsource/inter/files/inter-${subset}-${weight}-normal.woff`));
  fonts ??= Promise.all(
    (["latin", "latin-ext"] as const).flatMap((subset) => ([400, 700] as const).map(async (weight) => ({ name: subset === "latin" ? "Inter" : "Inter Ext", data: await file(subset, weight), weight, style: "normal" as const }))),
  );
  return fonts;
}

/** lucide "truck" (sayfa başlığındaki simge) */
function TruckIcon() {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </svg>
  );
}

/**
 * Önizleme kartı: marka, büyük başlık (bir ya da iki satır), bilgi çipleri, alt satırda slogan. Metin yalnız düz
 * yazı; numara ya da kişi bilgisi konmaz (paylaşım sayfasındaki kural).
 */
export async function ogCard({ title, chips = [], footer = SLOGAN }: { title: string[]; chips?: string[]; footer?: string }) {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: NAVY, color: "white", padding: "60px 72px", fontFamily: '"Inter", "Inter Ext"' }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 44, fontWeight: 700 }}>
        <TruckIcon />
        Seferna
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", fontSize: title.join("").length > 44 ? 58 : 68, fontWeight: 700, lineHeight: 1.15 }}>
          {title.map((t) => (
            <div key={t} style={{ display: "flex" }}>
              {t}
            </div>
          ))}
        </div>
        {chips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {chips.map((c) => (
              <div key={c} style={{ display: "flex", padding: "10px 22px", borderRadius: 999, background: "rgba(255,255,255,0.14)", fontSize: 30 }}>
                {c}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 28, color: "#c8d3e3" }}>
        <div style={{ display: "flex", width: 14, height: 14, borderRadius: 999, background: ORANGE }} />
        {footer}
      </div>
    </div>,
    { ...OG_SIZE, fonts: await loadFonts() },
  );
}
