/**
 * useMenu - fetch the menu + location info for a given location.
 *
 * Mirrors the web app's menu-fetching pattern:
 *   GET /api/v1/menu?location_id=...&fulfillment_type=...
 *   with header X-Location-Id=...
 *
 * This hook wraps that call in a standard useState/useEffect pattern so any
 * mobile screen can consume menu data exactly as the web components do.
 */
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../lib/api";
import type { FulfillmentType, MenuResponse } from "../lib/types";
import { DEFAULT_LOCATION_ID } from "../lib/env";

export type UseMenuResult = {
  menu: MenuResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useMenu(
  fulfillmentType: FulfillmentType = "PICKUP",
  locationId?: string,
): UseMenuResult {
  const id = locationId ?? DEFAULT_LOCATION_ID;
  const [menu, setMenu] = useState<MenuResponse | null>(null);
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
        const query = new URLSearchParams({
          location_id: id,
          fulfillment_type: fulfillmentType,
        });

        const envelope = await apiJson<MenuResponse>(
          `/api/v1/menu?${query.toString()}`,
          { locationId: id },
        );
        if (!cancelled && envelope.data) {
          setMenu(envelope.data);
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
  }, [id, fulfillmentType, nonce]);

  return { menu, loading, error, refetch };
}
