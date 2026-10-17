import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ShoppingBag, User } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../context/session';
import { useCart } from '../context/cart';
import { AuthSheet } from './auth-sheet';

/** One source for guest sign-in, account navigation, and the live cart badge. */
export function HeaderActions() {
  const session = useSession();
  const cart = useCart();
  const router = useRouter();
  const [authVisible, setAuthVisible] = useState(false);
  return (
    <View style={styles.actions}>
      <TouchableOpacity style={styles.button} accessibilityRole="button"
        accessibilityLabel={session.authenticated ? 'Open profile' : 'Sign in'}
        onPress={() => session.authenticated ? router.push('/profile') : setAuthVisible(true)}>
        <User size={20} color="#1A1A1A" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} accessibilityRole="button"
        accessibilityLabel={`Open cart, ${cart.itemCount} items`} onPress={() => router.push('/cart')}>
        <ShoppingBag size={22} color="#1A1A1A" />
        {cart.itemCount > 0 && <View style={styles.badge}>
          <Text style={styles.badgeText}>{cart.itemCount > 9 ? '9+' : cart.itemCount}</Text>
        </View>}
      </TouchableOpacity>
      <AuthSheet visible={authVisible} onClose={() => setAuthVisible(false)} />
    </View>
  );
}

export function TabHeader({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  return <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
    {focused && <StatusBar style="dark" />}
    <Text style={styles.title} accessibilityRole="header">{title}</Text>
  </View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20,
    paddingBottom: 14, backgroundColor: '#FAFAFA' },
  title: { flex: 1, fontSize: 26, fontWeight: '800', color: '#1A1A1A' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  button: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#EEEEEE' },
  badge: { position: 'absolute', top: -3, right: -2, minWidth: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: '#FFF', backgroundColor: '#FF4D4D', paddingHorizontal: 3,
    justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: '#FFF', fontSize: 9, fontWeight: '900', lineHeight: 11 },
});
