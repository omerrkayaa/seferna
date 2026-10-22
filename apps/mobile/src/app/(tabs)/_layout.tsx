import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { NotificationBell } from "@/components/notification-bell";
import { useAuth } from "@/lib/auth";
import { C } from "@/lib/theme";

// Alt sekmeler: Yükler · Dönüş Planı · İlan Ver · İşlerim · Profil.
// Role göre: nakliyeci Yükler + Dönüş Planı, yük sahibi İlanlarım (ilan verme oradan); ikisi birden olan hepsini görür.
// "İlan Ver" ayrı sekme yerine İlanlarım'ın üstünde: iki rollü kullanıcıda 6 sekme olmasın diye.
export default function TabsLayout() {
  const { me } = useAuth();
  const carrier = me?.roles.includes("carrier") ?? false;
  const shipper = me?.roles.includes("shipper") ?? false;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.primary },
        headerTintColor: C.primaryText,
        headerRight: () => <NotificationBell />,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.muted,
        sceneStyle: { backgroundColor: C.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ href: carrier ? undefined : null, title: "Yükler", tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="donus"
        options={{ href: carrier ? undefined : null, title: "Dönüş Planı", tabBarIcon: ({ color, size }) => <Ionicons name="repeat-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="ilanlar"
        options={{ href: shipper ? undefined : null, title: "İlanlarım", tabBarIcon: ({ color, size }) => <Ionicons name="megaphone-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="isler"
        options={{ title: "İşlerim", tabBarIcon: ({ color, size }) => <Ionicons name="briefcase-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profil"
        options={{ title: "Profil", tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
