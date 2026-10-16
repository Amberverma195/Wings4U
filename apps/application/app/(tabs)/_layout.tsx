import { Tabs } from 'expo-router/js-tabs';
import { useRouter } from 'expo-router';
import { House, UtensilsCrossed, Tag, ReceiptText } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../../src/context/session';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const session = useSession();
  const bottom = Math.max(insets.bottom, 8);
  return (
    <Tabs initialRouteName="index" backBehavior="history" screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: '#FF4D4D',
      tabBarInactiveTintColor: '#777777',
      tabBarLabelPosition: 'below-icon',
      tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      tabBarItemStyle: { flex: 1, minHeight: 48, paddingVertical: 4 },
      tabBarStyle: {
        height: 64 + bottom,
        paddingTop: 6,
        paddingBottom: bottom,
        backgroundColor: '#FFFFFF',
        borderTopWidth: 1,
        borderTopColor: '#EEEEEE',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
      },
      animation: 'none',
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
      <Tabs.Screen name="menu" options={{ title: 'Menu', tabBarIcon: ({ color, size }) => <UtensilsCrossed color={color} size={size} /> }} />
      <Tabs.Screen name="deals" options={{ title: 'Deals', tabBarIcon: ({ color, size }) => <Tag color={color} size={size} /> }} />
      <Tabs.Screen
        name="orders"
        listeners={{
          tabPress: (event) => {
            if (!session.loaded || !session.authenticated) return;
            event.preventDefault();
            router.push('/profile?section=orders');
          },
        }}
        options={{ title: 'Orders', tabBarIcon: ({ color, size }) => <ReceiptText color={color} size={size} /> }}
      />
    </Tabs>
  );
}
