import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useCart } from '../context/cart';
import { useOrderSetup } from '../context/order-setup';
import { useCheckoutPreparation } from '../hooks/use-checkout-preparation';

/** Protect direct checkout links too; a recent Cart validation avoids a duplicate preflight. */
export function CheckoutEntryGuard({ children }: { children: ReactNode }) {
  const setup = useOrderSetup(), cart = useCart(), checkout = useCheckoutPreparation();
  const focused = useIsFocused(), router = useRouter();
  const [entered, setEntered] = useState(checkout.approved);
  const attempted = useRef(false);
  const checking = useRef(false);
  const active = useRef(focused);
  active.current = focused;
  useEffect(() => () => { active.current = false; }, []);
  const leave = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace('/cart'); }, [router]);
  const retry = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const success = await checkout.prepare();
      if (success && active.current) setEntered(true);
      else if (active.current && !setup.getConfirmedSetup()) leave();
    } finally { checking.current = false; }
  }, [checkout.prepare, setup.getConfirmedSetup, leave]);
  useEffect(() => {
    if (!focused) { checkout.cancel(); return; }
    if (!setup.ready || !cart.isCartHydrated || attempted.current) return;
    attempted.current = true;
    if (checkout.approved) setEntered(true);
    else void retry();
    // Each entry attempts once. Expiry/errors thereafter require an explicit retry.
  }, [focused, setup.ready, cart.isCartHydrated, checkout.approved, checkout.cancel, retry]);
  if ((entered || checkout.approved) && setup.confirmed) return <>{children}</>;
  return <View style={styles.screen}>
    {checkout.busy || !setup.ready || !cart.isCartHydrated ? <ActivityIndicator color="#FF4D4D" /> : null}
    <Text style={styles.message} accessibilityLiveRegion="polite">{checkout.error ?? 'Confirm your order details and total before checkout.'}</Text>
    <Pressable onPress={() => void retry()} disabled={checkout.busy || !setup.ready || !cart.isCartHydrated}
      accessibilityRole="button" style={styles.button}><Text style={styles.buttonText}>{setup.confirmed ? 'Try again' : 'Confirm order details'}</Text></Pressable>
    {setup.confirmed && <Pressable onPress={() => setup.openOrderSetup()} accessibilityRole="button" style={styles.back}><Text>Change order details</Text></Pressable>}
    {checkout.error && <Pressable onPress={() => router.replace('/(tabs)/cart')} accessibilityRole="button" style={styles.back}><Text>Review cart items</Text></Pressable>}
    <Pressable onPress={leave} accessibilityRole="button" style={styles.back}><Text>Back to browsing</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16, backgroundColor: '#FAFAFA' },
  message: { fontSize: 14, lineHeight: 21, textAlign: 'center', color: '#6C5142' },
  button: { backgroundColor: '#FF4D4D', borderRadius: 12, padding: 14, minHeight: 48 },
  buttonText: { color: '#FFF', fontWeight: '700' },
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
});
