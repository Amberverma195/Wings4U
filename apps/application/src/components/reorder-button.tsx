import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCart } from '../context/cart';
import { useSession, withSilentRefresh } from '../context/session';
import { apiFetch } from '../lib/api';
import { parseReorderPreview, REORDER_SKIP_COPY, reorderCartItems, reorderError, type MobileReorderPreview } from '../lib/reorder';
import { cents } from '../lib/format';

export function ReorderButton({ orderId, locationId, websiteOrderDetail = false }: { orderId: string; locationId: string; websiteOrderDetail?: boolean }) {
  const session = useSession(), cart = useCart(), router = useRouter(), focused = useIsFocused();
  const [preview, setPreview] = useState<MobileReorderPreview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0), locked = useRef(false);
  const latest = useRef({ session, cart, focused }); latest.current = { session, cart, focused };
  const approved = useRef<{ preview: MobileReorderPreview; context: string; expires: number } | null>(null);
  const context = JSON.stringify([session.authenticated ? session.user?.id : null, cart.locationId, cart.fulfillmentType, cart.scheduledFor, orderId, locationId]);
  const currentContext = useRef(context); currentContext.current = context;
  const dismiss = () => { generation.current++; locked.current = false; approved.current = null; setPreview(null); setBusy(false); };
  useEffect(() => {
    dismiss(); setError(null);
    return () => { generation.current++; locked.current = false; approved.current = null; };
  }, [context, focused]);

  const fetchPreview = async () => {
    if (locked.current || approved.current) return;
    if (!session.loaded || !session.authenticated || !session.user) { setError('Please sign in to reorder.'); return; }
    if (!cart.isCartHydrated || cart.isCartHydrating) { setError('Your cart is still loading. Please try again in a moment.'); return; }
    const attempt = ++generation.current, owner = session.user.id, startedContext = context;
    const isCurrent = () => attempt === generation.current && currentContext.current === startedContext &&
      latest.current.focused && latest.current.session.user?.id === owner && latest.current.session.authenticated;
    locked.current = true; setBusy(true); setError(null);
    try {
      const response = await withSilentRefresh(() => {
        // Silent refresh must not retry on behalf of a different account.
        if (!isCurrent()) throw new Error('Reorder cancelled.');
        return apiFetch(`/api/v1/orders/${orderId}/reorder`, { method: 'POST', locationId,
          headers: { 'Content-Type': 'application/json' }, ...(websiteOrderDetail ? {} : { body: JSON.stringify({ fulfillment_type: cart.fulfillmentType, scheduled_for: cart.scheduledFor ?? undefined }) }) });
      }, session.refresh, session.clear);
      const body = await response.json().catch(() => null);
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(reorderError(body, response.status));
      const next = parseReorderPreview(body?.data, orderId, locationId);
      approved.current = { preview: next, context: startedContext, expires: Date.now() + 120_000 };
      setPreview(next);
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error && !(cause instanceof TypeError) && cause.message !== 'Network request failed' ? cause.message : 'Unable to connect. Please try Reorder again.');
    } finally {
      if (attempt === generation.current) { locked.current = false; setBusy(false); }
    }
  };
  const confirm = () => {
    const review = approved.current, state = latest.current;
    if (!review || locked.current) return;
    if (!state.session.authenticated || !state.session.user || !state.focused || review.context !== currentContext.current || (!websiteOrderDetail && Date.now() > review.expires)) {
      dismiss(); setError('Your order details changed or this preview expired. Please tap Reorder again.'); return;
    }
    if (!state.cart.isCartHydrated || state.cart.isCartHydrating) { dismiss(); setError('Your cart is still loading. Please try again in a moment.'); return; }
    if (review.preview.location_id !== state.cart.locationId) {
      dismiss(); setError('This order was placed at a different location. Reorder is only available on the matching location.'); return;
    }
    if (review.preview.all_unavailable) { dismiss(); return; }
    const items = reorderCartItems(review.preview);
    locked.current = true; approved.current = null; setPreview(null);
    for (const item of items) state.cart.addItem(item);
    if (items.length) router.navigate('/(tabs)/cart');
    locked.current = false;
  };
  if (!session.loaded || !session.authenticated) return null;
  return <View style={styles.wrapper}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={websiteOrderDetail ? 'Order again' : 'Reorder'} accessibilityState={{ disabled: busy, busy }}
      disabled={busy} onPress={fetchPreview} style={[styles.button, busy && styles.disabled]}>
      {busy ? <ActivityIndicator color="#FF4D4D" /> : <Text style={styles.buttonText}>{websiteOrderDetail ? 'Order again' : 'Reorder'}</Text>}
    </TouchableOpacity>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Modal visible={Boolean(preview)} transparent animationType="slide" onRequestClose={dismiss}>
      {preview ? <SafeAreaView style={styles.overlay}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss reorder review" onPress={dismiss} style={styles.backdrop} />
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text accessibilityRole="header" style={styles.title}>Review your reorder</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <Text style={styles.copy}>{preview.all_unavailable ? "We're sorry, none of the items from this order are currently available." :
              `${preview.items.length} item${preview.items.length === 1 ? '' : 's'} will be added to your cart at current prices.`}</Text>
            <DiffGroup title="Skipped" lines={preview.diff.skipped.map(row => `${row.name} — ${REORDER_SKIP_COPY[row.reason]}${row.detail ? `. ${row.detail}` : ''}`)} />
            <DiffGroup title="Modifiers dropped" lines={preview.diff.modifier_changes.map(row => `${row.name}: ${row.dropped.join(', ')}`)} />
            <DiffGroup title="Price changes" lines={preview.diff.price_changes.map(row => `${row.name}: ${cents(row.old_cents)} → ${cents(row.new_cents)}`)} />
            <DiffGroup title="Configuration changes" lines={(preview.diff.configuration_changes ?? []).map(row => `${row.name}: ${row.changes.join(', ')}`)} />
            {!preview.all_unavailable && !websiteOrderDetail ? <Text style={styles.copy}>Availability can change. Your entire cart, order time and current prices will be checked again before checkout. No previous discounts, rewards or payment details are copied.</Text> : null}
          </ScrollView>
          <View style={styles.actions}>
            <TouchableOpacity accessibilityRole="button" onPress={dismiss} style={styles.button}><Text style={styles.buttonText}>{preview.all_unavailable ? 'Close' : 'Cancel'}</Text></TouchableOpacity>
            {!preview.all_unavailable ? <TouchableOpacity accessibilityRole="button" onPress={confirm} style={[styles.button, styles.primary]}><Text style={styles.primaryText}>Add to cart</Text></TouchableOpacity> : null}
          </View>
        </View>
      </SafeAreaView> : null}
    </Modal>
  </View>;
}
function DiffGroup({ title, lines }: { title: string; lines: string[] }) {
  if (!lines.length) return null;
  return <View style={styles.group}><Text style={styles.groupTitle}>{title}</Text>{lines.map((line, index) => <Text key={index} style={styles.copy}>{line}</Text>)}</View>;
}
const styles = StyleSheet.create({
  wrapper: { marginBottom: 12 }, button: { minHeight: 44, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#FFF0ED', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#E53C3C', fontWeight: '800', fontSize: 14 }, disabled: { opacity: 0.55 },
  primary: { backgroundColor: '#FF4D4D' }, primaryText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  error: { color: '#B91C1C', fontSize: 13, marginTop: 8 }, overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { backgroundColor: '#FFFEFC', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  title: { color: '#30241F', fontWeight: '800', fontSize: 21, marginBottom: 16 }, scroll: { flexShrink: 1 }, content: { gap: 12 },
  copy: { color: '#6F5A4F', fontSize: 14, lineHeight: 21 }, group: { gap: 5 }, groupTitle: { color: '#30241F', fontWeight: '800', fontSize: 15 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 18 },
});
