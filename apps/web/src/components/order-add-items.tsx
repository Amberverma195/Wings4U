"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";
import { cents } from "@/lib/format";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { MenuItem, MenuResponse } from "@/lib/types";

type ChangeRequestRecord = {
  id: string;
  order_id: string;
  type: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requested_items_json: Array<{
    menu_item_id: string;
    quantity: number;
    modifier_option_ids: string[];
    special_instructions: string | null;
  }>;
  rejection_reason: string | null;
  created_at: string;
};

const ADD_WINDOW_MS = 3 * 60 * 1000;

function remainingMs(placedAtIso: string): number {
  return Math.max(0, placedAtIso ? new Date(placedAtIso).getTime() + ADD_WINDOW_MS - Date.now() : 0);
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function OrderAddItems({
  orderId,
  locationId,
  placedAt,
  fulfillmentType,
  orderStatus,
}: {
  orderId: string;
  locationId: string;
  placedAt: string;
  fulfillmentType: "PICKUP" | "DELIVERY";
  orderStatus: string;
}) {
  const session = useSession();
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qtyByItem, setQtyByItem] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<ChangeRequestRecord[]>([]);
  const [tick, setTick] = useState(0);

  // Server is the source of truth for the payment-method matrix. The UI
  // just gates on the 3-min window and the broadest possible status set.
  const statusAllows = ["PLACED", "ACCEPTED", "PREPARING"].includes(orderStatus);

  const remaining = remainingMs(placedAt);
  const withinWindow = remaining > 0;
  const eligible = withinWindow && statusAllows;

  // Live countdown tick
  useEffect(() => {
    if (!withinWindow) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [withinWindow]);

  // Keep tick used so the re-render occurs
  useMemo(() => tick, [tick]);

  const loadRequests = useCallback(async () => {
    try {
      const res = await withSilentRefresh(
        () => apiFetch(`/api/v1/orders/${orderId}/changes`, { locationId }),
        session.refresh,
        session.clear,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { data?: ChangeRequestRecord[] };
      setRequests(body.data ?? []);
    } catch {
      // non-fatal
    }
  }, [orderId, locationId, session]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const loadMenu = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const env = await apiJson<MenuResponse>(
        `/api/v1/menu?location_id=${locationId}&fulfillment_type=${fulfillmentType}`,
        { locationId },
      );
      if (!env.data) {
        setError("Menu unavailable");
        return;
      }
      // Only simple items in add-items v1: no builders (wings/combos/lunch).
      const flat = env.data.categories.flatMap((c) =>
        c.items.filter(
          (it) => it.is_available && !it.builder_type && !it.requires_special_instructions,
        ),
      );
      setMenu(flat);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load menu");
    } finally {
      setLoading(false);
    }
  }, [locationId, fulfillmentType]);

  const handleToggle = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next && !menu) void loadMenu();
  }, [expanded, menu, loadMenu]);

  const totalSelected = Object.values(qtyByItem).reduce((sum, n) => sum + n, 0);

  const handleSubmit = useCallback(async () => {
    const items = Object.entries(qtyByItem)
      .filter(([, qty]) => qty > 0)
      .map(([menu_item_id, qty]) => ({ menu_item_id, quantity: qty }));
    if (items.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          apiFetch(`/api/v1/orders/${orderId}/changes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items }),
            locationId,
          }),
        session.refresh,
        session.clear,
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.errors?.[0]?.message ?? `Add failed (${res.status})`);
      }
      setQtyByItem({});
      setExpanded(false);
      await loadRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add items");
    } finally {
      setSubmitting(false);
    }
  }, [qtyByItem, orderId, locationId, session, loadRequests]);

  const pendingOrRejected = requests.filter(
    (r) => r.status === "PENDING" || r.status === "REJECTED",
  );

  return (
    <section className="surface-card" style={{ marginTop: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Add more items</h3>
          {eligible ? (
            <p className="surface-muted" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
              You have {formatCountdown(remaining)} to add items to this order.
            </p>
          ) : (
            <p className="surface-muted" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
              {withinWindow
                ? "This order has moved too far along to add items."
                : "The 3-minute window to add items has ended."}
            </p>
          )}
        </div>
        {eligible && (
          <button
            type="button"
            className={expanded ? "btn-secondary" : "btn-primary"}
            onClick={handleToggle}
          >
            {expanded ? "Close" : "Add items"}
          </button>
        )}
      </div>

      {expanded && eligible && (
        <div style={{ marginTop: "1rem" }}>
          {loading && <p className="surface-muted">Loading menu…</p>}
          {error && <p className="surface-error">{error}</p>}
          {menu && menu.length === 0 && (
            <p className="surface-muted">No simple items are available for add-on right now.</p>
          )}
          {menu && menu.length > 0 && (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {menu.map((item) => {
                const qty = qtyByItem[item.id] ?? 0;
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.5rem 0.75rem",
                      border: "1px solid #eee",
                      borderRadius: "0.5rem",
                    }}
                  >
                    <div>
                      <p style={{ margin: 0, fontWeight: 600 }}>{item.name}</p>
                      <p className="surface-muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                        {cents(item.base_price_cents)}
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ minWidth: "2rem", padding: "0.25rem 0.5rem" }}
                        disabled={qty <= 0}
                        onClick={() =>
                          setQtyByItem((prev) => ({
                            ...prev,
                            [item.id]: Math.max(0, (prev[item.id] ?? 0) - 1),
                          }))
                        }
                      >
                        −
                      </button>
                      <span style={{ minWidth: "1.5rem", textAlign: "center" }}>{qty}</span>
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ minWidth: "2rem", padding: "0.25rem 0.5rem" }}
                        onClick={() =>
                          setQtyByItem((prev) => ({
                            ...prev,
                            [item.id]: (prev[item.id] ?? 0) + 1,
                          }))
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn-primary"
              disabled={submitting || totalSelected === 0}
              onClick={handleSubmit}
            >
              {submitting ? "Submitting…" : `Request ${totalSelected} item${totalSelected === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {pendingOrRejected.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          {pendingOrRejected.map((r) => (
            <div
              key={r.id}
              style={{
                padding: "0.5rem 0.75rem",
                marginTop: "0.4rem",
                borderRadius: "0.5rem",
                background:
                  r.status === "PENDING"
                    ? "rgba(245, 158, 11, 0.1)"
                    : "rgba(220, 38, 38, 0.08)",
                border:
                  r.status === "PENDING"
                    ? "1px solid rgba(245, 158, 11, 0.35)"
                    : "1px solid rgba(220, 38, 38, 0.3)",
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem" }}>
                {r.status === "PENDING" ? "Pending approval" : "Rejected"}
              </p>
              <p className="surface-muted" style={{ margin: "0.2rem 0 0", fontSize: "0.8rem" }}>
                {r.requested_items_json.length} item(s) requested at{" "}
                {new Date(r.created_at).toLocaleTimeString()}
              </p>
              {r.status === "REJECTED" && r.rejection_reason && (
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                  Reason: {r.rejection_reason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
