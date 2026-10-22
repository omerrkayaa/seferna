import Ionicons from "@expo/vector-icons/Ionicons";
import { BODY_TYPES, CARGO_TYPES, VEHICLE_TYPES } from "@nakliye/shared";
import { useState } from "react";
import { Alert, Linking, Platform, Pressable, Text, View } from "react-native";
import { Badge, Button, Card, Muted } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { ago, dayRange, place, reputationText, tl } from "@/lib/format";
import { C } from "@/lib/theme";
import type { Load } from "@/lib/types";

/** Güven sinyali: her kartta teyit durumu + son teyit */
export function ConfirmBadge({ load }: { load: Pick<Load, "status" | "lastConfirmedAt"> }) {
  if (load.status === "teyit_bekliyor") return <Badge tone="warn" icon="time-outline" label="Teyit bekliyor" />;
  return <Badge tone="ok" icon="checkmark-circle" label={`Teyitli · ${ago(load.lastConfirmedAt)}`} />;
}

export function Route({ load }: { load: Pick<Load, "origin" | "dest"> }) {
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="ellipse" size={12} color={C.accent} />
        <Text style={{ fontSize: 17, fontWeight: "700", color: C.text, flexShrink: 1 }}>{place(load.origin)}</Text>
      </View>
      <View style={{ width: 2, height: 10, backgroundColor: C.border, marginLeft: 5 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="ellipse-outline" size={12} color={C.primary} />
        <Text style={{ fontSize: 17, fontWeight: "700", color: C.text, flexShrink: 1 }}>{place(load.dest)}</Text>
      </View>
    </View>
  );
}

export const loadSpec = (l: Pick<Load, "vehicleType" | "bodyType" | "weightTon" | "cargoType">) =>
  [VEHICLE_TYPES[l.vehicleType], l.bodyType && BODY_TYPES[l.bodyType], `${l.weightTon} ton`, CARGO_TYPES[l.cargoType]].filter(Boolean).join(" · ");

export const priceText = (l: Pick<Load, "priceType" | "price">) => (l.priceType === "sabit" && l.price ? tl(l.price) : "Teklif usulü");

/** "Ara": numarayı API'den açar (BR-40 kaydı) ve telefonu çevirir */
export function useCall() {
  const [busyId, setBusyId] = useState<string | null>(null);
  async function call(loadId: string) {
    setBusyId(loadId);
    try {
      const { phone } = await api<{ phone: string }>(`/loads/${loadId}/call`, { method: "POST" });
      if (Platform.OS === "web") window.alert(`Yük sahibinin numarası: ${phone}`);
      else await Linking.openURL(`tel:${phone}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Arama başlatılamadı";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Aranamadı", msg);
    } finally {
      setBusyId(null);
    }
  }
  return { call, busyId };
}

export function LoadCard({ load, onPress, onCall, calling }: { load: Load; onPress: () => void; onCall?: () => void; calling?: boolean }) {
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`${place(load.origin)} → ${place(load.dest)} yükü`} onPress={onPress} style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Route load={load} />
          </View>
          <Text style={{ fontSize: 15, fontWeight: "600", color: C.text }}>{dayRange(load.loadFrom, load.loadTo)}</Text>
        </View>
        <Muted>{loadSpec(load)}</Muted>
        {/* Yakınımdakiler: API yalnız konumla arandığında mesafe döner */}
        {load.distanceKm !== undefined && <Muted>Kalkış {Math.round(load.distanceKm)} km uzakta</Muted>}
        <Text style={{ fontSize: 18, fontWeight: "800", color: C.primary }}>{priceText(load)}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {load.shipper.verified && <Badge tone="ok" icon="shield-checkmark" label="Doğrulanmış" />}
          <Muted>{load.shipper.displayName ?? "Yük sahibi"}</Muted>
          {reputationText(load.shipper) && <Muted>· {reputationText(load.shipper)}</Muted>}
        </View>
        <ConfirmBadge load={load} />
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
        {onCall && <Button title="Ara" icon="call" variant="call" onPress={onCall} busy={calling} style={{ flex: 1 }} />}
        <Button title="Teklif ver" variant="outline" onPress={onPress} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}
