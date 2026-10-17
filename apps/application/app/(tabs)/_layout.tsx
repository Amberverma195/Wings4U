import { Tabs } from 'expo-router/js-tabs';
import { useRouter } from 'expo-router';
import { House, UtensilsCrossed, User, ShoppingBag } from 'lucide-react-native';
import { useState } from 'react';
import { AuthSheet } from '../../src/components/auth-sheet';
import { useCart } from '../../src/context/cart';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../../src/context/session';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const session = useSession();
  const cart = useCart();
  const [authVisible, setAuthVisible] = useState(false);
  const bottom = Math.max(insets.bottom, 8);
  return (
    <>
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
      <Tabs.Screen name="profile-tab" listeners={{ tabPress: (event) => {
        event.preventDefault();
        if (session.authenticated) router.push('/profile');
        else setAuthVisible(true);
      } }} options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
      <Tabs.Screen name="cart-tab" listeners={{ tabPress: (event) => {
        event.preventDefault();
        router.push('/cart');
      } }} options={{ title: 'Cart', tabBarBadge: cart.itemCount > 0 ? (cart.itemCount > 9 ? '9+' : cart.itemCount) : undefined,
        tabBarBadgeStyle: { backgroundColor: '#FF4D4D', color: '#FFF' },
        tabBarIcon: ({ color, size }) => <ShoppingBag color={color} size={size} /> }} />
      <Tabs.Screen
        name="deals"
        listeners={{
          tabPress: (event) => {
            if (!session.loaded || !session.authenticated) return;
            event.preventDefault();
            router.push(`/profile?section=overview&entry=${Date.now()}`);
          },
        }}
        options={{ href: null }}
      />
      <Tabs.Screen
        name="orders"
        listeners={{
          tabPress: (event) => {
            if (!session.loaded || !session.authenticated) return;
            event.preventDefault();
            router.push(`/profile?section=orders&entry=${Date.now()}`);
          },
        }}
        options={{ href: null }}
      />
    </Tabs>
    <AuthSheet visible={authVisible} onClose={() => setAuthVisible(false)} />
    </>
  );
}
