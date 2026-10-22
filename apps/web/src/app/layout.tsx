import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import { SITE_URL } from "@/lib/site";
import { ThemeScript } from "@/components/theme-script";
import "./globals.css";

// Türkçeden latin alt kümesinde yalnız ı var; ğ, ş, İ (ve ₺) 85 KB'lık latin-ext yerine aynı yazı tipinin 3 KB'lık alt
// kümesinden gelir (src/fonts/README.md). globals.css'te önce bu aile: unicode-range dışındaki harfler Inter'e düşer.
// Kendi yedek yazı tipi kapalı: olsaydı yığında Inter'den önce gelip bütün harfleri Arial'la çizerdi.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const interTr = localFont({
  src: "../fonts/inter-tr.woff2",
  variable: "--font-inter-tr",
  weight: "100 900",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+011E-011F, U+0130, U+015E-015F, U+20BA" }],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Seferna", template: "%s · Seferna" },
  description: "Gördüğün her yük gerçek ve şu an geçerli. Yük sahibi ile nakliyeciyi buluşturan platform.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme'i satır içi betik yazar (sunucu kullanıcının temasını bilmez); suppressHydrationWarning bu farkı kabul ettirir
    <html lang="tr" className={`${inter.variable} ${interTr.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
