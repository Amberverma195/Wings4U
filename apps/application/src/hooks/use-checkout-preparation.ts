import { useCallback, useEffect, useRef, useState } from 'react';
import { useCart } from '../context/cart';
import { useOrderSetup } from '../context/order-setup';
import { usePromo } from '../context/promo';
import { useSession } from '../context/session';
import { checkoutFingerprint, validateCheckout, type CheckoutSnapshot } from '../lib/checkout-preparation';

export function useCheckoutPreparation() {
  const cart = useCart(), setup = useOrderSetup(), promo = usePromo(), session = useSession();
  const latest = useRef({ cart, setup, promo, session });
  latest.current = { cart, setup, promo, session };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const snapshot = useCallback((): CheckoutSnapshot | null => {
    const { cart, setup, promo, session } = latest.current;
    const selection = setup.getConfirmedSetup();
    if (!selection || !cart.isCartHydrated || !session.loaded) return null;
    return { locationId: cart.locationId, items: cart.items, setup: selection,
      driverTipPercent: cart.driverTipPercent, promoCode: promo.promoCode,
      applyWingsReward: promo.applyWingsReward, customerId: session.authenticated ? session.user?.id ?? null : null };
  }, []);
  const current = snapshot();
  const fingerprint = current ? checkoutFingerprint(current) : null;
  const approved = Boolean(fingerprint && setup.hasCheckoutValidation(fingerprint));

  const cancel = useCallback(() => {
    generation.current++;
    inFlight.current = false;
    if (mounted.current) setBusy(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);

  const prepare = useCallback(async () => {
    if (inFlight.current) return false;
    if (!latest.current.setup.ready || !latest.current.cart.isCartHydrated) {
      setError('Your cart is still loading. Please try again in a moment.'); return false;
    }
    inFlight.current = true;
    const attempt = ++generation.current;
    setBusy(true); setError(null);
    try {
      const selection = await latest.current.setup.ensureOrderSetup();
      if (!selection || attempt !== generation.current || !mounted.current) return false;
      const start = snapshot();
      if (!start) throw new Error('Please confirm your order details again before checkout.');
      const key = checkoutFingerprint(start);
      await validateCheckout(start);
      const end = snapshot();
      if (attempt !== generation.current || !mounted.current) return false;
      if (!end || checkoutFingerprint(end) !== key) throw new Error('Your cart or order details changed. Review them and try Checkout again.');
      latest.current.setup.markCheckoutValidated(key);
      return true;
    } catch (cause) {
      if (attempt === generation.current && mounted.current) setError(cause instanceof Error ? cause.message : 'Unable to validate your order. Please try again.');
      return false;
    } finally {
      if (attempt === generation.current) {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }, [snapshot]);
  return { prepare, busy, error, cancel, fingerprint, approved };
}
