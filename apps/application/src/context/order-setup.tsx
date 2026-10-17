import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useCart } from './cart';
import { useSession } from './session';
import { useAccountData } from '../hooks/use-account-data';
import { OrderSetupModal } from '../components/order-setup-modal';
import { ORDER_SETUP_TTL_MS, normalizeDeliveryAddress, readOrderSetup, type DeliveryAddress, type OrderSetupSelection, type StoredOrderSetup } from '../lib/order-setup';
import type { FulfillmentType } from '../lib/types';

type OrderSetupContextValue = {
  deliveryAddress: DeliveryAddress | null;
  setDeliveryAddress: (address: DeliveryAddress) => void;
  openOrderSetup: (type?: FulfillmentType) => void;
  ensureOrderSetup: () => Promise<OrderSetupSelection | null>;
  getConfirmedSetup: () => OrderSetupSelection | null;
  hasCheckoutValidation: (fingerprint: string) => boolean;
  markCheckoutValidated: (fingerprint: string) => void;
  confirmed: boolean;
  ready: boolean;
};
const OrderSetupContext = createContext<OrderSetupContextValue | null>(null);
export function useOrderSetup() {
  const context = useContext(OrderSetupContext);
  if (!context) throw new Error('useOrderSetup must be used within OrderSetupProvider');
  return context;
}

