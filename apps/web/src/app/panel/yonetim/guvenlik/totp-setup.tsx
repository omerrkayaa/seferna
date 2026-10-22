"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";
import { Field, invalid, submitWithoutReset } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { enableAction, regenerateAction, startSetupAction, type RegenerateState, type SetupState } from "./actions";

/** Anahtar dörder karakterlik gruplarla (elle yazarken kolay okunsun; uygulamalar boşlukları yok sayar) */
const grouped = (s: string) => s.match(/.{1,4}/g)?.join(" ") ?? s;

type EnableState = [SetupState, (data: FormData) => void, boolean];

/**
 * Yönetim bölümü kapısı (NFR-04). Etkinleştirme çerezleri yazınca Next sayfayı sunucuda yeniden çizer ve yerleşim
 * "tamam"a döner; etkinleştirme durumu kurulum bileşeninde dursaydı bileşen kalkar, kurtarma kodları hiç görünmezdi.
 * Bu bileşen yerleşimde her iki durumda aynı yerde durur (durum korunur): kodlar "Devam"a kadar ekranda kalır.
 * children yalnız oturum ikinci adımı geçince verilir (kurulumda sayfa yönetici API'sini çağırıp 403 alırdı).
 */
export function MfaGate({ setup, children }: { setup: boolean; children: ReactNode }) {
  const enableState = useActionState<SetupState, FormData>(enableAction, {});
  const [seen, setSeen] = useState(false);
  const codes = enableState[0].recoveryCodes;
  if (codes && !seen) return <RecoveryCodes codes={codes} onDone={() => setSeen(true)} />;
  if (!setup) return children;
  return (
    <section aria-labelledby="mfa-setup" className="max-w-xl space-y-3 rounded-lg border p-6">
      <h2 id="mfa-setup" className="text-lg font-semibold">
        İki adımlı doğrulamayı kurun
      </h2>
      <p className="text-sm text-muted-foreground">
        Yönetici işlemleri için SMS kodu yetmez: girişte telefonunuzdaki doğrulama uygulamasının ürettiği kod da istenir. Kurulum bir kez yapılır; kod internet ya da SMS gerektirmez.
      </p>
      <TotpSetup enableState={enableState} />
    </section>
  );
}

/**
 * NFR-04 doğrulama uygulaması kurulumu: başlat → QR (ya da anahtar) → uygulamadaki kod → kurtarma kodları.
 * changing: kurulu hesapta telefon değiştirme (önce mevcut uygulamadan kod istenir). enableState: etkinleştirme durumu
 * dışarıda tutuluyorsa (MfaGate) kodları o gösterir.
 */
