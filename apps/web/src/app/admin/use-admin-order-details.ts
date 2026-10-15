"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { OrderDetail } from "@/lib/types";
import { adminApiFetch } from "./admin-api";

type DetailState = {
  id: string | null;
  order: OrderDetail | null;
  loading: boolean;
  error: string | null;
};
const EMPTY: DetailState = { id: null, order: null, loading: false, error: null };

/** Shared authenticated, location-scoped detail loading for both admin surfaces. */
export function useAdminOrderDetails(orderId: string | null) {
  const { refresh: refreshSession, clear } = useSession();
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<DetailState>(EMPTY);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  const cancel = useCallback(() => {
    request.current?.abort();
    setState(EMPTY);
  }, []);

  useEffect(() => {
    if (orderId === null) {
      setState(EMPTY);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    setState(previous => ({ id: orderId, loading: true, error: null,
      order: previous.id === orderId ? previous.order : null }));

    void (async () => {
      try {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
          throw new Error("Invalid order link. Please select the order again.");
        }
        const res = await withSilentRefresh(
          () => adminApiFetch(`/api/v1/orders/${encodeURIComponent(orderId)}`, { signal }),
          refreshSession,
          clear,
        );
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            res.status === 401 ? "Your session has expired. Please sign in again."
              : res.status === 403 ? "You do not have access to this order for the current restaurant."
                : res.status === 404 ? "This order could not be found or is not available for this restaurant."
                  : json?.errors?.[0]?.message ?? `Unable to load order details (${res.status}).`,
          );
        }
        if (typeof json?.data?.id !== "string" || json.data.id.toLowerCase() !== orderId.toLowerCase()) {
          throw new Error("Order details are unavailable. Please try again.");
        }
        if (!signal.aborted) setState({ id: orderId, order: json.data as OrderDetail, loading: false, error: null });
      } catch (error) {
        if (!signal.aborted) setState({ id: orderId, order: null, loading: false,
          error: error instanceof Error ? error.message : "Unable to load order details. Please try again." });
      }
    })();

    return () => {
      controller.abort();
      if (request.current === controller) request.current = null;
    };
  }, [orderId, version, refreshSession, clear]);

  return {
    order: state.id === orderId ? state.order : null,
    loadingId: state.id === orderId && state.loading ? orderId : null,
    error: state.id === orderId ? state.error : null,
    cancel,
    refresh,
  };
}
