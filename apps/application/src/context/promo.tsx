/**
 * Promo/reward selection context.
 *
 * The website keeps the selected coupon / wings-reward intent in
 * `sessionStorage` so it survives navigation between the cart and checkout.
 * React Native has no sessionStorage, so this provider holds the selection in
 * memory and mirrors it to AsyncStorage, keeping it alive while the customer
 * moves between the Deals tab, Cart, and Checkout.
 *
 * It stores ONLY the selection (which coupon / whether to redeem the reward).
 * All discount math stays server-side; see `lib/promo-selection.ts`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSession } from './session';
import { getSessionGeneration } from '../lib/token-store';
import {
  EMPTY_PROMO_SELECTION,
  promoReducer,
  type PromoAction,
  type PromoSelection,
} from '../lib/promo-selection';

const STORAGE_KEY = 'wings4u.mobile-promo-selection-v1';

type PromoContextValue = PromoSelection & {
  /** False until the persisted selection has been read back. */
  hydrated: boolean;
  applyPromoCode: (code: string) => void;
  redeemWingsReward: () => void;
  clearPromoCode: () => void;
  clearWingsReward: () => void;
  clearAll: () => void;
};

const PromoContext = createContext<PromoContextValue | null>(null);

export function PromoProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const [selection, setSelection] = useState<PromoSelection>(EMPTY_PROMO_SELECTION);
  const customerKey = session.authenticated ? session.user?.id ?? 'authenticated' : 'guest';
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const hydrated = session.loaded && loadedOwner === customerKey;
  const owner = useRef(customerKey); owner.current = customerKey;
  const storageWrites = useRef(Promise.resolve());
  const enqueueWrite = useCallback((value: string | null) => {
    const generation = getSessionGeneration();
    storageWrites.current = storageWrites.current.then(async () => {
      if (generation !== getSessionGeneration()) return;
      if (value) await AsyncStorage.setItem(STORAGE_KEY, value); else await AsyncStorage.removeItem(STORAGE_KEY);
      if (generation !== getSessionGeneration()) await AsyncStorage.removeItem(STORAGE_KEY);
    }).catch(() => {});
  }, []);
  const dispatch = useCallback((action: PromoAction) => {
    if (!hydrated) return;
    setSelection(prev => promoReducer(prev, action));
  }, [hydrated]);

  // Mask a previous account immediately, and hydrate only the current customer's selection.
  useEffect(() => {
    if (!session.loaded) return;
    let cancelled = false;
    const current = customerKey;
    void (async () => {
      let next = EMPTY_PROMO_SELECTION;
      try {
        await storageWrites.current;
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const storedOwner = parsed.owner ?? 'guest';
          // Guest coupons may survive sign-in; earned rewards never cross accounts.
          if (storedOwner === current || storedOwner === 'guest') {
            next = { promoCode: typeof parsed.promoCode === 'string' && parsed.promoCode.trim() ? parsed.promoCode.trim() : null,
              applyWingsReward: storedOwner === current && current !== 'guest' && !parsed.promoCode && parsed.applyWingsReward === true };
          }
        }
      } catch { /* Unavailable/corrupt storage starts with no selection. */ }
      if (!cancelled && owner.current === current) { setSelection(next); setLoadedOwner(current); }
    })();
    return () => { cancelled = true; };
  }, [customerKey, session.loaded]);

  useEffect(() => {
    if (!hydrated) return;
    enqueueWrite(selection.promoCode || selection.applyWingsReward
      ? JSON.stringify({ ...selection, owner: customerKey }) : null);
  }, [selection, hydrated, customerKey, enqueueWrite]);

  const visible = hydrated ? selection : EMPTY_PROMO_SELECTION;
  const value = useMemo<PromoContextValue>(
    () => ({
      promoCode: visible.promoCode,
      applyWingsReward: visible.applyWingsReward,
      hydrated,
      applyPromoCode: (code: string) => dispatch({ type: 'applyPromo', code }),
      redeemWingsReward: () => dispatch({ type: 'applyWingsReward' }),
      clearPromoCode: () => dispatch({ type: 'clearPromo' }),
      clearWingsReward: () => dispatch({ type: 'clearWingsReward' }),
      clearAll: () => dispatch({ type: 'clearAll' }),
    }),
    [visible, hydrated, dispatch],
  );

  return <PromoContext.Provider value={value}>{children}</PromoContext.Provider>;
}

export function usePromo(): PromoContextValue {
  const ctx = useContext(PromoContext);
  if (!ctx) {
    throw new Error('usePromo must be used within a PromoProvider');
  }
  return ctx;
}