export function TotpSetup({ changing = false, enableState }: { changing?: boolean; enableState?: EnableState }) {
  const router = useRouter();
  const [setup, start, starting] = useActionState<SetupState, FormData>(startSetupAction, {});
  const own = useActionState<SetupState, FormData>(enableAction, {});
  const [done, enable, enabling] = enableState ?? own;

  // Telefon değiştirme: sayfa aynı kaldığı için kodlardan sonra yönetim ana sayfasına geçilir (kodlar ekranda kalmasın)
  if (done.recoveryCodes && !enableState) return <RecoveryCodes codes={done.recoveryCodes} onDone={() => router.push("/panel/yonetim")} />;

  if (!setup.secret) {
    return (
      <form onSubmit={submitWithoutReset(start)} className="space-y-3">
        {changing && (
          <Field label="Mevcut uygulamadaki kod (ya da bir kurtarma kodu)" htmlFor="current-code" error={setup.error}>
            <Input id="current-code" name="code" autoComplete="one-time-code" spellCheck={false} maxLength={20} className="h-11 max-w-56" {...invalid("current-code", setup.error)} />
          </Field>
        )}
        <Button type="submit" className="h-11" disabled={starting}>
          {changing ? "Yeni telefonu kur" : "Kurulumu başlat"}
        </Button>
        {!changing && setup.error && (
          <p role="alert" className="text-sm text-destructive">
            {setup.error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>
          Telefonunuza <strong>Google Authenticator</strong> ya da <strong>Microsoft Authenticator</strong> uygulamasını kurun (ücretsiz).
        </li>
        <li>Uygulamada “QR kodu tara”yı seçip aşağıdaki kodu okutun.</li>
        <li>Uygulamada beliren 6 haneli kodu aşağıya yazın.</li>
      </ol>
      {/* Veri adresi (sunucuda üretilen PNG): next/image'ın iyileştirmesine gerek yok */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt="Doğrulama uygulaması için QR kodu" width={240} height={240} className="rounded-lg border bg-white p-2" />
      <div className="space-y-1.5 text-sm">
        <p>Tarayamıyorsanız uygulamada “Kurulum anahtarı gir”i seçin, hesap adı olarak “Seferna” yazın ve şu anahtarı girin (zamana dayalı):</p>
        {/* Gruplar arasındaki boşluklardan kırılır; grup ortadan bölünmez */}
        <code data-testid="totp-secret" className="block w-fit rounded bg-muted px-2 py-1 font-mono tracking-wide">
          {grouped(setup.secret)}
        </code>
      </div>
      <form onSubmit={submitWithoutReset(enable)} className="space-y-3">
        <Field label="Uygulamadaki 6 haneli kod" htmlFor="totp-code" error={done.error}>
          <Input id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-11 max-w-40" {...invalid("totp-code", done.error)} />
        </Field>
        <Button type="submit" className="h-11" disabled={enabling}>
          Etkinleştir
        </Button>
      </form>
    </div>
  );
}

/** Kurtarma kodları yalnız üretildiklerinde gösterilir; indirme ve "kaydettim" onayı */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone?: () => void }) {
  const [saved, setSaved] = useState(false);
  const download = () => {
    const text = `Seferna yönetici kurtarma kodları (${new Date().toLocaleDateString("tr-TR")})\nHer kod bir kez kullanılır. Girişte doğrulama uygulaması kodu yerine yazılır.\n\n${codes.join("\n")}\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = "nakliye-kurtarma-kodlari.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <section aria-labelledby="recovery-title" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
      <h3 id="recovery-title" className="font-semibold">
        Kurtarma kodlarınız — yalnız şimdi gösteriliyor
      </h3>
      <p className="text-sm">Telefonunuzu kaybederseniz girişte uygulama kodu yerine bunlardan birini yazarsınız. Her kod bir kez kullanılır; güvenli bir yere kaydedin.</p>
      <ul data-testid="recovery-codes" className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:max-w-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button type="button" variant="outline" className="h-10" onClick={download}>
        Kodları indir (.txt)
      </Button>
      {onDone && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4" />
            Kodları güvenli bir yere kaydettim
          </label>
          <Button type="button" className="h-11" disabled={!saved} onClick={onDone}>
            Devam
          </Button>
        </div>
      )}
    </section>
  );
}

/** Yeni kurtarma kodları: mevcut uygulamadan kod (ya da kalan kurtarma kodlarından biri) ister */
export function RegenerateCodes() {
  const [state, regenerate, pending] = useActionState<RegenerateState, FormData>(regenerateAction, {});
  if (state.recoveryCodes) return <RecoveryCodes codes={state.recoveryCodes} />;
  return (
    <form onSubmit={submitWithoutReset(regenerate)} className="space-y-3">
      <Field label="Uygulamadaki kod (ya da bir kurtarma kodu)" htmlFor="regen-code" error={state.error}>
        <Input id="regen-code" name="code" autoComplete="one-time-code" spellCheck={false} maxLength={20} className="h-11 max-w-56" {...invalid("regen-code", state.error)} />
      </Field>
      <Button type="submit" variant="outline" className="h-11" disabled={pending}>
        Yeni kurtarma kodları üret
      </Button>
    </form>
  );
}
