import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Bike, CalendarDays, CarFront, Check, ChevronRight, Clock3, MapPin, X } from 'lucide-react-native';
import { useCart } from '../context/cart';
import { useMenu } from '../hooks/use-menu';
import { useAccountData } from '../hooks/use-account-data';
import { useSession } from '../context/session';
import { apiJson } from '../lib/api';
import { buildOrderSlots, DELIVERY_CITY, leadMinutes, normalizeDeliveryAddress, orderTimingLabel, orderTimeAvailable, validDeliveryAddress,
  type DeliveryAddress, type OrderSetupSelection } from '../lib/order-setup';
import type { FulfillmentType } from '../lib/types';

type Props = {
  initialType: FulfillmentType;
  initialScheduledFor: string | null;
  initialAddress: DeliveryAddress | null;
  initialSavedAddressId?: string | null;
  onClose: () => void;
  onConfirm: (value: OrderSetupSelection) => void;
  onDraftAddress?: (value: DeliveryAddress) => void;
};

export function OrderSetupModal({ initialType, initialScheduledFor, initialAddress, initialSavedAddressId, onClose, onConfirm, onDraftAddress }: Props) {
  const cart = useCart();
  const session = useSession();
  const account = useAccountData();
  const addresses = session.authenticated ? account.data.addresses : [];
  const [addressMode, setAddressMode] = useState<'manual' | 'saved'>(initialSavedAddressId ? 'saved' : 'manual');
  const [selectedId, setSelectedId] = useState<string | null>(initialSavedAddressId ?? null);
  const manualTouched = useRef(Boolean(initialAddress && !initialSavedAddressId));
  const savedSelectionTouched = useRef(Boolean(initialSavedAddressId));
  const insets = useSafeAreaInsets();
  const [type, setType] = useState(initialType);
  const [step, setStep] = useState<'setup' | 'schedule'>('setup');
  const [scheduledFor, setScheduledFor] = useState(initialScheduledFor);
  const [draftSlot, setDraftSlot] = useState(initialScheduledFor);
  const [dateKey, setDateKey] = useState('');
  const [line1, setLine1] = useState(initialSavedAddressId ? '' : initialAddress?.line1 ?? '');
  const [postalCode, setPostalCode] = useState(initialSavedAddressId ? '' : initialAddress?.postal_code ?? '');
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const { menu, loading, error, refetch } = useMenu(type, cart.locationId);
  // useMenu retains its previous response while refreshing; never offer stale slots.
  const location = !loading && !error ? menu?.location : undefined;
  const slots = useMemo(() => location ? buildOrderSlots(location, type, now) : [], [location, type, now]);
  const dates = useMemo(() => [...new Map(slots.map(slot => [slot.dateKey, slot.dateLabel])).entries()], [slots]);
  const selectedDay = dates.some(([key]) => key === dateKey) ? dateKey : dates[0]?.[0];
  const daySlots = slots.filter(slot => slot.dateKey === selectedDay);
  const selectedSavedAddress = addresses.find(value => value.id === selectedId) ?? null;
  const manualAddress = normalizeDeliveryAddress(line1, postalCode);
  const savedAddress = selectedSavedAddress ? { ...normalizeDeliveryAddress(selectedSavedAddress.line1, selectedSavedAddress.postal_code), city: selectedSavedAddress.city } : null;
  const address = addressMode === 'saved' ? savedAddress : manualAddress;
  const asapAvailable = Boolean(location && orderTimeAvailable(location, type, null, now));
  const scheduleValid = Boolean(scheduledFor && slots.some(slot => slot.value === scheduledFor));
  const addressValid = type === 'PICKUP' || validDeliveryAddress(address);
  const canContinue = Boolean(location && addressValid && (scheduledFor ? scheduleValid : asapAvailable));
  const timezone = location?.timezone ?? cart.locationTimezone;
  const [deliveryEstimate, setDeliveryEstimate] = useState<{ key: string; fee?: number; error?: string } | null>(null);
  const [estimateRetry, setEstimateRetry] = useState(0);
  const estimateKey = JSON.stringify([session.authenticated ? session.user?.id : 'guest', cart.locationId, type, address, scheduledFor]);
  useEffect(() => {
    setDeliveryEstimate(null);
    if (type !== 'DELIVERY' || !validDeliveryAddress(address) || !location || !(scheduledFor ? scheduleValid : asapAvailable)) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void apiJson<{ delivery_fee_cents: number; delivery_quote_token: string; expires_at: string }>('/api/v1/delivery/quote', {
        method: 'POST', locationId: cart.locationId, signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: cart.locationId, address_snapshot_json: address, scheduled_for: scheduledFor ?? undefined }),
      }).then(response => {
        if (cancelled) return;
        if (!response.data?.delivery_quote_token || !Number.isFinite(Date.parse(response.data.expires_at)) || Date.parse(response.data.expires_at) <= Date.now() || !Number.isFinite(response.data.delivery_fee_cents)) {
          throw new Error('Delivery could not be confirmed. Please try again.');
        }
        setDeliveryEstimate({ key: estimateKey, fee: response.data.delivery_fee_cents });
      }).catch(cause => { if (!cancelled) setDeliveryEstimate({ key: estimateKey, error: cause instanceof Error ? cause.message : 'Delivery could not be confirmed.' }); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [estimateKey, estimateRetry, Boolean(location), scheduleValid, asapAvailable]);

  const chooseAddress = (saved: typeof addresses[number]) => {
    savedSelectionTouched.current = true;
    setSelectedId(saved.id);
    setAddressMode('saved');
  };
  useEffect(() => {
    if (type !== 'DELIVERY' || !session.authenticated || account.loading || account.refreshing || account.sectionErrors.addresses) return;
    if (selectedId) {
      const saved = addresses.find(value => value.id === selectedId);
      if (saved) return;
      savedSelectionTouched.current = true;
      setSelectedId(null);
      return;
    }
    if (!addresses.length) {
      setAddressMode('manual');
      return;
    }
    if (addressMode === 'manual' && manualTouched.current) return;
    setAddressMode('saved');
    if (savedSelectionTouched.current) return;
    const preferred = addresses.find(value => value.is_default) ?? (addresses.length === 1 ? addresses[0] : null);
    if (preferred) setSelectedId(preferred.id);
  }, [type, session.authenticated, account.loading, account.refreshing, account.sectionErrors.addresses, addresses, selectedId, addressMode]);

  const editAddress = (field: 'line1' | 'postal_code', value: string) => {
    manualTouched.current = true;
    if (field === 'line1') setLine1(value); else setPostalCode(value);
    onDraftAddress?.({ ...normalizeDeliveryAddress(line1, postalCode), [field]: value });
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const chooseType = (next: FulfillmentType) => {
    if (next === type) return;
    setType(next);
    setScheduledFor(null);
    setDraftSlot(null);
    setDateKey('');
    setNotice(null);
  };
  const openSchedule = () => {
    const current = slots.find(slot => slot.value === scheduledFor) ?? slots[0];
    setDraftSlot(current?.value ?? null);
    setDateKey(current?.dateKey ?? '');
    setStep('schedule');
  };
  const back = () => step === 'schedule' ? setStep('setup') : onClose();
  const confirm = () => {
    if (!canContinue || !location) return;
    // Recheck the clock on the actual tap, including after the phone was locked.
    const available = orderTimeAvailable(location, type, scheduledFor);
    if (!available) { setNow(Date.now()); setNotice('That time is no longer available. Please choose another time.'); return; }
    cart.setLocationTimezone(location.timezone);
    onConfirm({ fulfillmentType: type, scheduledFor, deliveryAddress: type === 'DELIVERY' ? address : initialAddress,
      ...(type === 'DELIVERY' && addressMode === 'saved' && selectedId ? { savedAddressId: selectedId } : {}) });
  };

  return <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={back}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16), marginTop: insets.top + 16 }]} accessibilityViewIsModal>
        <View style={styles.handle} />
        {step === 'schedule' && <View style={styles.topRow}>
          <Pressable onPress={() => setStep('setup')} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Back to order setup"><ArrowLeft size={21} color="#29201D" /></Pressable>
          <Text style={styles.eyebrow}>PLAN AHEAD</Text>
          <Pressable onPress={onClose} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Close order setup"><X size={21} color="#64564E" /></Pressable>
        </View>}
        <ScrollView contentContainerStyle={[styles.body, step === 'setup' && styles.setupBody]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {step === 'setup' ? <View style={styles.titleRow}>
            <Text accessibilityRole="header" style={[styles.title, styles.titleInRow]}>How are you ordering?</Text>
            <Pressable onPress={onClose} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Close order setup"><X size={21} color="#64564E" /></Pressable>
          </View> : <Text accessibilityRole="header" style={styles.title}>{`Schedule ${type === 'PICKUP' ? 'pickup' : 'delivery'}`}</Text>}
          <Text style={styles.subtitle}>{step === 'schedule' ? `Choose a date and time. All times are in ${timezone}.` : 'Fresh wings, on your time. Choose what works for you.'}</Text>

          {step === 'setup' ? <>
            <View style={styles.methods} accessibilityRole="radiogroup" accessibilityLabel="Order type">
              {(['PICKUP', 'DELIVERY'] as const).map(method => {
                const selected = type === method, Icon = method === 'PICKUP' ? CarFront : Bike;
                return <Pressable key={method} onPress={() => chooseType(method)} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                  style={[styles.method, selected && styles.selected]}>
                  <Icon size={23} color={selected ? '#D93636' : '#75665C'} />
                  <Text style={styles.methodTitle}>{method === 'PICKUP' ? 'Pickup' : 'Delivery'}</Text>
                  <Text style={styles.small}>{method === 'PICKUP' ? 'Come grab your favourites' : 'We’ll bring them to you'}</Text>
                  <View style={[styles.radio, selected && styles.radioSelected]}>{selected && <Check size={12} color="#FFF" />}</View>
                </Pressable>;
              })}
            </View>

            {type === 'DELIVERY' && <View style={styles.addressBlock}>
              <View style={styles.labelRow}><MapPin size={17} color="#D93636" /><Text style={styles.label}>Where should we deliver?</Text></View>
              {session.authenticated && <View style={styles.addressActions} accessibilityRole="radiogroup" accessibilityLabel="Delivery address source">
                <Pressable accessibilityRole="radio" disabled={!addresses.length} accessibilityState={{ checked: addressMode === 'saved', disabled: !addresses.length }}
                  onPress={() => { setAddressMode('saved'); if (!selectedId) setSelectedId((addresses.find(value => value.is_default) ?? (addresses.length === 1 ? addresses[0] : null))?.id ?? null); }}
                  style={[styles.addressAction, addressMode === 'saved' && styles.addressActionSelected, !addresses.length && styles.addressActionDisabled]}>
                  <Text style={[styles.addressActionText, addressMode === 'saved' && styles.addressActionTextSelected]} numberOfLines={1}>My Addresses</Text>
                </Pressable>
                <Pressable accessibilityRole="radio" accessibilityState={{ checked: addressMode === 'manual' }}
                  style={[styles.addressAction, addressMode === 'manual' && styles.addressActionSelected]} onPress={() => {
                    manualTouched.current = true; setAddressMode('manual');
                  }}><Text style={[styles.addressActionText, addressMode === 'manual' && styles.addressActionTextSelected]} numberOfLines={1}>Enter New Address</Text></Pressable>
              </View>}
              {session.authenticated && account.loading && <Text style={styles.small}>Loading saved addresses…</Text>}
              {session.authenticated && account.sectionErrors.addresses && <Text style={styles.small}>Saved addresses couldn't be loaded. Enter an address below or try again.</Text>}
              {session.authenticated && account.sectionErrors.addresses && <Pressable accessibilityRole="button" onPress={() => void account.refresh()} style={styles.retry}><Text style={styles.link}>Retry saved addresses</Text></Pressable>}
              {session.authenticated && addressMode === 'saved' && addresses.length > 0 && <View accessibilityRole="radiogroup" accessibilityLabel="Saved delivery addresses">
                {addresses.map(saved => <Pressable key={saved.id} accessibilityRole="radio"
                  accessibilityLabel={`Deliver to ${saved.label || saved.line1}`} accessibilityState={{ checked: selectedId === saved.id }}
                  style={[styles.savedAddressCard, selectedId === saved.id && styles.selected]} onPress={() => chooseAddress(saved)}>
                  <Text style={styles.optionTitle}>{saved.label || 'Saved address'}{saved.is_default ? ' · Default' : ''}</Text>
                  <Text style={styles.small}>{saved.line1}, {saved.city}, {saved.postal_code}</Text>
                  {selectedId === saved.id && <View style={styles.savedCheck}><Check size={13} color="#FFF" /></View>}
                </Pressable>)}
              </View>}
              {addressMode === 'manual' && <><TextInput style={styles.input} value={line1} onChangeText={value => editAddress('line1', value)} placeholder="Street address, including unit / apartment"
                placeholderTextColor="#8B8079" accessibilityLabel="Delivery street address and unit" autoComplete="street-address" returnKeyType="next" />
              <View style={styles.addressRow}>
                <TextInput style={[styles.input, styles.city]} value={`${DELIVERY_CITY}, ON`} editable={false} accessibilityLabel="Delivery city" />
                <TextInput style={[styles.input, styles.postal]} value={postalCode} onChangeText={value => editAddress('postal_code', value)} placeholder="Postal code"
                  placeholderTextColor="#8B8079" accessibilityLabel="Delivery postal code" autoCapitalize="characters" autoComplete="postal-code" maxLength={10} />
              </View></>}
              {addressMode === 'manual' && postalCode.trim().length > 0 && !validDeliveryAddress(normalizeDeliveryAddress('address', postalCode)) &&
                <Text style={styles.error}>Enter a valid Canadian postal code.</Text>}
              {addressMode === 'saved' && selectedSavedAddress && selectedSavedAddress.city !== DELIVERY_CITY && <Text style={styles.error}>Delivery is currently supported in {DELIVERY_CITY}. Choose another address or try pickup.</Text>}
              {validDeliveryAddress(address) && (scheduledFor ? scheduleValid : asapAvailable) && deliveryEstimate?.key === estimateKey && deliveryEstimate.error && <>
                  <Text style={styles.error}>{deliveryEstimate.error}</Text>
                  <Pressable accessibilityRole="button" style={styles.retry} onPress={() => { setDeliveryEstimate(null); setEstimateRetry(value => value + 1); }}><Text style={styles.link}>Retry delivery estimate</Text></Pressable>
              </>}
            </View>}

            <Text style={styles.label}>When would you like it?</Text>
            <View style={styles.timingRow}>
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: !scheduledFor, disabled: !asapAvailable }} disabled={!asapAvailable}
              onPress={() => { setScheduledFor(null); setNotice(null); }} style={[styles.timing, !scheduledFor && asapAvailable && styles.selected, !asapAvailable && styles.muted]}>
              <Clock3 size={21} color="#D93636" />
              <View style={styles.grow}><Text style={styles.optionTitle}>ASAP</Text><Text style={styles.small}>{location ? asapAvailable ?
                type === 'PICKUP' ? `Ready in about ${leadMinutes(location, type)} minutes` : `Estimated ${leadMinutes(location, type)}–${Math.max(leadMinutes(location, type), location.delivery_max_minutes)} minutes` :
                'Unavailable right now — choose a scheduled time' : 'Checking availability…'}</Text></View>
              {!scheduledFor && asapAvailable && <Check size={18} color="#D93636" />}
            </Pressable>
            <Pressable onPress={openSchedule} disabled={!location || !slots.length} accessibilityRole="button" accessibilityLabel="Schedule a date and time"
              style={[styles.timing, scheduledFor && styles.selected, (!location || !slots.length) && styles.muted]}>
              <CalendarDays size={21} color="#D93636" />
              <View style={styles.grow}><Text style={styles.optionTitle}>Schedule for later</Text><Text style={styles.small}>{scheduledFor ? orderTimingLabel(scheduledFor, timezone) : 'Choose a date and time'}</Text></View>
              <ChevronRight size={18} color="#75665C" />
            </Pressable>
            </View>
            {scheduledFor && location && !scheduleValid && <Text style={styles.error}>Please choose a new scheduled time. Your previous time is no longer available.</Text>}
          </> : <>
            <Text style={styles.label}>Date</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
              {dates.map(([key, label]) => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: selectedDay === key }}
                onPress={() => { setDateKey(key); setDraftSlot(slots.find(slot => slot.dateKey === key)?.value ?? null); }} style={[styles.date, selectedDay === key && styles.selected]}>
                <Text style={styles.optionTitle}>{label}</Text>
              </Pressable>)}
            </ScrollView>
            <Text style={styles.label}>Available times</Text>
            <View style={styles.times}>
              {daySlots.map(slot => <Pressable key={slot.value} onPress={() => setDraftSlot(slot.value)} accessibilityRole="radio"
                accessibilityState={{ checked: draftSlot === slot.value }} style={[styles.time, draftSlot === slot.value && styles.selected]}>
                <Text style={styles.timeText}>{slot.label}</Text>
              </Pressable>)}
            </View>
          </>}

          {loading && <ActivityIndicator color="#D93636" style={{ marginTop: 12 }} />}
          {error && <View accessibilityLiveRegion="polite"><Text style={styles.error}>Couldn’t load ordering times. Please try again.</Text>
            <Pressable onPress={refetch} accessibilityRole="button" style={styles.retry}><Text style={styles.link}>Try again</Text></Pressable></View>}
          {location && !slots.length && <Text style={styles.error}>No {type === 'PICKUP' ? 'pickup' : 'delivery'} times are available in the next 7 days.{type === 'DELIVERY' ? ' You can try pickup instead.' : ''}</Text>}
          {notice && <Text style={styles.error} accessibilityLiveRegion="polite">{notice}</Text>}
        </ScrollView>
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: step === 'schedule' ? !slots.some(slot => slot.value === draftSlot) : !canContinue }}
            disabled={step === 'schedule' ? !slots.some(slot => slot.value === draftSlot) : !canContinue}
            onPress={() => step === 'schedule' ? (setScheduledFor(draftSlot), setNotice(null), setStep('setup')) : confirm()}
            style={({ pressed }) => [styles.primary, (step === 'schedule' ? !slots.some(slot => slot.value === draftSlot) : !canContinue) && styles.primaryDisabled, pressed && { opacity: 0.8 }]}>
            <Text style={styles.primaryText}>{step === 'schedule' ? 'Confirm time' : `Start ${type === 'PICKUP' ? 'pickup' : 'delivery'} order`}</Text>
          </Pressable>
          <Text style={styles.footerNote}>You can change these details anytime.</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#160D0AA6', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { backgroundColor: '#FFFCF9', width: '100%', maxWidth: 560, maxHeight: '94%', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#DDD3CB', marginTop: 9, marginBottom: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, gap: 8 },
  eyebrow: { flex: 1, fontSize: 10, letterSpacing: 1, fontWeight: '800', color: '#8B6F5E' },
  iconButton: { minHeight: 44, minWidth: 36, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 12 },
  setupBody: { paddingTop: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleInRow: { flex: 1 },
  title: { color: '#2B211C', fontSize: 26, fontWeight: '800' },
  subtitle: { color: '#81736A', fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 20 },
  methods: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  method: { flex: 1, borderWidth: 1, borderColor: '#E9DFD7', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 13, backgroundColor: '#FFF' },
  selected: { borderColor: '#D93636', backgroundColor: '#FFF0EB' },
  methodTitle: { fontSize: 15, fontWeight: '800', color: '#2B211C', marginTop: 7, marginBottom: 3 },
  small: { fontSize: 12, lineHeight: 17, color: '#81736A' },
  radio: { position: 'absolute', right: 12, top: 12, width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: '#DBCEC5', alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: '#D93636', borderColor: '#D93636' },
  label: { fontSize: 14, fontWeight: '800', color: '#382A23', marginBottom: 10 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  addressBlock: { marginBottom: 22 },
  input: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E7DCD3', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 13, color: '#382A23', minHeight: 46, marginBottom: 10 },
  addressRow: { flexDirection: 'row', gap: 10 },
  city: { flex: 1, backgroundColor: '#F2EBE5', color: '#81736A' },
  postal: { flex: 1 },
  addressActions: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: -4, marginBottom: 10, padding: 3, borderRadius: 12, backgroundColor: '#F4ECE7' },
  addressAction: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: 'transparent' },
  addressActionSelected: { borderColor: '#F2B7B0', backgroundColor: '#FFF' },
  addressActionDisabled: { opacity: 0.45 },
  addressActionText: { color: '#75665C', fontSize: 12, fontWeight: '700' },
  addressActionTextSelected: { color: '#D93636' },
  savedAddressCard: { position: 'relative', minHeight: 62, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10, paddingRight: 42, marginBottom: 8, borderWidth: 1, borderColor: '#E7DCD3', borderRadius: 12, backgroundColor: '#FFF' },
  savedCheck: { position: 'absolute', right: 12, top: 12, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D93636' },
  timingRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  timing: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#E9DFD7', backgroundColor: '#FFF', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 10, minHeight: 76 },
  grow: { flex: 1 },
  optionTitle: { fontSize: 13, fontWeight: '800', color: '#382A23', marginBottom: 3 },
  muted: { opacity: 0.5 },
  dateRow: { gap: 8, paddingBottom: 20 },
  date: { paddingHorizontal: 14, paddingVertical: 14, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#E9DFD7', backgroundColor: '#FFF' },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  time: { minWidth: 104, paddingHorizontal: 10, paddingVertical: 15, borderRadius: 10, borderWidth: 1, borderColor: '#E9DFD7', backgroundColor: '#FFF' },
  timeText: { fontSize: 12, color: '#382A23', fontWeight: '600', textAlign: 'center' },
  error: { color: '#B42C2C', fontSize: 12, lineHeight: 18, marginTop: 8 },
  retry: { paddingVertical: 12, minHeight: 44 },
  link: { color: '#D93636', fontWeight: '700' },
  footer: { paddingHorizontal: 22, paddingTop: 10 },
  primary: { minHeight: 50, borderRadius: 16, backgroundColor: '#D93636', alignItems: 'center', justifyContent: 'center' },
  primaryDisabled: { backgroundColor: '#D9C9C2' },
  primaryText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  footerNote: { textAlign: 'center', color: '#9A8C82', fontSize: 11, marginTop: 10 },
});
