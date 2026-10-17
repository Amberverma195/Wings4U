import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { useCart } from '../context/cart';

export function CartAddedToast() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const firstNonce = useRef(cart.cartAddNonce);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (cart.cartAddNonce === firstNonce.current) return;
    firstNonce.current = cart.cartAddNonce;
    setVisible(true);
    const timeout = setTimeout(() => setVisible(false), 2800);
    return () => clearTimeout(timeout);
  }, [cart.cartAddNonce]);

  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={[styles.overlay, { bottom: Math.max(insets.bottom, 8) + 72 }]}>
      <View style={styles.toast} accessibilityRole="alert">
        <View style={styles.confirmation}>
          <View style={styles.icon}><Check size={14} color="#FFFFFF" /></View>
          <Text style={styles.message}>Item added to cart</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View cart"
          onPress={() => { setVisible(false); router.navigate('/cart'); }}
          style={({ pressed }) => [styles.viewCart, pressed && styles.pressed]}
        >
          <Text style={styles.viewCartText}>View cart</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 20,
  },
  toast: {
    width: '100%',
    maxWidth: 420,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#30241F',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  confirmation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  icon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E53C3C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  viewCart: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginLeft: 10,
  },
  viewCartText: {
    color: '#FFB7AD',
    fontSize: 14,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
});
