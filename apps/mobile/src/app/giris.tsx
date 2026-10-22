import { phoneSchema } from "@nakliye/shared";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ErrorText, Field, Muted, s } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { inform } from "@/lib/confirm";
import { WEB_URL } from "@/lib/share";
import { C, TOUCH } from "@/lib/theme";
import type { MfaChallenge, Tokens } from "@/lib/types";

// Demo hesabı: apps/api/.env'deki DEMO_PHONE / DEMO_OTP ile aynı olmalı (yalnız geliştirme derlemesinde görünür).
const DEMO = { phone: "0555 010 20 30", code: "123456" };

/** A2 — Telefonla giriş: numara → SMS kodu (→ yönetici hesabında doğrulama uygulamasındaki kod, NFR-04) */
export default function Giris() {
  const { signIn, notice } = useAuth();
  const [step, setStep] = useState<"phone" | "code" | "totp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode(p = phone) {
    const parsed = phoneSchema.safeParse(p);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Geçerli bir numara girin");
    setBusy(true);
    setError(null);
    try {
      await api("/auth/otp/request", { method: "POST", body: { phone: parsed.data }, auth: false });
      setStep("code");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Bir sorun oluştu");
    } finally {
      setBusy(false);
    }
  }

  async function verify(p = phone, c = code) {
    if (!/^\d{6}$/.test(c)) return setError("SMS ile gelen 6 haneli kodu girin");
    setBusy(true);
    setError(null);
    try {
      const t = await api<Tokens | MfaChallenge>("/auth/otp/verify", { method: "POST", body: { phone: p, code: c }, auth: false });
      if ("mfaRequired" in t) {
        setChallenge(t.challenge);
        setStep("totp");
        setBusy(false);
        return;
      }
      await finish(t);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Bir sorun oluştu");
      setBusy(false);
    }
  }

  async function finish(t: Tokens) {
    await signIn(t);
    if (t.reopened) {
      inform(
        "Hesabınız yeniden açıldı",
        t.reopened === "dondurma"
          ? "Dondururken kapanan ilanlarınızı “Benzerini yayınla” ile yeniden açabilirsiniz."
          : "Puanlarınız ve geçmişiniz duruyor. Adınızı, firma ve araç bilgilerinizi yeniden girin.",
      );
    }
  }

  /** Yönetici hesabı: uygulamadaki 6 hane ya da kurtarma kodu */
  async function verifyTotp() {
    if (totp.trim().length < 6) return setError("Uygulamadaki 6 haneli kodu ya da bir kurtarma kodunu girin");
    setBusy(true);
    setError(null);
    try {
      await finish(await api<Tokens>("/auth/totp", { method: "POST", body: { challenge, code: totp.trim() }, auth: false }));
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Bir sorun oluştu";
      // 5 dk geçtiyse baştan: yeni SMS kodu gerekir
      if (message.startsWith("Doğrulama süresi doldu")) restart();
      setError(message);
      setBusy(false);
    }
  }

  function restart() {
    setStep("phone");
    setCode("");
    setTotp("");
    setChallenge("");
  }

  async function demo() {
    setPhone(DEMO.phone);
    setCode(DEMO.code);
    setBusy(true);
    setError(null);
    // Kod her zaman aynı; 60 sn içinde ikinci istek 429 alır ama önceki kod hâlâ geçerli
    await api("/auth/otp/request", { method: "POST", body: { phone: phoneSchema.parse(DEMO.phone) }, auth: false }).catch(() => {});
    await verify(phoneSchema.parse(DEMO.phone), DEMO.code);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.primary }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20, gap: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="header" style={{ fontSize: 30, fontWeight: "800", color: C.primaryText }}>
              Seferna
            </Text>
            <Text style={{ fontSize: 18, color: "#D5DEEA" }}>Gördüğün her yük gerçek ve şu an geçerli.</Text>
          </View>

          <View style={[s.card, { gap: 16 }]}>
            {/* Oturum neden kapandı: hesap silindi ya da askıya alındı */}
            {notice && (
              <Text accessibilityLiveRegion="polite" style={{ backgroundColor: C.warnBg, color: C.warn, padding: 12, borderRadius: 8, fontSize: 15 }}>
                {notice}
              </Text>
            )}
            {step === "phone" ? (
              <>
                <Field
                  label="Cep telefonu"
                  placeholder="05XX XXX XX XX"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  value={phone}
                  onChangeText={setPhone}
                  onSubmitEditing={() => requestCode()}
                />
                {error && <ErrorText>{error}</ErrorText>}
                <Button title="SMS kodu gönder" onPress={() => requestCode()} busy={busy} />
              </>
            ) : step === "totp" ? (
              <>
                <Muted>Yönetici hesabı: Google Authenticator ya da Microsoft Authenticator’daki “Seferna” kodunu girin. Telefon yanınızda değilse kurtarma kodlarınızdan birini yazabilirsiniz.</Muted>
                <Field
                  label="Doğrulama uygulamasındaki kod"
                  placeholder="6 haneli kod"
                  autoFocus
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={20}
                  value={totp}
                  onChangeText={setTotp}
                  onSubmitEditing={verifyTotp}
                  style={{ letterSpacing: 4, fontSize: 20 }}
                />
                {error && <ErrorText>{error}</ErrorText>}
                <Button title="Doğrula" onPress={verifyTotp} busy={busy} />
                <Button
                  title="Baştan başla"
                  variant="outline"
                  onPress={() => {
                    restart();
                    setError(null);
                  }}
                />
              </>
            ) : (
              <>
                <Muted>{phone} numarasına gelen 6 haneli kodu girin.</Muted>
                <Field
                  label="SMS kodu"
                  placeholder="______"
                  autoFocus
                  keyboardType="number-pad"
                  autoComplete="sms-otp"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  value={code}
                  onChangeText={setCode}
                  onSubmitEditing={() => verify(phone, code)}
                  style={{ letterSpacing: 6, fontSize: 22 }}
                />
                {error && <ErrorText>{error}</ErrorText>}
                <Button title="Giriş yap" onPress={() => verify(phoneSchema.parse(phone), code)} busy={busy} />
                <Button
                  title="Numarayı değiştir"
                  variant="outline"
                  onPress={() => {
                    setStep("phone");
                    setCode("");
                    setError(null);
                  }}
                />
              </>
            )}
          </View>

          <View style={{ gap: 4 }}>
            <Text style={{ color: "#D5DEEA", textAlign: "center" }}>Uygulamayı kullanarak kullanım şartlarını kabul etmiş ve KVKK aydınlatma metnini okumuş olursunuz.</Text>
            <View style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap" }}>
              <LegalLink title="Kullanım şartları" path="/kullanim-sartlari" />
              <LegalLink title="KVKK aydınlatma metni" path="/kvkk" />
            </View>
          </View>

          {__DEV__ && (
            <View style={{ gap: 8 }}>
              <Button title="Demo hesabıyla gir" variant="accent" icon="flash" onPress={demo} busy={busy} />
              <Text style={{ color: "#D5DEEA", textAlign: "center" }}>
                Demo: {DEMO.phone} · kod {DEMO.code} (yalnız geliştirme)
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Yasal metinler webde (W4); uygulama içi tarayıcıda açılır */
function LegalLink({ title, path }: { title: string; path: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => void WebBrowser.openBrowserAsync(WEB_URL + path)}
      style={{ minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 12 }}
    >
      <Text style={{ color: C.primaryText, textDecorationLine: "underline", fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}
