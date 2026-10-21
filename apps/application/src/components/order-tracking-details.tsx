import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useDeliveryPin } from '../hooks/use-delivery-pin';
import type { UseChatResult } from '../hooks/use-chat';
import type { OrderDetail } from '../lib/types';
import { shortTime, statusLabel } from '../lib/format';
import { deliveryAddress, deliveryPreference, driverPhoneLabel, isTerminalOrder, showDeliveryDetails } from '../lib/order-tracking';
import { storeTelephoneUri } from '../lib/order-actions';
import { FeedbackButton, FeedbackError } from './order-feedback-sheet';
import { OrderChatModal } from './order-chat-modal';

export function OrderTrackingDetails({ order, chat, actionsAvailable = true }: { order: OrderDetail; chat: UseChatResult; actionsAvailable?: boolean }) {
  const pin = useDeliveryPin(order);
  const terminal = isTerminalOrder(order);
  const driver = order.assigned_driver;
  const [driverChat, setDriverChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDriverChat(false); setError(null); }, [order.id, driver?.user_id, terminal, actionsAvailable]);
  const address = deliveryAddress(order.address_snapshot_json);
  const preference = deliveryPreference(order.contactless_pref);
  const vehicle = [driver?.vehicle_type, driver?.vehicle_identifier].filter(part => typeof part === 'string' && part.trim()).join(' · ');
  const callDriver = async () => {
    const uri = storeTelephoneUri(driver?.phone);
    if (!uri) return;
    try { await Linking.openURL(uri); } catch { setError('Unable to open the phone dialer.'); }
  };
  return <View style={s.container}>
    <View style={s.meta}><Text style={s.chip}>{statusLabel(order.fulfillment_type)}</Text><Text style={s.chip}>{new Date(order.placed_at).toLocaleString()}</Text></View>
    {order.estimated_ready_at && !terminal ? <Text style={s.estimate}>Estimated ready ~{shortTime(order.estimated_ready_at)}
      {order.estimated_window_min_minutes != null && order.estimated_window_max_minutes != null ? ` (${order.estimated_window_min_minutes}–${order.estimated_window_max_minutes} min)` : ''}</Text> : null}
    {pin ? <View style={s.card}><Text style={s.label}>Delivery PIN</Text><Text selectable style={s.pin}>{pin}</Text><Text style={s.text}>Share this PIN with your driver at handoff.</Text></View> : null}
    {showDeliveryDetails(order) ? <View style={s.card}>
      <Text style={s.eyebrow}>Delivery</Text><Text style={s.title}>{order.status === 'OUT_FOR_DELIVERY' ? 'Driver is on the way' : 'Delivery details'}</Text>
      {order.estimated_arrival_at && !terminal ? <Text style={s.estimate}>ETA {shortTime(order.estimated_arrival_at)}</Text> : null}
      {driver ? <><Text style={s.label}>{driver.full_name}</Text><Text style={s.text}>{driverPhoneLabel(driver.phone) ?? 'Phone not available'}</Text>
        <Text style={s.label}>Plate / vehicle</Text><Text style={s.text}>{vehicle || 'Not added'}</Text></>
        : <Text style={s.text}>We will show your driver here once the store assigns one.</Text>}
      {driver && !terminal && actionsAvailable ? <View style={s.meta}><FeedbackButton label="Chat with driver" onPress={() => setDriverChat(true)} />
        {driver.phone ? <FeedbackButton label="Call driver" secondary onPress={() => { void callDriver(); }} /> : null}</View> : null}
      {address ? <><Text style={s.label}>Delivery address</Text><Text style={s.text}>{address}</Text></> : null}
      {preference ? <><Text style={s.label}>Delivery preference</Text><Text style={s.text}>{preference}</Text></> : null}
      <FeedbackError message={error} />
    </View> : null}
    {order.status === 'CANCELLED' ? <Text style={s.text}>Order cancelled by Staff.</Text> : null}
    {driverChat && driver && !terminal && actionsAvailable ? <OrderChatModal title="Driver chat" order={order} chat={chat} onClose={() => setDriverChat(false)} /> : null}
  </View>;
}

const s = StyleSheet.create({
  container: { gap: 12, marginTop: 12 }, meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { color: '#444', backgroundColor: '#EFEFEF', borderRadius: 12, padding: 10, fontSize: 13 },
  estimate: { color: '#A72424', backgroundColor: '#FFF0ED', borderRadius: 12, padding: 12, fontWeight: '700' },
  card: { backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: '#EEE', padding: 16, gap: 10 },
  label: { color: '#252525', fontWeight: '800', fontSize: 14 }, text: { color: '#555', fontSize: 14, lineHeight: 21 },
  pin: { color: '#252525', fontWeight: '900', fontSize: 32, letterSpacing: 5 },
  eyebrow: { color: '#666', textTransform: 'uppercase', fontSize: 12 }, title: { color: '#252525', fontWeight: '900', fontSize: 20 },
});
