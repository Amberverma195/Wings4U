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
  const [hydrated, setHydrated] = useState(false);
  const prevAuthRef = useRef<boolean | null>(null);

  const dispatch = useCallback((action: PromoAction) => {
    setSelection((prev) => promoReducer(prev, action));
  }, []);

  // Hydrate once from AsyncStorage.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw) as Partial<PromoSelection> | null;
          if (parsed && typeof parsed === 'object') {
            setSelection({
              promoCode:
                typeof parsed.promoCode === 'string' && parsed.promoCode.trim()
                  ? parsed.promoCode
                  : null,
              applyWingsReward: Boolean(parsed.applyWingsReward),
            });
          }
        }
      } catch {
        // Corrupt/unavailable storage - start from an empty selection.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on change (after hydration so we never clobber stored state).
  useEffect(() => {
    if (!hydrated) return;
    const hasSelection = Boolean(selection.promoCode) || selection.applyWingsReward;
    if (hasSelection) {
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(selection)).catch(() => {});
    } else {
      void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    }
  }, [selection, hydrated]);

  // Clear the selection when the customer logs out (promos/rewards are
  // per-account). Only react to a true -> false transition.
  useEffect(() => {
    if (!session.loaded) return;
    const prev = prevAuthRef.current;
    prevAuthRef.current = session.authenticated;
    if (prev === true && !session.authenticated) {
      setSelection(EMPTY_PROMO_SELECTION);
    }
  }, [session.authenticated, session.loaded]);

  const value = useMemo<PromoContextValue>(
    () => ({
      promoCode: selection.promoCode,
      applyWingsReward: selection.applyWingsReward,
      hydrated,
      applyPromoCode: (code: string) => dispatch({ type: 'applyPromo', code }),
      redeemWingsReward: () => dispatch({ type: 'applyWingsReward' }),
      clearPromoCode: () => dispatch({ type: 'clearPromo' }),
      clearWingsReward: () => dispatch({ type: 'clearWingsReward' }),
      clearAll: () => dispatch({ type: 'clearAll' }),
    }),
    [selection, hydrated, dispatch],
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
