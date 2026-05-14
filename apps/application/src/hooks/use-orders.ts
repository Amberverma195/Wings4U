/**
 * useOrders - fetch order history for the authenticated user.
 *
 * Mirrors the web app's order-listing pattern:
 *   const { data } = await apiJson<{ orders: OrderSummary[] }>(`/api/v1/orders/me`);
 */
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../lib/api";
import type { OrderSummary } from "../lib/types";

export type UseOrdersResult = {
  orders: OrderSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useOrders(): UseOrdersResult {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const envelope = await apiJson<{ orders: OrderSummary[] }>(
          "/api/v1/orders/me"
        );
        if (!cancelled && envelope.data) {
          setOrders(envelope.data.orders);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { orders, loading, error, refetch };
}
