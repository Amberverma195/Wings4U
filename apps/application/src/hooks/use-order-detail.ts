/**
 * useOrderDetail - fetch a single order's full detail.
 *
 * Keeps live refetches visible while isolating responses by order and session.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch, describeApiFailure } from "../lib/api";
import { useSession, withSilentRefresh } from "../context/session";
import { getSessionGeneration } from "../lib/token-store";
import { DEFAULT_LOCATION_ID } from "../lib/env";
import type { OrderDetail } from "../lib/types";

export type UseOrderDetailResult = {
  order: OrderDetail | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useOrderDetail(orderId: string | null): UseOrderDetailResult {
  const session = useSession();
  const generation = getSessionGeneration();
  const identity = JSON.stringify([orderId, session.authenticated ? session.user?.id : null, generation]);
  const [dataIdentity, setDataIdentity] = useState(identity);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!orderId || !session.loaded || !session.authenticated || !session.user) {
      setOrder(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const current = () => !cancelled && generation === getSessionGeneration();
    setOrder(previous => dataIdentity === identity ? previous : null);
    setDataIdentity(identity);
    setLoading(true);
    setError(previous => dataIdentity === identity ? previous : null);

    void (async () => {
      try {
        const response = await withSilentRefresh(() => {
          if (!current()) throw new Error('Your session or order changed.');
          return apiFetch(`/api/v1/orders/${orderId}`, { locationId: DEFAULT_LOCATION_ID, expectedSessionGeneration: generation });
        }, session.refresh, session.clear);
        if (!current()) return;
        // An access/not-found response revokes cached data even if its body is
        // not JSON. Timeouts and rate limiting remain retryable refresh errors.
        if (!response.ok && response.status >= 400 && response.status < 500 &&
            response.status !== 408 && response.status !== 429) setOrder(null);
        const envelope = await response.json().catch(() => null) as { data?: OrderDetail | null } | null;
        if (!response.ok) throw new Error(describeApiFailure(response.status, envelope, 'Unable to load order.'));
        if (!envelope) throw new Error(`Order response was not valid JSON (HTTP ${response.status}).`);
        if (envelope.data && envelope.data.customer_user_id !== session.user?.id) {
          if (current()) setOrder(null);
          throw new Error('You do not have access to this order');
        }
        if (current()) {
          setOrder(envelope.data ?? null);
          setError(null);
        }
      } catch (err) {
        if (current()) {
          // React Native's fetch rejects with a TypeError when no response arrives.
          setError(err instanceof TypeError
            ? `Couldn't reach the server (${err.message}).`
            : err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (current()) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identity, nonce, session.loaded, session.authenticated, session.refresh, session.clear]);

  const visible = dataIdentity === identity && session.loaded && session.authenticated;
  return { order: visible ? order : null, loading: visible ? loading : Boolean(orderId && session.authenticated), error: visible ? error : null, refetch };
}
