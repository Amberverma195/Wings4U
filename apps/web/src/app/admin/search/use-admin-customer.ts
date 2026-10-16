"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminCustomerDetail, AdminCustomerOrdersPage, AdminCustomerStampsPage } from "../../../../../api/src/modules/admin/admin-customers.dto";
import { useSession, withSilentRefresh } from "@/lib/session";
import { adminApiFetch } from "../admin-api";

/** Each resource has its own cursor, request, retry and cancellation state. */
function useCustomerResource<T>(path: string, enabled: boolean, merge?: (previous: T, next: T) => T) {
  const { refresh, clear } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor?: string | null) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const url = cursor ? `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : path;
      const res = await withSilentRefresh(() => adminApiFetch(url, { signal: controller.signal }), refresh, clear);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(res.status === 401 ? "Your session has expired. Please sign in again."
        : body?.errors?.[0]?.message ?? `Unable to load customer information (${res.status}).`);
      if (!body?.data) throw new Error("Customer information is unavailable. Please try again.");
      if (controller.signal.aborted) return;
      const next = body.data as T;
      setData(previous => cursor && previous && merge ? merge(previous, next) : next);
      loaded.current = true;
    } catch (error) {
      if (!controller.signal.aborted) {
        // Do not leave personal data visible after a denied or failed reload.
        if (!cursor) setData(null);
        setError(error instanceof Error ? error.message : "Unable to load customer information.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (request.current === controller) request.current = null;
    }
  }, [path, refresh, clear, merge]);

  useEffect(() => {
    if (enabled && !loaded.current) void load();
  }, [enabled, load]);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, [path]);
  return { data, loading, error, retry: () => load(), loadMore: (cursor: string) => load(cursor) };
}

const appendOrders = (previous: AdminCustomerOrdersPage, next: AdminCustomerOrdersPage): AdminCustomerOrdersPage => ({
  ...next, orders: [...new Map([...previous.orders, ...next.orders].map(order => [order.id, order])).values()],
});
const appendStamps = (previous: AdminCustomerStampsPage, next: AdminCustomerStampsPage): AdminCustomerStampsPage => ({
  ...next, entries: [...new Map([...previous.entries, ...next.entries].map(entry => [entry.id, entry])).values()],
});

export function useAdminCustomer(customerId: string, ordersExpanded: boolean) {
  const base = `/api/v1/admin/customers/${encodeURIComponent(customerId)}`;
  const profile = useCustomerResource<AdminCustomerDetail>(base, true);
  const orders = useCustomerResource<AdminCustomerOrdersPage>(`${base}/orders?limit=20`, ordersExpanded, appendOrders);
  const stamps = useCustomerResource<AdminCustomerStampsPage>(`${base}/stamps?limit=20`, true, appendStamps);
  return { profile, orders, stamps };
}
