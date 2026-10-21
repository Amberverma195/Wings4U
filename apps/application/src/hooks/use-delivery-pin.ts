import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { useSession, withSilentRefresh } from '../context/session';
import { apiFetch } from '../lib/api';
import { getSessionGeneration } from '../lib/token-store';
import type { OrderDetail } from '../lib/types';

/** Same best-effort PIN endpoint/visibility as the website, isolated by login/order. */
export function useDeliveryPin(order: OrderDetail): string | null {
  const session = useSession();
  const focused = useIsFocused();
  const generation = getSessionGeneration();
  const identity = JSON.stringify([order.id, order.location_id, session.user?.id, generation]);
  const eligible = focused && session.loaded && session.authenticated && session.user?.id === order.customer_user_id &&
    order.fulfillment_type === 'DELIVERY' && order.status === 'OUT_FOR_DELIVERY';
  const latest = useRef({ identity, eligible }); latest.current = { identity, eligible };
  const [state, setState] = useState<{ identity: string; pin: string | null } | null>(null);
  useEffect(() => {
    if (!eligible) { setState(null); return; }
    let disposed = false;
    const current = () => !disposed && latest.current.identity === identity && latest.current.eligible && generation === getSessionGeneration();
    void (async () => {
      try {
        const response = await withSilentRefresh(() => {
          if (!current()) throw new Error('Your session or order changed.');
          return apiFetch(`/api/v1/orders/${order.id}/delivery-pin`, { locationId: order.location_id, expectedSessionGeneration: generation });
        }, session.refresh, session.clear);
        if (!response.ok) return;
        const body = await response.json();
        if (current()) setState({ identity, pin: typeof body?.data?.pin === 'string' ? body.data.pin : null });
      } catch { /* Website also treats an unavailable PIN as non-fatal. */ }
    })();
    return () => { disposed = true; };
  }, [identity, eligible, order, session.refresh, session.clear, generation]);
  return eligible && state?.identity === identity ? state.pin : null;
}
