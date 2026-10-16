"use client";

import { useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { adminApiFetch, formatCents, formatDateTime } from "../admin-api";
import { readable, type SupportOrder } from "./support-types";
import styles from "./support.module.css";

export function LinkOrder({ ticketId, onLinked }: { ticketId: string; onLinked: () => Promise<void> }) {
  const session = useSession();
  const [orders, setOrders] = useState<SupportOrder[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadOrders = async (next?: string) => {
    setBusy(true); setError(null);
    try {
      const res = await withSilentRefresh(() => adminApiFetch(
        `/api/v1/admin/support-tickets/${ticketId}/eligible-orders${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
      ), session.refresh, session.clear);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.errors?.[0]?.message ?? "Could not load eligible orders");
      setOrders(previous => next ? [...(previous ?? []), ...json.data.orders] : json.data.orders);
      setCursor(json.data.next_cursor);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load orders"); }
    finally { setBusy(false); }
  };
  const link = async () => {
    if (!selected || !confirmed) return;
    setBusy(true); setError(null);
    try {
      const res = await withSilentRefresh(() => adminApiFetch(`/api/v1/admin/support-tickets/${ticketId}/link-order`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: selected }),
      }), session.refresh, session.clear);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.errors?.[0]?.message ?? "Could not link order");
      await onLinked();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not link order"); }
    finally { setBusy(false); }
  };
  return <div className={styles.linkForm}>
    {error && <p className="surface-error" role="alert">{error}</p>}
    {orders === null ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => void loadOrders()}>
      {busy ? "Loading orders..." : "Find an order to link"}
    </button> : <>
      <p className="surface-muted">Only this customer's orders at this restaurant are eligible.</p>
      {orders.length === 0 ? <p>No eligible orders found.</p> : <>
        <label>Choose an order
          <select value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setConfirmed(false); }}>
            <option value="">Select an order</option>
            {orders.map(order => <option key={order.id} value={order.id}>
              #{order.order_number} · {formatDateTime(order.placed_at)} · {readable(order.status)} · {formatCents(order.final_payable_cents)}
            </option>)}
          </select>
        </label>
        {selected && <label><input type="checkbox" checked={confirmed} disabled={busy}
          onChange={e => setConfirmed(e.target.checked)} /> I confirm order #{orders.find(order => order.id === selected)?.order_number} relates to this complaint.</label>}
        <button type="button" className="btn-primary" disabled={busy || !selected || !confirmed} onClick={() => void link()}>
          {busy ? "Linking..." : "Confirm and link order"}
        </button>
      </>}
      {cursor && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void loadOrders(cursor)}>Load more orders</button>}
    </>}
  </div>;
}
