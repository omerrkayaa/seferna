"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, { step: "phone" });

  if (state.step === "phone") {
    return (
      <form action={action} className="space-y-4">
        <input type="hidden" name="intent" value="request" />
        <div className="space-y-2">
          <Label htmlFor="phone">Cep telefonu</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="05XX XXX XX XX"
            defaultValue={state.phone ? `0${state.phone.slice(3)}` : ""}
            required
            className="h-12 text-base"
            aria-invalid={!!state.error}
            aria-describedby={state.error ? "login-error" : undefined}
          />
        </div>
        <ErrorText message={state.error} />
        <Button type="submit" disabled={pending} className="h-12 w-full text-base">
          {pending ? "Gönderiliyor…" : "SMS kodu gönder"}
        </Button>
      </form>
    );
  }

  if (state.step === "totp") {
    return (
      <div className="space-y-4">
        <form action={action} className="space-y-4">
          <input type="hidden" name="intent" value="totp" />
          <input type="hidden" name="phone" value={state.phone} />
          <input type="hidden" name="challenge" value={state.challenge} />
          <input type="hidden" name="sonra" value={next} />
          <div className="space-y-2">
            <Label htmlFor="totp">Doğrulama uygulamasındaki kod</Label>
            {/* Kurtarma kodu harf de içerir: sayısal klavye zorlanmaz */}
            <Input
              id="totp"
              name="code"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={20}
              placeholder="6 haneli kod"
              required
              autoFocus
              className="h-12 text-center text-lg tracking-[0.3em]"
              aria-invalid={!!state.error}
              aria-describedby={state.error ? "login-error totp-hint" : "totp-hint"}
            />
            <p id="totp-hint" className="text-sm text-muted-foreground">
              Yönetici hesabı: Google Authenticator ya da Microsoft Authenticator’daki “Seferna” kodunu girin. Telefonunuz yanınızda değilse kurtarma kodlarınızdan birini yazabilirsiniz.
            </p>
          </div>
          <ErrorText message={state.error} />
          <Button type="submit" disabled={pending} className="h-12 w-full text-base">
            {pending ? "Doğrulanıyor…" : "Doğrula"}
          </Button>
        </form>
        <form action={action}>
          <input type="hidden" name="intent" value="change" />
          <Button type="submit" variant="link" className="px-0 text-sm">
            Baştan başla
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <input type="hidden" name="intent" value="verify" />
        <input type="hidden" name="phone" value={state.phone} />
        <input type="hidden" name="sonra" value={next} />
        <div className="space-y-2">
          <Label htmlFor="code">{`0${state.phone?.slice(3)} numarasına gelen kod`}</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="6 haneli kod"
            required
            autoFocus
            className="h-12 text-center text-lg tracking-[0.4em]"
            aria-invalid={!!state.error}
            aria-describedby={state.error ? "login-error" : undefined}
          />
        </div>
        <ErrorText message={state.error} />
        <Button type="submit" disabled={pending} className="h-12 w-full text-base">
          {pending ? "Doğrulanıyor…" : "Giriş yap"}
        </Button>
      </form>
      <div className="flex justify-between text-sm">
        <form action={action}>
          <input type="hidden" name="intent" value="change" />
          <Button type="submit" variant="link" className="px-0">
            Numarayı değiştir
          </Button>
        </form>
        <form action={action}>
          <input type="hidden" name="intent" value="request" />
          <input type="hidden" name="resend" value="1" />
          <input type="hidden" name="phone" value={state.phone} />
          <Button type="submit" variant="link" className="px-0" disabled={pending}>
            Kodu tekrar gönder
          </Button>
        </form>
      </div>
    </div>
  );
}

function ErrorText({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p id="login-error" role="alert" className="text-sm font-medium text-destructive">
      {message}
    </p>
  );
}
