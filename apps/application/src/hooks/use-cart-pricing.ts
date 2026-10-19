import { useEffect, useRef, useState } from 'react';
import { useSession } from '../context/session';
import { apiJson, type ApiRequestError } from '../lib/api';
import { cartQuoteKey, requestCartQuote, type CartQuoteInput } from '../lib/cart-quote';
import { getCartItemIssue, type CartItemIssue } from '../lib/cart-validation';
import { isPromoRejectedQuoteError, type PromoSelection } from '../lib/promo-selection';
import type { CartQuoteResponse } from '../lib/types';
import { cartPricingRecovery, type CartPricingRecovery } from '../lib/cart-pricing-error';

export function useCartPricing(input: CartQuoteInput, ready: boolean, clearRejectedPromo: () => void) {
  const session = useSession();
  const customerKey = `${session.loaded}:${session.authenticated}:${session.user?.id ?? ''}`;
  const key = cartQuoteKey(input, customerKey);
  // Only the tip may differ for a display-only fallback. All other request and
  // account inputs remain in this key, including future CartQuoteInput fields.
  const displayKey = cartQuoteKey({ ...input, driverTipPercent: 'none' }, customerKey);
  const latest = useRef(key);
  const authoritativeKey = useRef<string | null>(null);
  // Returning to an older tip must not restore its old authority. A fresh
  // coupon validation may explicitly approve the incoming selection's key.
  if (latest.current !== key && authoritativeKey.current !== key) authoritativeKey.current = null;
  latest.current = key;
  const mounted = useRef(true);
  const quoteGeneration = useRef(0);
  const [priced, setPriced] = useState<{ key: string; displayKey: string; quote: CartQuoteResponse } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string; issue: CartItemIssue | null; recovery: CartPricingRecovery } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const current = ready && session.loaded && authoritativeKey.current === key && priced?.key === key ? priced.quote : null;
  const error = failure?.key === key ? failure.message : null;
  const displayQuote = current ?? (ready && session.loaded && !error && priced?.displayKey === displayKey ? priced.quote : null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!ready) setPriced(null); }, [ready]);

  const request = async (selection: PromoSelection) => {
    const start = key;
    const generation = quoteGeneration.current;
    const isCurrent = () => mounted.current && latest.current === start && generation === quoteGeneration.current;
    const customerRequest: typeof apiJson = async (path, init) => {
      if (!isCurrent()) throw new Error('Your cart or account changed. Please try again.');
      try { return await apiJson(path, init); }
      catch (error) {
        if ((error as ApiRequestError).status !== 401 || !session.authenticated || latest.current !== start) throw error;
        if (!await session.refresh() || !isCurrent()) throw error;
        return apiJson(path, init);
      }
    };
    const quote = await requestCartQuote({ ...input, ...selection }, customerRequest);
    if (!isCurrent()) throw new Error('Your cart or account changed. Please try again.');
    return quote;
  };

  useEffect(() => {
    if (!ready || !session.loaded || !input.items.length || (priced?.key === key && authoritativeKey.current === key)) return;
    setPriced(previous => previous?.displayKey === displayKey ? previous : null);
    setFailure(null);
    const generation = ++quoteGeneration.current;
    let cancelled = false;
    const timeout = setTimeout(() => {
      void request(input).then(quote => {
        if (!cancelled && latest.current === key && generation === quoteGeneration.current) {
          authoritativeKey.current = key;
          setPriced({ key, displayKey, quote }); setFailure(null);
        }
      }).catch(cause => {
        if (cancelled || latest.current !== key || generation !== quoteGeneration.current) return;
        const message = cause instanceof Error ? cause.message : 'Unable to price cart.';
        setPriced(null);
        setFailure({ key, message, issue: getCartItemIssue(cause), recovery: cartPricingRecovery(cause) });
        if (input.promoCode && isPromoRejectedQuoteError(message)) { setNotice(message); clearRejectedPromo(); }
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(timeout); };
    // The serialized key includes every pricing and account input. Context object identity does not price a cart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, retry]);

  return { quote: current, displayQuote, displayOnly: Boolean(displayQuote && !current), error, notice,
    recovery: failure?.key === key ? failure.recovery : null, issue: failure?.key === key ? failure.issue : null,
    loading: ready && input.items.length > 0 && !current && !error,
    requestSelection: request,
    acceptSelection: (quote: CartQuoteResponse, selection: PromoSelection) => {
      quoteGeneration.current++;
      authoritativeKey.current = cartQuoteKey({ ...input, ...selection }, customerKey);
      setPriced({ key: cartQuoteKey({ ...input, ...selection }, customerKey),
        displayKey: cartQuoteKey({ ...input, ...selection, driverTipPercent: 'none' }, customerKey), quote }); setFailure(null); setNotice(null);
    },
    refresh: () => { quoteGeneration.current++; setPriced(null); setFailure(null); setRetry(value => value + 1); },
  };
}
