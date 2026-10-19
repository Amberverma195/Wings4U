import { useEffect, useRef, useState } from 'react';
import { useSession } from '../context/session';
import { apiJson, type ApiRequestError } from '../lib/api';
import { cartQuoteKey, requestCartQuote, type CartQuoteInput } from '../lib/cart-quote';
import { getCartItemIssue, type CartItemIssue } from '../lib/cart-validation';
import { isPromoRejectedQuoteError, type PromoSelection } from '../lib/promo-selection';
import type { CartQuoteResponse } from '../lib/types';

export function useCartPricing(input: CartQuoteInput, ready: boolean, clearRejectedPromo: () => void) {
  const session = useSession();
  const customerKey = `${session.loaded}:${session.authenticated}:${session.user?.id ?? ''}`;
  const key = cartQuoteKey(input, customerKey);
  const latest = useRef(key); latest.current = key;
  const mounted = useRef(true);
  const quoteGeneration = useRef(0);
  const [priced, setPriced] = useState<{ key: string; quote: CartQuoteResponse } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string; issue: CartItemIssue | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const current = priced?.key === key ? priced.quote : null;
  const error = failure?.key === key ? failure.message : null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!ready) setPriced(null); }, [ready]);

  const request = async (selection: PromoSelection) => {
    const start = key;
    const customerRequest: typeof apiJson = async (path, init) => {
      try { return await apiJson(path, init); }
      catch (error) {
        if ((error as ApiRequestError).status !== 401 || !session.authenticated || latest.current !== start) throw error;
        if (!await session.refresh() || latest.current !== start) throw error;
        return apiJson(path, init);
      }
    };
    const quote = await requestCartQuote({ ...input, ...selection }, customerRequest);
    if (!mounted.current || latest.current !== start) throw new Error('Your cart or account changed. Please try again.');
    return quote;
  };

  useEffect(() => {
    if (!ready || !session.loaded || !input.items.length || priced?.key === key) return;
    setPriced(null);
    setFailure(null);
    const generation = ++quoteGeneration.current;
    let cancelled = false;
    const timeout = setTimeout(() => {
      void request(input).then(quote => {
        if (!cancelled && latest.current === key && generation === quoteGeneration.current) { setPriced({ key, quote }); setFailure(null); }
      }).catch(cause => {
        if (cancelled || latest.current !== key || generation !== quoteGeneration.current) return;
        const message = cause instanceof Error ? cause.message : 'Unable to price cart.';
        setFailure({ key, message, issue: getCartItemIssue(cause) });
        if (input.promoCode && isPromoRejectedQuoteError(message)) { setNotice(message); clearRejectedPromo(); }
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(timeout); };
    // The serialized key includes every pricing and account input. Context object identity does not price a cart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, retry]);

  return { quote: current, error, notice, issue: failure?.key === key ? failure.issue : null,
    loading: ready && input.items.length > 0 && !current && !error,
    requestSelection: request,
    acceptSelection: (quote: CartQuoteResponse, selection: PromoSelection) => {
      quoteGeneration.current++;
      setPriced({ key: cartQuoteKey({ ...input, ...selection }, customerKey), quote }); setFailure(null); setNotice(null);
    },
    refresh: () => { quoteGeneration.current++; setPriced(null); setFailure(null); setRetry(value => value + 1); },
  };
}
