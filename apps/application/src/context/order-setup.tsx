import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useCart } from './cart';
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
  const { setFulfillmentType, setScheduledFor, setDriverTipPercent } = cart;
  const key = `wings4u.order-setup-v1:${cart.locationId}`;
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
  const stateRef = useRef({ ready, confirmed, cart, deliveryAddress });
  stateRef.current = { ready, confirmed, cart, deliveryAddress };

  const getConfirmedSetup = useCallback((): OrderSetupSelection | null => {
    const current = stateRef.current;
    const value = selection.current;
    if (!current.ready || !current.confirmed || !current.cart.isCartHydrated || !value ||
      value.fulfillmentType !== current.cart.fulfillmentType || value.scheduledFor !== current.cart.scheduledFor) return null;
    const next = { fulfillmentType: value.fulfillmentType, scheduledFor: value.scheduledFor, deliveryAddress: current.deliveryAddress ?
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
    let cancelled = false;
    setReady(false);
    wasHydrated.current = false;
    selection.current = null;
    checkoutValidation.current = null;
    close();
    void AsyncStorage.getItem(key).then(raw => {
      if (!cancelled) setStored({ key, value: readOrderSetup(raw) });
    }).catch(() => { if (!cancelled) setStored({ key, value: null }); });
    return () => { cancelled = true; };
  }, [key, close]);

  useEffect(() => {
    if (!cart.isCartHydrated) { wasHydrated.current = false; return; }
    if (!stored || stored.key !== key || wasHydrated.current) return;
    wasHydrated.current = true;
    if (!ready) {
      // Recheck age after the cart finishes loading, which may take a while offline.
      const value = stored.value ? readOrderSetup(JSON.stringify(stored.value)) : null;
      selection.current = value;
      apply(value);
      setConfirmed(Boolean(value));
      setVisible(!value);
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
      deliveryAddress: deliveryAddress ? normalizeDeliveryAddress(deliveryAddress.line1, deliveryAddress.postal_code) : null };
    persist(selection.current, awaySince.current ?? Date.now());
  }, [ready, stored?.key, key, cart.isCartHydrated, confirmed, cart.fulfillmentType, cart.scheduledFor, deliveryAddress, persist]);

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
    selection.current = value;
    apply(value);
    setConfirmed(true);
    setVisible(false);
    persist(value);
  };

  return <OrderSetupContext.Provider value={{ deliveryAddress, setDeliveryAddress: setAddress, openOrderSetup, ready, confirmed,
    ensureOrderSetup, getConfirmedSetup,
    hasCheckoutValidation: fingerprint => Boolean(getConfirmedSetup() && checkoutValidation.current?.fingerprint === fingerprint && checkoutValidation.current.expiresAt > Date.now()),
    markCheckoutValidated: fingerprint => { checkoutValidation.current = { fingerprint, expiresAt: Date.now() + 30_000 }; },
  }}>
    {children}
    {ready && visible && <OrderSetupModal key={`${key}:${modalRevision}`} initialType={requestedType} initialScheduledFor={cart.scheduledFor}
      initialAddress={deliveryAddress} onClose={close} onConfirm={confirm} />}
  </OrderSetupContext.Provider>;
}
