import React, { useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Check, CheckCircle2, Square } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import type { OrderDetail, SupportTicketType } from '../lib/types';
import { cents } from '../lib/format';
import { feedbackItemSummary, feedbackItemTitle, isExistingTicketConflict, ORDER_ISSUES, ticketPayload } from '../lib/order-feedback';
import { useOrderFeedbackRequest } from '../hooks/use-order-feedback-request';
import { FeedbackButton, FeedbackError, OrderFeedbackSheet, feedbackStyles as s } from './order-feedback-sheet';

export function OrderHelpModal({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const [step, setStep] = useState<'items' | 'details' | 'success'>(order.items.length > 1 ? 'items' : 'details');
  const [selectedIds, setSelectedIds] = useState<string[]>(order.items.length === 1 ? [order.items[0].id] : []);
  const [issue, setIssue] = useState<SupportTicketType>('WRONG_ITEM');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingTicket, setExistingTicket] = useState<string | null>(null);
  const locked = useRef(false);
  const submitted = useRef(false);
  const scope = useOrderFeedbackRequest(order);
  const router = useRouter();
  const items = order.items ?? [];
  const selected = items.filter(item => selectedIds.includes(item.id));
  const all = items.length > 0 && selected.length === items.length;
  const submit = async () => {
    if (locked.current || submitted.current || existingTicket || (items.length > 0 && !selected.length) || !description.trim() || step !== 'details') return;
    const attempt = scope();
    if (!attempt.current()) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      const data = await attempt.request('/api/v1/support/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketPayload(order, selectedIds, issue, description)) });
      if (!attempt.current()) return;
      if (!(data as { id?: string } | null)?.id) throw new Error('Unable to confirm ticket creation. Please try again.');
      submitted.current = true;
      setStep('success');
    } catch (cause) {
      if (!attempt.current()) return;
      if (isExistingTicketConflict(cause)) {
        const detail = (cause as { body?: { errors?: Array<{ detail?: { ticket_id?: string } }> } }).body?.errors?.[0]?.detail;
        setExistingTicket(detail?.ticket_id ?? 'existing');
      }
      setError(cause instanceof Error ? cause.message : 'Unable to submit your ticket. Please try again.');
    } finally {
      if (attempt.current()) { locked.current = false; setBusy(false); }
    }
  };
  return <OrderFeedbackSheet title={step === 'items' ? 'Which item had an issue?' : step === 'details' ? 'Open a support ticket' : 'Ticket submitted'}
    subtitle={step === 'items' ? 'Select one or more items from your order.' : undefined} dismissDisabled={busy} onClose={onClose}>
    {step === 'success' ? <>
      <CheckCircle2 size={36} color="#E53C3C" />
      <Text accessibilityLiveRegion="polite" style={s.text}>Our team will review your request and get back to you.</Text>
      <FeedbackButton label="Close" onPress={onClose} />
    </> : <>
      <Text style={s.muted}>Order #{order.order_number}</Text>
      {step === 'items' ? <>
        {!items.length ? <Text style={s.text}>Order items are unavailable. Please close this window and reload your order.</Text> : <>
          <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel="Select All" accessibilityState={{ checked: all }}
            onPress={() => setSelectedIds(all ? [] : items.map(item => item.id))} style={[s.card, { flexDirection: 'row', alignItems: 'center', minHeight: 44 }]}>
            {all ? <Check size={22} color="#E53C3C" /> : <Square size={22} color="#777777" />}<Text style={s.label}>{all ? 'Clear selection' : 'Select all'}</Text>
          </TouchableOpacity>
          {items.map(item => {
            const checked = selectedIds.includes(item.id);
            return <TouchableOpacity key={item.id} accessibilityRole="checkbox" accessibilityLabel={`Select ${item.product_name_snapshot}, quantity ${item.quantity}, ${cents(item.line_total_cents)}`}
              accessibilityState={{ checked }} onPress={() => setSelectedIds(ids => ids.includes(item.id) ? ids.filter(id => id !== item.id) : [...ids, item.id])}
              style={[s.card, checked && s.selected, { flexDirection: 'row', alignItems: 'center' }]}>
              {checked ? <Check size={22} color="#E53C3C" /> : <Square size={22} color="#777777" />}
              <View style={{ flex: 1, gap: 4 }}><Text style={s.label}>{feedbackItemTitle(item)}</Text>
                <Text style={s.muted}>Quantity: {item.quantity} · {cents(item.line_total_cents)}</Text>
                {feedbackItemSummary(item) ? <Text style={s.muted}>{feedbackItemSummary(item)}</Text> : null}
              </View>
            </TouchableOpacity>;
          })}
        </>}
        <View style={s.actions}><FeedbackButton label="Continue" disabled={!selected.length} onPress={() => { if (selected.length) setStep('details'); }} />
          <FeedbackButton label="Cancel" secondary onPress={onClose} /></View>
      </> : <>
        {selected.length ? <Text style={s.label}>For</Text> : null}
        <View style={s.actions}>{selected.map(item => <View key={item.id} style={[s.card, s.selected]}><Text style={s.secondaryText}>{feedbackItemTitle(item)}</Text></View>)}</View>
        <Text style={s.label}>Issue type</Text>
        <View style={s.actions}>{ORDER_ISSUES.map(option => <TouchableOpacity key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
          accessibilityState={{ checked: issue === option.value, disabled: busy }} disabled={busy} onPress={() => setIssue(option.value)}
          style={[s.card, { minHeight: 44, justifyContent: 'center' }, issue === option.value && s.selected]}>
          <Text style={[s.label, issue === option.value && s.secondaryText]}>{option.label}</Text>
        </TouchableOpacity>)}</View>
        <Text style={s.label}>Please Explain the Issue</Text>
        <TextInput accessibilityLabel="Please Explain the Issue" multiline placeholder="Tell us what happened..." placeholderTextColor="#777777"
          style={s.input} value={description} onChangeText={setDescription} editable={!busy} />
        <FeedbackError message={error} />
        {existingTicket ? <FeedbackButton label="View my support tickets" secondary onPress={() => {
          onClose();
          router.push(existingTicket && existingTicket !== 'existing' ? `/support/${existingTicket}` : `/profile?section=support&entry=${Date.now()}`);
        }} /> : null}
        <View style={s.actions}>{items.length > 1 ? <FeedbackButton label="Back" secondary disabled={busy} onPress={() => setStep('items')} /> : null}
          <FeedbackButton label="Submit ticket" disabled={(items.length > 0 && !selected.length) || !description.trim() || Boolean(existingTicket)} busy={busy} onPress={submit} />
          <FeedbackButton label="Cancel" secondary disabled={busy} onPress={onClose} /></View>
      </>}
    </>}
  </OrderFeedbackSheet>;
}
