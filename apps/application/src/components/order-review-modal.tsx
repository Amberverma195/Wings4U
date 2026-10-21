import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Star } from 'lucide-react-native';
import type { OrderDetail } from '../lib/types';
import { ApiRequestError } from '../lib/api';
import { confirmedReview, feedbackItemSummary, validReview, type OrderItemReview } from '../lib/order-feedback';
import { useOrderFeedbackRequest } from '../hooks/use-order-feedback-request';
import { FeedbackButton, FeedbackError, OrderFeedbackSheet, feedbackStyles as s } from './order-feedback-sheet';

type Draft = { rating: number; body: string };

export function OrderReviewModal({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const scope = useOrderFeedbackRequest(order);
  const [reviews, setReviews] = useState<Record<string, OrderItemReview>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, boolean>>({});
  const locks = useRef(new Set<string>());
  const saved = useRef(new Set<string>());

  const load = async () => {
    const attempt = scope();
    if (!attempt.current()) return;
    setLoading(true); setLoadError(null);
    try {
      const data = await attempt.request(`/api/v1/orders/${order.id}/reviews`);
      if (!attempt.current()) return;
      if (!Array.isArray(data)) throw new Error('Unable to load reviews. Please try again.');
      const next: Record<string, OrderItemReview> = {};
      for (const value of data) {
        const review = confirmedReview(value, order);
        next[review.order_item_id] = review;
      }
      for (const id of Object.keys(next)) saved.current.add(id);
      setReviews(previous => ({ ...previous, ...next }));
      return next;
    } catch (cause) {
      if (attempt.current()) setLoadError(cause instanceof Error ? cause.message : 'Unable to load reviews. Please try again.');
    } finally {
      if (attempt.current()) setLoading(false);
    }
  };
  // A new modal is mounted for every open, order and customer identity.
  useEffect(() => { void load(); }, []);

  const updateDraft = (id: string, change: Partial<Draft>) => setDrafts(previous => ({
    ...previous, [id]: { ...(previous[id] ?? { rating: 0, body: '' }), ...change },
  }));

  const submit = async (id: string) => {
    const draft = drafts[id];
    if (loading || loadError || locks.current.has(id) || saved.current.has(id) || !draft ||
        !validReview(draft.rating, draft.body) || !order.items.some(item => item.id === id)) return;
    const attempt = scope();
    if (!attempt.current()) return;
    locks.current.add(id); setBusy(previous => ({ ...previous, [id]: true }));
    setErrors(previous => ({ ...previous, [id]: '' }));
    try {
      const data = await attempt.request(`/api/v1/orders/${order.id}/order-items/${id}/reviews`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: draft.rating, review_body: draft.body.trim() || undefined }),
      });
      if (!attempt.current()) return;
      const review = confirmedReview(data, order);
      if (review.order_item_id !== id) throw new Error('Unable to confirm the saved review. Please reload reviews.');
      saved.current.add(id);
      setReviews(previous => ({ ...previous, [id]: review }));
    } catch (cause) {
      if (!attempt.current()) return;
      if (cause instanceof ApiRequestError && cause.status === 409) {
        saved.current.add(id);
        setConflicts(previous => ({ ...previous, [id]: true }));
        const refreshed = await load();
        if (attempt.current() && !refreshed?.[id]) setErrors(previous => ({ ...previous,
          [id]: 'This item already has a review. Reload reviews to see the saved review.' }));
      } else {
        setErrors(previous => ({ ...previous, [id]: cause instanceof Error ? cause.message : 'Unable to submit review. Please try again.' }));
      }
    } finally {
      if (attempt.current()) { locks.current.delete(id); setBusy(previous => ({ ...previous, [id]: false })); }
    }
  };

  return <OrderFeedbackSheet title="Rate your Order" onClose={onClose}>
    {loading ? <View accessibilityLiveRegion="polite" style={s.card}><ActivityIndicator color="#FF4D4D" /><Text style={s.muted}>Loading reviews...</Text></View> : null}
    <FeedbackError message={loadError} />
    {loadError || Object.keys(conflicts).some(id => !reviews[id]) ? <FeedbackButton label="Reload reviews" secondary disabled={loading} onPress={() => void load()} /> : null}
    {!order.items?.length ? <Text style={s.text}>Order items are unavailable. Please close this window and reload your order.</Text> :
      order.items.map(item => {
        const review = reviews[item.id];
        const draft = drafts[item.id] ?? { rating: 0, body: '' };
        const rating = review?.rating ?? draft.rating;
        const disabled = Boolean(review) || busy[item.id] || loading || Boolean(loadError) || conflicts[item.id];
        return <View key={item.id} style={s.card}>
          <Text style={s.label}>{item.product_name_snapshot}</Text>
          <Text style={s.muted}>Quantity: {item.quantity}</Text>
          {feedbackItemSummary(item) ? <Text style={s.muted}>{feedbackItemSummary(item)}</Text> : null}
          {review ? <Text accessibilityLiveRegion="polite" style={s.secondaryText}>Review submitted · {rating} of 5 stars</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {[1, 2, 3, 4, 5].map(value => <TouchableOpacity key={value} accessibilityRole="radio"
              accessibilityLabel={`${item.product_name_snapshot}, line ${item.line_no}, ${value} ${value === 1 ? 'star' : 'stars'}`}
              accessibilityState={{ checked: rating === value, disabled }} disabled={disabled}
              onPress={() => updateDraft(item.id, { rating: value })}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Star size={27} color={value <= rating ? '#F5B301' : '#999999'} fill={value <= rating ? '#F5B301' : 'none'} />
            </TouchableOpacity>)}
          </View>
          {review ? <>
            {review.review_body ? <Text style={s.text}>{review.review_body}</Text> : null}
            {review.admin_reply ? <View style={[s.card, s.selected]}><Text style={s.label}>Wings 4 U replied</Text><Text style={s.text}>{review.admin_reply}</Text></View> : null}
            {review.is_approved_public ? <Text style={s.muted}>Published publicly</Text> : null}
          </> : <>
            <TextInput accessibilityLabel={`Review for ${item.product_name_snapshot}, line ${item.line_no} (optional)`} multiline maxLength={2000}
              placeholder="Tell us about this item (optional)" placeholderTextColor="#777777" style={s.input} editable={!disabled}
              value={draft.body} onChangeText={body => updateDraft(item.id, { body })} />
            <FeedbackError message={errors[item.id] ?? null} />
            <FeedbackButton label="Submit review" disabled={disabled || !validReview(draft.rating, draft.body)} busy={busy[item.id]} busyLabel="Submitting…"
              onPress={() => void submit(item.id)} />
          </>}
        </View>;
      })}
    <FeedbackButton label="Close" secondary onPress={onClose} />
  </OrderFeedbackSheet>;
}
