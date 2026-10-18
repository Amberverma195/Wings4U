import { useEffect, useRef } from 'react';
import { useIsFocused } from 'expo-router';
import { useSession, withSilentRefresh } from '../context/session';
import { apiFetch, ApiRequestError, getApiErrorMessage } from '../lib/api';
import { getSessionGeneration } from '../lib/token-store';
import { canUseOrderFeedback } from '../lib/order-feedback';
import type { OrderDetail } from '../lib/types';

/** Each modal mount owns its requests; closing or changing identity invalidates them. */
export function useOrderFeedbackRequest(order: OrderDetail) {
  const session = useSession();
  const focused = useIsFocused();
  const identity = JSON.stringify([order.id, order.location_id, order.customer_user_id, session.user?.id, getSessionGeneration()]);
  const latest = useRef({ identity, eligible: false });
  latest.current = { identity, eligible: focused && canUseOrderFeedback(order, session) };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const scope = () => {
    const generation = getSessionGeneration();
    const current = () => mounted.current && latest.current.identity === identity &&
      latest.current.eligible && generation === getSessionGeneration();
    return {
      current,
      request: async (path: string, init: RequestInit = {}) => {
        const response = await withSilentRefresh(() => {
          if (!current()) throw new Error('Your session or order changed.');
          return apiFetch(path, { ...init, locationId: order.location_id, expectedSessionGeneration: generation });
        }, session.refresh, session.clear);
        const body = await response.json().catch(() => null);
        if (!current()) throw new Error('Your session or order changed.');
        if (!response.ok) throw new ApiRequestError(getApiErrorMessage(body, `Request failed (${response.status}). Please try again.`), body, response.status);
        return body?.data as unknown;
      },
    };
  };
  return scope;
}
