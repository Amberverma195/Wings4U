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
  /** Identifies which navigation refresh produced the current menu. */
  loadedReloadKey: string | null | undefined;
};

export function useMenu(
  fulfillmentType: FulfillmentType = "PICKUP",
  locationId?: string,
  scheduledFor?: string | null,
  reloadKey?: string,
): UseMenuResult {
  const id = locationId ?? DEFAULT_LOCATION_ID;
  const context = JSON.stringify([id, fulfillmentType, scheduledFor || null, reloadKey ?? null]);
  const [state, setState] = useState<Omit<UseMenuResult, 'refetch'> & { context: string }>(() => ({
    context, menu: null, loading: true, error: null, loadedReloadKey: null,
  }));
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState(previous => ({ context, menu: previous.context === context ? previous.menu : null,
      loading: true, error: null, loadedReloadKey: previous.context === context ? previous.loadedReloadKey : null }));

    void (async () => {
      try {
        const query = new URLSearchParams({
          location_id: id,
          fulfillment_type: fulfillmentType,
        });
        if (scheduledFor) query.set("scheduled_for", scheduledFor);

        const envelope = await apiJson<MenuResponse>(
          `/api/v1/menu?${query.toString()}`,
          { locationId: id },
        );
        if (!cancelled) {
          if (!envelope.data) throw new Error("Menu response missing data");
          setState({ context, menu: envelope.data, loading: false, error: null, loadedReloadKey: reloadKey });
        }
      } catch (err) {
        if (!cancelled) {
          setState(previous => ({ ...previous, loading: false, error: err instanceof Error ? err.message : String(err) }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, fulfillmentType, scheduledFor, reloadKey, nonce, context, refetch]);

  // Hide incompatible data during render, before the new request effect runs.
  return state.context === context ? { ...state, refetch } : {
    menu: null, loading: true, error: null, refetch, loadedReloadKey: null,
  };
}
