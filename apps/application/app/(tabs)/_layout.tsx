import { Tabs } from 'expo-router/js-tabs';
import { useIsFocused, useRouter } from 'expo-router';
import { House, UtensilsCrossed, User, ShoppingBag } from 'lucide-react-native';
import { useCallback, useEffect } from 'react';
import { AuthSheet } from '../../src/components/auth-sheet';
import { useCart } from '../../src/context/cart';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../../src/context/session';
import { useProfileTabAuth } from '../../src/hooks/use-profile-tab-auth';

export const unstable_settings = { initialRouteName: 'index' };

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const focused = useIsFocused();
  const session = useSession();
  const cart = useCart();
  const openProfile = useCallback(() => router.navigate('/profile'), [router]);
  const profileAuth = useProfileTabAuth(openProfile);
  useEffect(() => {
    if (!focused) profileAuth.cancelPending();
  }, [focused, profileAuth.cancelPending]);
  const bottom = Math.max(insets.bottom, 8);
  return (
    <>
    <Tabs initialRouteName="index" backBehavior="history"
      screenListeners={({ route }) => ({
        tabPress: () => { if (route.name !== 'profile') profileAuth.cancelPending(); },
        // Also cancel stale intents on programmatic navigation and incoming links.
        focus: profileAuth.cancelPending,
      })}
      screenOptions={{
      headerShown: false,
      headerStyle: { backgroundColor: '#FFFFFF' },
      headerTintColor: '#000000',
      headerTitleStyle: { fontWeight: 'bold' },
      headerShadowVisible: false,
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
      <Tabs.Screen name="profile" listeners={{ tabPress: profileAuth.onTabPress }}
        options={{ title: 'Profile', headerShown: true, tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
      <Tabs.Screen name="cart" options={{ title: 'Cart', headerShown: true, tabBarBadge: cart.itemCount > 0 ? (cart.itemCount > 9 ? '9+' : cart.itemCount) : undefined,
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
    <AuthSheet {...profileAuth.authSheetProps} />
    </>
  );
}
