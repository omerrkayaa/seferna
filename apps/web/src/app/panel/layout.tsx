import Link from "next/link";
import { Suspense } from "react";
import { Bell, LogOut, Truck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { logoutAction } from "./actions";

export default function PanelLayout({ children }: LayoutProps<"/panel">) {
  return (
    <div className="flex flex-1 flex-col">
      {/* Koyu temada birincil renk açık mavi; üst bilgi koyu zeminde kalsın */}
      <header className="border-b bg-primary text-primary-foreground dark:bg-card dark:text-card-foreground">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
          <Link href="/panel" aria-label="Seferna" className="flex shrink-0 items-center gap-2 font-bold">
            <Truck className="size-5 text-brand-accent" aria-hidden />
            {/* Dar ekranda yalnız simge: menüye yer kalsın */}
            <span className="hidden sm:inline">Seferna</span>
          </Link>
          {/* Dar ekranda menü kendi içinde kayar (yönetici + zil ile 390 px'e sığmıyor); sayfa yatay taşmaz */}
          <nav className="flex min-w-0 gap-4 overflow-x-auto text-sm whitespace-nowrap">
            <Link href="/panel" className="underline-offset-4 hover:underline">
              Gösterge
            </Link>
            <Link href="/panel/ilanlar" className="underline-offset-4 hover:underline">
              İlanlarım
            </Link>
            <Link href="/panel/tasimalar" className="underline-offset-4 hover:underline">
              Taşımalar
            </Link>
            <Link href="/panel/nakliyecilerim" className="underline-offset-4 hover:underline">
              Nakliyecilerim
            </Link>
            <Link href="/panel/firma" className="underline-offset-4 hover:underline">
              Firma
            </Link>
            <Link href="/panel/hesap" className="underline-offset-4 hover:underline">
              Hesap
            </Link>
            <Suspense>
              <AdminLink />
            </Suspense>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-3 text-sm">
            <Suspense>
              <UserName />
            </Suspense>
            <ThemeToggle className="hover:bg-white/10" />
            <Suspense>
              <NotificationBell />
            </Suspense>
            <form action={logoutAction}>
              {/* Dar ekranda yalnız simge (yönetici menüsüyle başlık 390 px'e sığsın); ad ekran okuyucuda kalır */}
              <Button type="submit" variant="ghost" size="sm" aria-label="Çıkış" className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground dark:text-card-foreground dark:hover:text-card-foreground">
                <LogOut aria-hidden /> <span className="hidden sm:inline">Çıkış</span>
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}

async function UserName() {
  const me = await api<Me>("/me");
  // Telefon genişliğinde menü sığsın diye ad gizlenir
  return (
    <Link href="/panel/firma" className="hidden opacity-90 underline-offset-4 hover:underline sm:inline">
      {me.company?.title ?? me.name ?? `0${me.phone.slice(3)}`}
    </Link>
  );
}

async function AdminLink() {
  const me = await api<Me>("/me");
  return me.roles.includes("admin") ? (
    <Link href="/panel/yonetim" className="underline-offset-4 hover:underline">
      Yönetim
    </Link>
  ) : null;
}

/** Okunmamış bildirim sayısı (push yok; sayfa yüklenince ve işlem sonrası tazelenir) */
async function NotificationBell() {
  const { unread } = await api<{ unread: number }>("/notifications");
  return (
    <Link
      href="/panel/bildirimler"
      aria-label={unread > 0 ? `Bildirimler, ${unread} okunmamış` : "Bildirimler"}
      className="relative inline-flex size-9 items-center justify-center rounded-md hover:bg-white/10"
    >
      <Bell className="size-5" aria-hidden />
      {unread > 0 && (
        <span aria-hidden className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-brand-accent px-1 text-center text-[10px] leading-4 font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
