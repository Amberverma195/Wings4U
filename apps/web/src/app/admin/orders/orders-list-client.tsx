"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { adminApiFetch, formatCents, formatDateTime } from "../admin-api";

type OrderSummary = {
  id: string;
  order_number: number;
  status: string;
  fulfillment_type: string;
  placed_at: string;
  final_payable_cents: number;
};

type ListResponse = {
  orders: OrderSummary[];
  next_cursor: string | null;
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "PLACED", label: "Placed" },
  { value: "PREPARING", label: "Preparing" },
  { value: "READY", label: "Ready" },
  { value: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "PICKED_UP", label: "Picked up" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "NO_SHOW_PICKUP", label: "No-show (pickup)" },
  { value: "NO_SHOW_DELIVERY", label: "No-show (delivery)" },
  { value: "NO_PIN_DELIVERY", label: "No-PIN delivery" },
];

export function OrdersListClient() {
  const session = useSession();
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<OrderSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { append: boolean; cursor: string | null; statusFilter: string }) => {
      const isAppend = opts.append;
      if (isAppend) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      try {
        const qs = new URLSearchParams();
        qs.set("limit", "50");
        if (opts.statusFilter) qs.set("status", opts.statusFilter);
        if (isAppend && opts.cursor) qs.set("cursor", opts.cursor);

        const res = await withSilentRefresh(
          () => adminApiFetch(`/api/v1/orders?${qs.toString()}`),
          session.refresh,
          session.clear,
        );
        const json = await res.json();
        if (!res.ok) {
          throw new Error(
            json?.errors?.[0]?.message ?? `Load failed (${res.status})`,
          );
        }
        const data = json.data as ListResponse;
        setItems((prev) =>
          isAppend ? [...prev, ...data.orders] : data.orders,
        );
        setNextCursor(data.next_cursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [session],
  );

  useEffect(() => {
    void load({ append: false, cursor: null, statusFilter: status });
  }, [load, status]);

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>
        <p className="surface-eyebrow" style={{ margin: 0 }}>Operations</p>
        <h1 style={{ margin: "0.2rem 0 0" }}>Orders</h1>
      </section>

      <section
        className="surface-card"
        style={{
          marginBottom: "1rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "center",
        }}
      >
        <label style={{ fontSize: "0.9rem", fontWeight: 600 }}>
          Status{" "}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{
              marginLeft: "0.35rem",
              padding: "0.35rem 0.5rem",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              font: "inherit",
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error && <p className="surface-error">{error}</p>}

      <section className="surface-card" style={{ padding: "1rem" }}>
        {items.length === 0 && !loading ? (
          <p className="surface-muted">No orders match this filter.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.88rem",
              }}
            >
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "0.5rem 0.5rem 0.5rem 0" }}>#</th>
                  <th style={{ padding: "0.5rem" }}>Status</th>
                  <th style={{ padding: "0.5rem" }}>Fulfillment</th>
                  <th style={{ padding: "0.5rem" }}>Placed</th>
                  <th style={{ padding: "0.5rem" }}>Total</th>
                  <th style={{ padding: "0.5rem" }} />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.id}
                    style={{ borderBottom: "1px solid rgba(23,18,13,0.08)" }}
                  >
                    <td style={{ padding: "0.45rem 0.5rem 0.45rem 0", fontWeight: 600 }}>
                      {row.order_number}
                    </td>
                    <td style={{ padding: "0.45rem 0.5rem" }}>{row.status}</td>
                    <td style={{ padding: "0.45rem 0.5rem" }}>
                      {row.fulfillment_type}
                    </td>
                    <td style={{ padding: "0.45rem 0.5rem", whiteSpace: "nowrap" }}>
                      {formatDateTime(row.placed_at)}
                    </td>
                    <td style={{ padding: "0.45rem 0.5rem" }}>
                      {formatCents(row.final_payable_cents)}
                    </td>
                    <td style={{ padding: "0.45rem 0" }}>
                      <Link
                        href={`/orders/${row.id}`}
                        className="surface-muted"
                        style={{ fontWeight: 600, color: "var(--accent-strong)" }}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {loading && items.length === 0 ? (
          <p className="surface-muted">Loading orders…</p>
        ) : null}

        {nextCursor && (
          <div style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={loadingMore}
              onClick={() =>
                void load({
                  append: true,
                  cursor: nextCursor,
                  statusFilter: status,
                })
              }
              style={{ width: "auto" }}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
