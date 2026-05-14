/**
 * useOrderDetail - fetch a single order's full detail.
 *
 * Mirrors the web app's order-detail pattern:
 *   const { data } = await apiJson<OrderDetail>(`/api/v1/orders/${orderId}`);
 */
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../lib/api";
import type { OrderDetail } from "../lib/types";

export type UseOrderDetailResult = {
  order: OrderDetail | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useOrderDetail(orderId: string | null): UseOrderDetailResult {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const envelope = await apiJson<OrderDetail>(
          `/api/v1/orders/${orderId}`
        );
        if (!cancelled && envelope.data) {
          setOrder(envelope.data);
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
  }, [orderId, nonce]);

  return { order, loading, error, refetch };
}
