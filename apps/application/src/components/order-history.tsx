import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ACTIVE_STATUSES, TERMINAL_STATUSES, type OrderSummary } from '../lib/types';
import { SectionSwitch } from './section-switch';
import { ReorderButton } from './reorder-button';
import { useSession } from '../context/session';

export function OrderReorderAction({ order, websiteOrderDetail = false }: { order: Pick<OrderSummary, 'id' | 'location_id' | 'status'>; websiteOrderDetail?: boolean }) {
  const session = useSession();
  return session.loaded && session.authenticated && TERMINAL_STATUSES.has(order.status)
    ? <ReorderButton orderId={order.id} locationId={order.location_id} websiteOrderDetail={websiteOrderDetail} /> : null;
}

export function OrderRow({ order }: { order: OrderSummary }) {
  const router = useRouter();
  const status = order.status.toLowerCase().replace(/_/g, ' ');
  const date = new Date(order.placed_at).toLocaleDateString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return <View><TouchableOpacity style={styles.row} accessibilityRole="button"
    accessibilityLabel={`Order #${order.order_number}, ${status}`}
    onPress={() => router.push(`/orders/${order.id}`)}>
    <View style={styles.main}>
      <Text style={styles.title}>Order #{order.order_number}</Text>
      <Text style={styles.meta}>{status} · {order.fulfillment_type.toLowerCase()} · {date}</Text>
    </View>
    <Text style={styles.amount}>${(order.final_payable_cents / 100).toFixed(2)}</Text>
  </TouchableOpacity><OrderReorderAction order={order} /></View>;
}

export function OrderHistory({ orders }: { orders: OrderSummary[] }) {
  const [filter, setFilter] = useState<'active' | 'past'>('active');
  const visible = useMemo(() => orders.filter(order =>
    ACTIVE_STATUSES.has(order.status) === (filter === 'active')), [orders, filter]);
  return <View>
    <SectionSwitch label="Order history" options={[{ key: 'active', label: 'Active' }, { key: 'past', label: 'Past' }]}
      value={filter} onChange={setFilter} />
    {visible.length === 0 ? <Text style={styles.empty}>
      {filter === 'active' ? 'No active orders' : 'No past orders'}
    </Text> : visible.map(order => <OrderRow key={order.id} order={order} />)}
  </View>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F1F1F1' },
  main: { flex: 1 },
  title: { color: '#1A1A1A', fontSize: 14, fontWeight: '800' },
  meta: { color: '#777777', fontSize: 12, fontWeight: '600', marginTop: 4, textTransform: 'capitalize' },
  amount: { color: '#1A1A1A', fontSize: 14, fontWeight: '800' },
  empty: { textAlign: 'center', color: '#777777', paddingVertical: 32, fontSize: 14 },
});
