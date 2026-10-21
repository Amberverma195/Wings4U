import React, { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useSession, withSilentRefresh } from '../context/session';
import { apiFetch, getApiErrorMessage } from '../lib/api';
import { getSessionGeneration } from '../lib/token-store';
import { canCancelOrder, canShowOrderAssistance, storeTelephoneUri } from '../lib/order-actions';
import { useCancellationEligibility } from '../hooks/use-cancellation-eligibility';
import type { UseChatResult } from '../hooks/use-chat';
import type { OrderDetail } from '../lib/types';
import { FeedbackButton, FeedbackError, OrderFeedbackSheet, feedbackStyles as s } from './order-feedback-sheet';
import { OrderChatModal } from './order-chat-modal';

/** Mounted with a key for order/location/login/focus; unmount invalidates every pending action. */
export function OrderActiveActions({ order, chat, onRefresh }: { order: OrderDetail; chat: UseChatResult; onRefresh: () => void }) {
  const session = useSession();
  const focused = useIsFocused();
  const eligible = useCancellationEligibility(order, focused);
  const [modal, setModal] = useState<'cancel' | 'chat' | 'help' | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  const latest = useRef(order);
  latest.current = order;
  const generation = getSessionGeneration();
  const canCancel = eligible && !blocked;
  const assistance = !blocked && canShowOrderAssistance(order);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!canCancel && modal === 'cancel') setModal(null); }, [canCancel, modal]);
  useEffect(() => { if (!assistance && modal !== 'cancel') setModal(null); }, [assistance, modal]);
  const cancel = async () => {
    const current = () => mounted.current && generation === getSessionGeneration();
    if (locked.current || blocked || !current() || !canCancelOrder(latest.current)) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      const response = await withSilentRefresh(() => {
        if (!current() || !canCancelOrder(latest.current)) throw new Error('Cancellation is no longer available. Please use Order Chat or Help.');
        return apiFetch(`/api/v1/orders/${order.id}/cancel`, { method: 'POST', locationId: order.location_id,
          expectedSessionGeneration: generation, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      }, session.refresh, session.clear);
      const body = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) {
        // Keep the website confirmation error; the authoritative refresh below
        // closes the modal when the kitchen status/deadline no longer permits it.
        throw new Error(getApiErrorMessage(body, `Cancel failed (${response.status})`));
      }
      setBlocked(true); setModal(null);
      // Render the refreshed server status; never fabricate CANCELLED locally.
      onRefresh();
    } catch (cause) {
      if (current()) { setError(cause instanceof Error ? cause.message : 'Cancel failed'); onRefresh(); }
    } finally {
      if (current()) { locked.current = false; setBusy(false); }
    }
  };
  const phoneUri = storeTelephoneUri(order.location_phone);
  const callStore = async () => {
    if (!phoneUri) return;
    try { await Linking.openURL(phoneUri); }
    catch { if (mounted.current) setError('Unable to open the phone dialer. Please call the store or chat with us.'); }
  };
  if (!canCancel && !assistance && !error) return null;
  return <View style={styles.container}>
    <View style={s.actions}>
      {canCancel ? <FeedbackButton label="Cancel order" busy={busy} busyLabel="Cancelling…" onPress={() => { if (!locked.current) { setError(null); setModal('cancel'); } }} /> : null}
      {assistance ? <><FeedbackButton label="Order Chat" secondary onPress={() => setModal('chat')} />
        <FeedbackButton label="Help" secondary onPress={() => { setError(null); setModal('help'); }} /></> : null}
    </View>
    <FeedbackError message={error} />
    {modal === 'cancel' && canCancel ? <OrderFeedbackSheet title="Cancel this order?" dismissDisabled={busy} onClose={() => setModal(null)}>
      <Text style={s.text}>Are you sure you want to cancel order #{order.order_number}? This cannot be undone once confirmed.</Text>
      <View style={s.actions}><FeedbackButton label="Keep order" secondary disabled={busy} onPress={() => setModal(null)} />
        <FeedbackButton label="Yes, cancel order" busy={busy} busyLabel="Cancelling…" onPress={() => { void cancel(); }} /></View>
      <FeedbackError message={error} />
    </OrderFeedbackSheet> : null}
    {modal === 'help' && assistance ? <OrderFeedbackSheet title="Need help with this order?" onClose={() => setModal(null)}>
      <Text style={s.text}>{order.status === 'READY'
        ? 'Your order is already prepared and can no longer be cancelled here. To request a cancellation, please contact us.'
        : 'Cancellation might not be possible — your order may already be in preparation. To request a cancellation, please contact us.'}</Text>
      {phoneUri ? <FeedbackButton label={`Contact us · ${order.location_phone}`} onPress={() => { void callStore(); }} />
        : <Text style={s.muted}>Store phone is not available. You can chat with us here instead.</Text>}
      <FeedbackButton label="Chat with us" onPress={() => setModal('chat')} />
      <FeedbackButton label="Close" secondary onPress={() => setModal(null)} />
      <FeedbackError message={error} />
    </OrderFeedbackSheet> : null}
    {modal === 'chat' && assistance ? <OrderChatModal order={order} chat={chat} onClose={() => setModal(null)} /> : null}
  </View>;
}

const styles = StyleSheet.create({ container: { marginTop: 16, gap: 8, padding: 12, borderRadius: 14, backgroundColor: '#FFF' } });
