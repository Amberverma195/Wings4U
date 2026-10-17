import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Clock3 } from 'lucide-react-native';
import { useCart } from '../context/cart';
import { useOrderSetup } from '../context/order-setup';
import { orderTimingLabel } from '../lib/order-setup';

export function OrderSetupSummary({ light = false }: { light?: boolean }) {
  const cart = useCart();
  const setup = useOrderSetup();
  const color = light ? '#111111' : '#6C5142';
  const label = `${cart.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'} · ${orderTimingLabel(cart.scheduledFor, cart.locationTimezone)}`;
  return <Pressable onPress={() => setup.openOrderSetup()} style={[styles.row, light && styles.bannerRow]} accessibilityRole="button"
    accessibilityLabel={`${label}. Change order details`}>
    <Clock3 size={13} color={color} />
    <View style={styles.text}>
      <Text style={[styles.label, { color }]} numberOfLines={1}>{label}</Text>
      {!light && cart.fulfillmentType === 'DELIVERY' && setup.deliveryAddress?.line1 &&
        <Text style={styles.address} numberOfLines={1}>{setup.deliveryAddress.line1}, {setup.deliveryAddress.postal_code}</Text>}
    </View>
    <Text style={[styles.change, { color }]}>Change</Text><ChevronRight size={13} color={color} />
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  bannerRow: { backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  text: { flex: 1 },
  label: { fontSize: 11, fontWeight: '600' },
  address: { fontSize: 11, lineHeight: 17, color: '#8B786A', marginTop: 2 },
  change: { fontSize: 11, fontWeight: '700' },
});
