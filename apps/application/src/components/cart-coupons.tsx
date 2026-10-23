import React, { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react-native';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCart } from '../context/cart';
import { usePromo } from '../context/promo';
import { useSession } from '../context/session';
import { useAccountData, type WingsRewardsSummary } from '../hooks/use-account-data';
import { apiJson, type ApiRequestError } from '../lib/api';
import { cartQuoteKey } from '../lib/cart-quote';
import { formatBxgyDetails, promoBenefitLabel, promoFulfillmentLabel } from '../lib/deals-display';
import { hasAppliedPromo, wingsRewardBlockedReason, type PromoSelection } from '../lib/promo-selection';
import type { ActivePromo, CartQuoteResponse } from '../lib/types';

type Props = {
  quote: CartQuoteResponse | null;
  requestSelection: (selection: PromoSelection) => Promise<CartQuoteResponse>;
  onValidated?: (quote: CartQuoteResponse, selection: PromoSelection) => void;
  disabled?: boolean;
  contextKey?: string;
  active?: boolean;
  cartTheme?: boolean;
};

export function CartCoupons({ quote, requestSelection, onValidated, disabled, contextKey: extraContext = '', active = true, cartTheme = false }: Props) {
  const cart = useCart(), promo = usePromo(), session = useSession(), account = useAccountData(), router = useRouter();
  const [open, setOpen] = useState(false), [missingItem, setMissingItem] = useState(false);
  const [promotions, setPromotions] = useState<ActivePromo[]>([]);
  const [rewards, setRewards] = useState<WingsRewardsSummary | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const attempt = useRef(0), listAttempt = useRef(0), visible = useRef(false), locked = useRef(false);
  const customerKey = `${session.loaded}:${session.authenticated}:${session.user?.id ?? ''}`;
  const contextKey = cartQuoteKey({ locationId: cart.locationId, items: cart.items, fulfillmentType: cart.fulfillmentType,
    scheduledFor: cart.scheduledFor, driverTipPercent: cart.driverTipPercent, promoCode: promo.promoCode,
    applyWingsReward: promo.applyWingsReward }, customerKey) + extraContext + String(active);
  const latest = useRef(contextKey); latest.current = contextKey;
  const owner = `${cart.locationId}:${customerKey}`;
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const close = () => { visible.current = false; attempt.current++; listAttempt.current++; locked.current = false; setBusy(null); setOpen(false); setError(null); };
  useEffect(() => () => { visible.current = false; attempt.current++; listAttempt.current++; }, []);
  useEffect(() => { if (!active) { close(); setMissingItem(false); } }, [active]);
  useEffect(() => { attempt.current++; locked.current = false; setBusy(null); setError(null); }, [contextKey]);

  const refresh = async () => {
    const request = ++listAttempt.current, start = owner;
    setLoading(true); setLoadError(null); setError(null); setPromotions([]); setRewards(null); setLoadedOwner(null);
    const read: typeof apiJson = async (path, init) => {
      try { return await apiJson(path, init); }
      catch (error) {
        if ((error as ApiRequestError).status !== 401 || !session.authenticated || currentOwner.current !== start) throw error;
        if (!await session.refresh() || currentOwner.current !== start) throw error;
        return apiJson(path, init);
      }
    };
    const result = await Promise.allSettled([
      read<ActivePromo[]>(`/api/v1/promotions/active?ts=${Date.now()}`, { locationId: cart.locationId, cache: 'no-store' }),
      session.authenticated ? read<WingsRewardsSummary>('/api/v1/rewards/me') : Promise.resolve({ data: null }),
    ]);
    if (!visible.current || request !== listAttempt.current || currentOwner.current !== start) return;
    const [offers, balance] = result;
    setLoadedOwner(start);
    if (offers.status === 'fulfilled') setPromotions(offers.value.data ?? []);
    if (balance.status === 'fulfilled') setRewards(balance.value.data ?? null);
    const failures = result.filter((value): value is PromiseRejectedResult => value.status === 'rejected');
    if (failures.length) setLoadError(failures.map(value => value.reason instanceof Error ? value.reason.message : 'Unable to load coupons and rewards.').join(' '));
    setLoading(false);
  };
  useEffect(() => {
    if (open) { attempt.current++; locked.current = false; setBusy(null); void refresh(); }
    // Refresh the visible list when its location or customer changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const apply = async (selection: PromoSelection, label: string) => {
    if (locked.current || disabled || !visible.current) return;
    locked.current = true; setBusy(label); setError(null);
    const request = ++attempt.current, start = contextKey;
    try {
      const priced = await requestSelection(selection);
      if (!visible.current || request !== attempt.current || latest.current !== start) return;
      if (selection.promoCode && !hasAppliedPromo(priced, selection.promoCode)) throw new Error('The selected coupon is not applied to this total.');
      if (selection.applyWingsReward && !priced.wings_reward?.applied) {
        if (priced.wings_reward?.not_eligible_reason === 'NO_WINGS_IN_CART') { close(); setMissingItem(true); return; }
        throw new Error(wingsRewardBlockedReason(true, priced) ?? 'This reward could not be applied.');
      }
      onValidated?.(priced, selection);
      if (selection.promoCode) promo.applyPromoCode(selection.promoCode); else promo.redeemWingsReward();
      close();
    } catch (cause) {
      if (visible.current && request === attempt.current && latest.current === start) setError(cause instanceof Error ? cause.message : 'Unable to apply this offer.');
    } finally {
      if (request === attempt.current) { locked.current = false; setBusy(null); }
    }
  };
  const currentRewards = loadedOwner === owner ? rewards : null;
  const cachedRewards = session.authenticated ? account.data.wingsRewards : null;
  const summary = currentRewards ?? (loadedOwner === null ? cachedRewards : null);
  const rewardAvailable = session.authenticated && Boolean(summary && summary.stamps_per_reward > 0 && summary.available_stamps >= summary.stamps_per_reward);
  const livePromos = loadedOwner === owner ? promotions.filter(value => !value.endsAt || Date.parse(value.endsAt) > Date.now()) : [];
  const rewardApplied = Boolean(promo.applyWingsReward && quote?.wings_reward?.applied);
  const clear = () => { attempt.current++; locked.current = false; setBusy(null); setError(null); promo.clearAll(); };
  return <>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="See coupons & rewards" disabled={disabled}
      style={[s.entry, cartTheme && s.cartEntry]} onPress={() => { visible.current = true; setOpen(true); void refresh(); }}>
      <Text style={[s.entryText, cartTheme && s.cartEntryText]}>{rewardApplied ? '1lb of wings free · Applied' : 'See coupons & rewards'}</Text><Text style={[s.action, cartTheme && s.cartEntryAccent]}>→</Text>
    </TouchableOpacity>
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <View style={s.overlay}><Pressable accessibilityLabel="Dismiss coupons" accessibilityRole="button" style={s.backdrop} onPress={close} />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={s.sheet} accessibilityViewIsModal onAccessibilityEscape={close}>
          <View style={s.header}><Text accessibilityRole="header" style={s.title}>Available Coupons</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close coupons" onPress={close} style={s.close}><Text>Close</Text></TouchableOpacity></View>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <Text style={s.meta}>75 &amp; 100 Wing Party Specials are excluded from all coupons.</Text>
            {loading ? <View accessibilityLiveRegion="polite"><ActivityIndicator color="#F97316" /><Text>Checking coupons</Text></View> : null}
            {rewardAvailable ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Apply Wings Reward" disabled={Boolean(busy) || rewardApplied || loading}
              accessibilityState={{ disabled: Boolean(busy) || rewardApplied || loading, selected: rewardApplied }} style={[s.card, rewardApplied && s.appliedCard]}
              onPress={() => void apply({ promoCode: null, applyWingsReward: true }, 'reward')}>
              <View style={s.info}><Text style={s.cardTitle}>Get 1lb of wings free</Text><Text style={s.meta}>From My Rewards · {summary?.available_stamps} stamps</Text>
                <Text style={s.meta}>Ready to redeem on an individual 1LB wings item.</Text></View>
              <Text style={s.action}>{busy === 'reward' ? 'Validating…' : rewardApplied ? 'Applied' : 'Apply'}</Text>
            </TouchableOpacity> : null}
            {!loading ? livePromos.map(coupon => {
              const applied = hasAppliedPromo(quote, coupon.code), automatic = Boolean(coupon.autoApply);
              const bxgy = formatBxgyDetails(coupon), fulfillment = promoFulfillmentLabel(coupon.eligibleFulfillmentType);
              return <TouchableOpacity key={coupon.id} style={[s.card, applied && s.appliedCard]} accessibilityRole="button" accessibilityLabel={`Apply coupon ${coupon.code}`}
                accessibilityHint={coupon.id.startsWith('first-order-deal:') ? 'First order only. Pickup & delivery · Lunch Specials eligible. Excludes 75 & 100 Wing Party Specials.' : undefined}
                disabled={automatic || applied || Boolean(busy)} accessibilityState={{ disabled: automatic || applied || Boolean(busy), selected: applied }}
                onPress={() => { if (!automatic) void apply({ promoCode: coupon.code, applyWingsReward: false }, coupon.code); }}>
                <View style={s.info}><Text style={s.cardTitle}>{coupon.code}</Text><Text style={s.meta}>{coupon.name}</Text>
                  {coupon.id.startsWith('first-order-deal:') ? <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 }}>
                    <Info size={15} color="#666666" accessible={false} importantForAccessibility="no" style={{ marginTop: 2 }} />
                    <Text style={[s.meta, { flex: 1, marginTop: 0 }]}>First order only. Pickup &amp; delivery · Lunch Specials eligible. Excludes 75 &amp; 100 Wing Party Specials.</Text>
                  </View> : null}
                  <Text style={s.meta}>{promoBenefitLabel(coupon)}{coupon.minSubtotalCents > 0 ? ` (Min $${(coupon.minSubtotalCents / 100).toFixed(2)})` : ''}</Text>
                  {bxgy ? <Text style={s.meta}>{bxgy}</Text> : null}{fulfillment ? <Text style={s.meta}>{fulfillment}</Text> : null}
                </View><Text style={s.action}>{busy === coupon.code ? 'Validating…' : automatic ? (applied ? 'Auto · Applied' : 'Auto') : applied ? 'Applied' : 'Apply'}</Text>
              </TouchableOpacity>;
            }) : null}
            {!loading && !loadError && !livePromos.length && !rewardAvailable ? <Text style={s.empty}>No coupons yet</Text> : null}
            {!session.authenticated ? <Text style={s.meta}>Sign in to see your earned Wings Rewards. Coupon eligibility is checked when applied.</Text> : null}
            {loadError ? <View><Text accessibilityRole="alert" style={s.error}>{loadError}</Text><TouchableOpacity accessibilityRole="button" onPress={() => void refresh()} style={s.close}><Text>Retry coupons</Text></TouchableOpacity></View> : null}
            {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
            {promo.promoCode || promo.applyWingsReward ? <TouchableOpacity accessibilityRole="button" style={s.clear} onPress={clear}><Text>Clear all rewards</Text></TouchableOpacity> : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
    <Modal visible={missingItem} transparent animationType="fade" onRequestClose={() => setMissingItem(false)}>
      <View style={s.overlay}><View style={s.dialog} accessibilityViewIsModal onAccessibilityEscape={() => setMissingItem(false)}>
        <Text accessibilityRole="header" style={s.title}>No relevant item in the cart</Text><Text style={s.meta}>Coupon is only applicable to 1LB individual wings.</Text>
        <TouchableOpacity accessibilityRole="button" style={s.clear} onPress={() => { setMissingItem(false); router.push({ pathname: '/(tabs)/menu', params: { category: 'wings', promotion: 'reward', ts: String(Date.now()) } }); }}><Text>Add to cart</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={s.close} onPress={() => setMissingItem(false)}><Text>Cancel</Text></TouchableOpacity>
      </View></View>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  cartEntry: { backgroundColor: '#FFF0EA', borderColor: 'rgba(229,60,60,0.3)' },
  cartEntryText: { color: '#30241F' },
  cartEntryAccent: { color: '#E53C3C' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderWidth: 1, borderColor: 'rgba(249,115,22,0.3)', backgroundColor: '#FFF7ED', borderRadius: 12, marginVertical: 12, minHeight: 48 },
  entryText: { flex: 1, fontSize: 15, fontWeight: '700', color: '#30251E' }, action: { fontSize: 14, fontWeight: '800', color: '#F97316' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0 },
  sheet: { maxHeight: '90%', backgroundColor: '#FAFAFA', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 20 }, title: { flexShrink: 1, fontSize: 22, fontWeight: '800', color: '#1A1A1A' },
  close: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', padding: 8 }, body: { padding: 20, paddingTop: 0, gap: 12 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1, borderColor: '#E7E7E7' },
  appliedCard: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  info: { flex: 1 }, cardTitle: { fontSize: 16, fontWeight: '800', color: '#1A1A1A' }, meta: { fontSize: 13, lineHeight: 19, color: '#666', marginTop: 4 },
  error: { color: '#B91C1C', fontSize: 14, lineHeight: 20 }, empty: { textAlign: 'center', fontSize: 18, fontWeight: '700', padding: 24 },
  clear: { borderRadius: 12, padding: 16, minHeight: 48, alignItems: 'center', backgroundColor: '#FCE9D5' },
  dialog: { margin: 20, padding: 24, gap: 16, borderRadius: 20, backgroundColor: '#FFF' },
});
