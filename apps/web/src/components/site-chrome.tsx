import Link from "next/link";
import { Truck } from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";

/** Herkese açık sayfaların (W1–W4) üst ve alt bilgisi. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-primary">
          <Truck className="size-6" aria-hidden /> Seferna
        </Link>
        <nav aria-label="Site" className="flex items-center gap-4 text-sm">
          <Link href="/#nasil-calisir" className="hidden underline-offset-4 hover:underline sm:inline">
            Nasıl çalışır
          </Link>
          <Link href="/fiyat" className="hidden underline-offset-4 hover:underline sm:inline">
            Fiyat hesapla
          </Link>
          <Link href="/#guven" className="hidden underline-offset-4 hover:underline sm:inline">
            Güven
          </Link>
          <Link href="/#sss" className="hidden underline-offset-4 hover:underline sm:inline">
            SSS
          </Link>
          <ThemeToggle />
          <Link href="/panel" className={buttonVariants({ size: "sm" })}>
            Giriş
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-muted/30">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-muted-foreground">
        <p>© 2026 Seferna</p>
        <nav aria-label="Kurumsal" className="flex flex-wrap gap-4">
          <Link href="/rehber" className="underline-offset-4 hover:underline">
            Rehber
          </Link>
          <Link href="/hakkimizda" className="underline-offset-4 hover:underline">
            Hakkımızda
          </Link>
          <Link href="/kvkk" className="underline-offset-4 hover:underline">
            KVKK aydınlatma metni
          </Link>
          <Link href="/kullanim-sartlari" className="underline-offset-4 hover:underline">
            Kullanım şartları
          </Link>
          <Link href="/iletisim" className="underline-offset-4 hover:underline">
            İletişim
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/** W4 yasal sayfa kabuğu: taslak uyarısı + okunur metin genişliği. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">Son güncelleme: {updated}</p>
        </div>
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          Bu metin taslaktır: platform deneme aşamasındadır ve metin yayından önce hukuki incelemeden geçecektir.
          Köşeli parantez içindeki bilgiler henüz belirlenmemiştir.
        </p>
        <div className="space-y-6 leading-relaxed [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