export function OrderSetupProvider({ children }: { children: React.ReactNode }) {
  const cart = useCart();
  const session = useSession();
  const account = useAccountData();
  const owner = session.authenticated ? session.user?.id : 'guest';
  const previousOwner = useRef(owner);
  const { setFulfillmentType, setScheduledFor, setDriverTipPercent } = cart;
  const key = `wings4u.order-setup-v2:${cart.locationId}:${owner ?? 'loading'}`;
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<{ key: string; value: StoredOrderSetup | null } | null>(null);
  const [deliveryAddress, setAddress] = useState<DeliveryAddress | null>(null);
  const [visible, setVisible] = useState(false);
  const [requestedType, setRequestedType] = useState<FulfillmentType>('PICKUP');
  const [confirmed, setConfirmed] = useState(false);
  const [modalRevision, setModalRevision] = useState(0);
  const selection = useRef<OrderSetupSelection | null>(null);
  const awaySince = useRef<number | null>(null);
  const wasHydrated = useRef(false);
  const skipCapture = useRef(false);
  const writeQueue = useRef(Promise.resolve());
  const checkoutValidation = useRef<{ fingerprint: string; expiresAt: number } | null>(null);
  const setupRequest = useRef<{ promise: Promise<OrderSetupSelection | null>; resolve: (value: OrderSetupSelection | null) => void } | null>(null);
  const guestDraft = useRef<DeliveryAddress | null>(null);
  const restoreDraft = useRef<DeliveryAddress | null>(null);
  const restoreVisibility = useRef<boolean | null>(null);
  const stateRef = useRef({ ready, confirmed, cart, deliveryAddress });
  stateRef.current = { ready: ready && session.loaded && stored?.key === key, confirmed, cart, deliveryAddress };

  const getConfirmedSetup = useCallback((): OrderSetupSelection | null => {
    const current = stateRef.current;
    const value = selection.current;
    if (!current.ready || !current.confirmed || !current.cart.isCartHydrated || !value ||
      value.fulfillmentType !== current.cart.fulfillmentType || value.scheduledFor !== current.cart.scheduledFor) return null;
    const next = { fulfillmentType: value.fulfillmentType, scheduledFor: value.scheduledFor, ...(value.savedAddressId ? { savedAddressId: value.savedAddressId } : {}), deliveryAddress: current.deliveryAddress ?
      normalizeDeliveryAddress(current.deliveryAddress.line1, current.deliveryAddress.postal_code) : null };
    return readOrderSetup(JSON.stringify({ ...next, v: 1, lastActiveAt: awaySince.current ?? Date.now() })) ? next : null;
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setupRequest.current?.resolve(null);
    setupRequest.current = null;
  }, []);

  // Serialize writes so a background save cannot overwrite a later expiry/reset.
  const persist = useCallback((value: OrderSetupSelection | null, timestamp = Date.now()) => {
    const raw = value ? JSON.stringify({ ...value, v: 1, lastActiveAt: timestamp }) : null;
    writeQueue.current = writeQueue.current.catch(() => {}).then(async () => {
      if (raw) await AsyncStorage.setItem(key, raw);
      else await AsyncStorage.removeItem(key);
    }).catch(() => {});
  }, [key]);

  const apply = useCallback((value: OrderSetupSelection | null) => {
    setFulfillmentType(value?.fulfillmentType ?? 'PICKUP');
    setScheduledFor(value?.scheduledFor ?? null);
    if (!value || value.fulfillmentType === 'PICKUP') setDriverTipPercent('none');
    setAddress(value?.deliveryAddress ?? null);
  }, [setFulfillmentType, setScheduledFor, setDriverTipPercent]);

  const expire = useCallback(() => {
    guestDraft.current = null;
    selection.current = null;
    setConfirmed(false);
    checkoutValidation.current = null;
    apply(null);
    setRequestedType('PICKUP');
    setModalRevision(value => value + 1);
    close();
    persist(null);
  }, [apply, persist, close]);

  useEffect(() => {
    if (!session.loaded || !owner) return;
    let cancelled = false;
    const changed = previousOwner.current !== owner;
    const guestHandoff = changed && previousOwner.current === 'guest';
    const handoff = guestHandoff && !guestDraft.current ? selection.current : null;
    const handoffAddress = guestHandoff ? guestDraft.current ?? stateRef.current.deliveryAddress : null;
    restoreDraft.current = handoffAddress;
    restoreVisibility.current = changed ? visible : null;
    guestDraft.current = null;
    const previousKey = `wings4u.order-setup-v2:${cart.locationId}:${previousOwner.current}`;
    previousOwner.current = owner;
    setReady(false);
    setConfirmed(false);
    setAddress(handoffAddress);
    wasHydrated.current = false;
    selection.current = null;
    checkoutValidation.current = null;
    close();
    if (changed) {
      apply(handoff);
      if (handoffAddress) setAddress(handoffAddress);
      if (handoffAddress) setRequestedType('DELIVERY');
      // Remove the previous owner's details, including guest details after login.
      writeQueue.current = writeQueue.current.catch(() => {}).then(() => AsyncStorage.removeItem(previousKey)).catch(() => {});
    }
    // The old restaurant-only key cannot safely identify its customer. Never restore it.
    void AsyncStorage.removeItem(`wings4u.order-setup-v1:${cart.locationId}`).catch(() => {});
    void AsyncStorage.getItem(key).then(raw => {
      if (!cancelled) setStored({ key, value: handoff ? { ...handoff, v: 1, lastActiveAt: Date.now() } : changed ? null : readOrderSetup(raw) });
    }).catch(() => { if (!cancelled) setStored({ key, value: null }); });
    return () => { cancelled = true; };
  }, [key, close, session.loaded, owner, apply, cart.locationId]);

  useEffect(() => {
    if (!cart.isCartHydrated) { wasHydrated.current = false; return; }
    if (!stored || stored.key !== key || wasHydrated.current) return;
    wasHydrated.current = true;
    if (!ready) {
      // Recheck age after the cart finishes loading, which may take a while offline.
      const value = stored.value ? readOrderSetup(JSON.stringify(stored.value)) : null;
      selection.current = value;
      apply(value);
      if (!value && restoreDraft.current) setAddress(restoreDraft.current);
      restoreDraft.current = null;
      setConfirmed(Boolean(value));
      setVisible(restoreVisibility.current ?? !value);
      restoreVisibility.current = null;
      setReady(true);
      if (!value) persist(null);
    } else {
      // Signing in can merge a saved cart. Keep this session's chosen order setup.
      skipCapture.current = true;
      apply(selection.current);
    }
  }, [cart.isCartHydrated, stored, key, ready, apply, persist]);

  useEffect(() => {
    if (!ready || stored?.key !== key || !cart.isCartHydrated || !confirmed) return;
    if (skipCapture.current) { skipCapture.current = false; return; }
    if (selection.current && (selection.current.fulfillmentType !== cart.fulfillmentType || selection.current.scheduledFor !== cart.scheduledFor)) {
      selection.current = null;
      setConfirmed(false);
      checkoutValidation.current = null;
      persist(null);
      return;
    }
    selection.current = { fulfillmentType: cart.fulfillmentType, scheduledFor: cart.scheduledFor,
      ...(selection.current?.savedAddressId ? { savedAddressId: selection.current.savedAddressId } : {}),
      deliveryAddress: deliveryAddress ? normalizeDeliveryAddress(deliveryAddress.line1, deliveryAddress.postal_code) : null };
    persist(selection.current, awaySince.current ?? Date.now());
  }, [ready, stored?.key, key, cart.isCartHydrated, confirmed, cart.fulfillmentType, cart.scheduledFor, deliveryAddress, persist]);

  useEffect(() => {
    if (!ready || stored?.key !== key || !session.authenticated || account.loading || account.refreshing || account.sectionErrors.addresses) return;
    const id = selection.current?.savedAddressId;
    if (!id) return;
    const saved = account.data.addresses.find(address => address.id === id);
    if (!saved || saved.city !== 'London') {
      selection.current = null; setAddress(null); setConfirmed(false); checkoutValidation.current = null; persist(null);
      return;
    }
    const next = normalizeDeliveryAddress(saved.line1, saved.postal_code);
    if (JSON.stringify(next) !== JSON.stringify(deliveryAddress)) {
      checkoutValidation.current = null;
      setAddress(next);
    }
  }, [ready, stored?.key, key, session.authenticated, account.loading, account.refreshing, account.sectionErrors.addresses, account.data.addresses, deliveryAddress, persist]);

  useEffect(() => {
    if (!ready) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        if (awaySince.current === null) awaySince.current = Date.now();
        persist(selection.current, awaySince.current);
      } else {
        const expired = awaySince.current !== null && Date.now() - awaySince.current >= ORDER_SETUP_TTL_MS;
        awaySince.current = null;
        if (expired || (selection.current?.scheduledFor && Date.parse(selection.current.scheduledFor) <= Date.now())) expire();
        else persist(selection.current);
      }
    });
    // Refresh while foregrounded too, covering force-quit cases without a background event.
    const heartbeat = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (selection.current?.scheduledFor && Date.parse(selection.current.scheduledFor) <= Date.now()) expire();
      else persist(selection.current);
    }, 30_000);
    return () => { subscription.remove(); clearInterval(heartbeat); };
  }, [ready, persist, expire]);

  const openOrderSetup = useCallback((type?: FulfillmentType) => {
    setRequestedType(type ?? cart.fulfillmentType);
    setVisible(true);
  }, [cart.fulfillmentType]);

  const ensureOrderSetup = useCallback(() => {
    const value = getConfirmedSetup();
    if (value) return Promise.resolve(value);
    if (setupRequest.current) return setupRequest.current.promise;
    if (!stateRef.current.ready) return Promise.resolve(null);
    let resolve!: (value: OrderSetupSelection | null) => void;
    const promise = new Promise<OrderSetupSelection | null>(done => { resolve = done; });
    setupRequest.current = { promise, resolve };
    setRequestedType(stateRef.current.cart.fulfillmentType);
    setVisible(true);
    return promise;
  }, [getConfirmedSetup]);

  useEffect(() => {
    // Resolve only after React has committed the confirmed type/time/address to the cart.
    const value = getConfirmedSetup();
    if (value && setupRequest.current) {
      setupRequest.current.resolve(value);
      setupRequest.current = null;
    }
  }, [confirmed, cart.isCartHydrated, cart.fulfillmentType, cart.scheduledFor, deliveryAddress, getConfirmedSetup]);

  useEffect(() => () => { setupRequest.current?.resolve(null); setupRequest.current = null; }, []);

  const confirm = (value: OrderSetupSelection) => {
    guestDraft.current = null;
    selection.current = value;
    apply(value);
    setConfirmed(true);
    setVisible(false);
    persist(value);
  };

  const ownsState = session.loaded && previousOwner.current === owner && stored?.key === key;
  return <OrderSetupContext.Provider value={{ deliveryAddress: ownsState ? deliveryAddress : null, setDeliveryAddress: address => {
    if (selection.current) selection.current = { ...selection.current, savedAddressId: null };
    checkoutValidation.current = null;
    setAddress(address);
  }, openOrderSetup, ready: ready && ownsState, confirmed: confirmed && ownsState,
    ensureOrderSetup, getConfirmedSetup,
    hasCheckoutValidation: fingerprint => Boolean(getConfirmedSetup() && checkoutValidation.current?.fingerprint === fingerprint && checkoutValidation.current.expiresAt > Date.now()),
    markCheckoutValidated: fingerprint => { checkoutValidation.current = { fingerprint, expiresAt: Date.now() + 30_000 }; },
  }}>
    {children}
    {ready && ownsState && visible && <OrderSetupModal key={`${key}:${modalRevision}`} initialType={requestedType} initialScheduledFor={cart.scheduledFor}
      initialAddress={deliveryAddress} initialSavedAddressId={selection.current?.savedAddressId} onDraftAddress={address => { if (owner === 'guest') guestDraft.current = address; }} onClose={close} onConfirm={confirm} />}
  </OrderSetupContext.Provider>;
}
