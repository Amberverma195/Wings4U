"use client";

import { useRef, useState, type CSSProperties } from "react";
import { formatCents, formatDateTime } from "../admin-api";
import { useAdminDialog } from "../use-admin-dialog";
import { useAdminCustomer } from "./use-admin-customer";

const sectionStyle: CSSProperties = { borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "1rem" };
const rowStyle: CSSProperties = { borderTop: "1px solid var(--border)", padding: "0.75rem 0" };
const linkStyle: CSSProperties = { font: "inherit", fontWeight: 600, color: "var(--accent-strong)",
  padding: 0, border: 0, background: "transparent", cursor: "pointer", textAlign: "left" };

export function AdminCustomerModal({ customerId, onClose, onOpenOrder, suspended, returnFocusTo, orderLoading, orderError, onDismissOrder }: {
  customerId: string;
  onClose: () => void;
  onOpenOrder: (id: string, trigger: HTMLButtonElement) => void;
  suspended: boolean;
  returnFocusTo: HTMLElement | null;
  orderLoading: boolean;
  orderError: string | null;
  onDismissOrder: () => void;
}) {
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  const { profile, orders, stamps } = useAdminCustomer(customerId, ordersExpanded);
  const dialogRef = useRef<HTMLDivElement>(null);
  const orderFocus = useRef<HTMLButtonElement | null>(null);
  const lastOrder = useRef<string | null>(null);
  useAdminDialog({ dialogRef, initialFocusRef: orderFocus,
    onClose, returnFocusTo, active: !suspended });
  const openOrder = (id: string, trigger: HTMLButtonElement, focusKey: string) => {
    lastOrder.current = focusKey;
    orderFocus.current = trigger;
    onOpenOrder(id, trigger);
  };
  const customer = profile.data;
  const name = customer?.display_name?.trim() || [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || "Customer profile";
  if (suspended) return null; // Keep data/expansion mounted, with no second active dialog or focus trap.

  return <div role="presentation" onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="admin-customer-title" tabIndex={-1}
      onMouseDown={event => event.stopPropagation()} style={{ width: "min(920px, 96vw)", maxHeight: "90dvh",
        display: "flex", flexDirection: "column", background: "white", color: "#17120d", borderRadius: 24, padding: "1.5rem" }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" }}>
        <div>
          <h2 id="admin-customer-title" style={{ margin: "0 0 0.35rem" }}>{name}</h2>
          {customer && <>
            <p style={{ margin: 0 }}>{customer.primary_phone ?? "No phone number."}</p>
            <p style={{ margin: "0.25rem 0" }}>{customer.primary_email ?? "No email address."}</p>
            <p className="surface-muted" style={{ margin: 0 }}>Account created <ExactTime value={customer.created_at} /></p>
          </>}
        </div>
        <button ref={element => { if (!lastOrder.current) orderFocus.current = element; }}
          type="button" className="btn-secondary" onClick={onClose}>Close customer</button>
      </header>
      <div style={{ overflowY: "auto", minHeight: 0 }}>
        {profile.loading && <p role="status">Loading customer profile...</p>}
        <ResourceError error={profile.error} retry={profile.retry} />
        {customer && <>
          <section style={sectionStyle}>
            <h3>Addresses</h3>
            {customer.saved_addresses.length === 0 ? <p className="surface-muted">No saved addresses.</p> :
              customer.saved_addresses.map(address => <address key={address.id} style={{ ...rowStyle, fontStyle: "normal" }}>
                {address.label && <strong>{address.label} </strong>}{address.is_default && <strong>(Default)</strong>}
                <div>{address.line1}</div><div>{address.city} {address.postal_code}</div>
              </address>)}
          </section>
          <section style={sectionStyle}>
            <h3><button type="button" style={linkStyle} aria-expanded={ordersExpanded} aria-controls="admin-customer-orders"
              onClick={() => setOrdersExpanded(expanded => !expanded)}>Order History {ordersExpanded ? "−" : "+"}</button></h3>
            <div id="admin-customer-orders" hidden={!ordersExpanded}>
              {orders.loading && <p role="status">Loading order history...</p>}
              <ResourceError error={orders.error} retry={orders.retry} />
              {orders.data?.orders.length === 0 && <p className="surface-muted">No orders at this restaurant.</p>}
              {orders.data?.orders.map(order => <div key={order.id} style={rowStyle}>
                <button type="button" style={linkStyle} aria-haspopup="dialog" aria-label={`View order #${order.order_number}`}
                  ref={element => { if (lastOrder.current === `order:${order.id}`) orderFocus.current = element; }}
                  onClick={event => openOrder(order.id, event.currentTarget, `order:${order.id}`)}>Order #{order.order_number}</button>
                <p style={{ margin: "0.3rem 0" }}><ExactTime value={order.placed_at} /> · {order.status} · {order.fulfillment_type}</p>
                <strong>{formatCents(order.final_payable_cents)}</strong>
              </div>)}
              {orders.data?.next_cursor && <button type="button" className="btn-secondary" disabled={orders.loading}
                onClick={() => void orders.loadMore(orders.data!.next_cursor!)}>Load more orders</button>}
            </div>
          </section>
          <section style={sectionStyle}>
            <h3>Wings Rewards</h3>
            <p className="surface-muted">Balances and stamp history apply to the customer&apos;s whole account.</p>
            {stamps.loading && !stamps.data && <p role="status">Loading Wings rewards...</p>}
            <ResourceError error={stamps.error} retry={stamps.retry} />
            {stamps.data && <>
              <p><strong>{stamps.data.summary.available_stamps} / {stamps.data.summary.stamps_per_reward}</strong> available stamps</p>
              <progress aria-label="Wings stamp progress" value={Math.min(stamps.data.summary.available_stamps, stamps.data.summary.stamps_per_reward)}
                max={stamps.data.summary.stamps_per_reward} style={{ width: "100%", accentColor: "#FF4D4D" }} />
              <p>Lifetime stamps earned: {stamps.data.summary.lifetime_stamps}</p>
              <p>Lifetime rewards redeemed: {stamps.data.summary.lifetime_redemptions}</p>
              <p>{stamps.data.summary.reward_available ? "Free 1lb Wings reward available." : "Free 1lb Wings reward not yet available."}</p>
              <h3>Stamp History</h3>
              {stamps.data.entries.length === 0 && <p className="surface-muted">No stamp history yet.</p>}
              {stamps.data.entries.map(entry => <div key={entry.id} style={rowStyle}>
                <strong>{entry.entry_type} · {entry.delta_stamps >= 0 ? "+" : ""}{entry.delta_stamps} stamps</strong>
                <p style={{ margin: "0.3rem 0" }}><ExactTime value={entry.created_at} /></p>
                <p>{entry.reason_text}</p>
                <p>Balance after event: {entry.balance_after_stamps}</p>
                {entry.pounds_awarded !== null && <p>Pounds awarded: {entry.pounds_awarded}</p>}
                {entry.order_accessible && entry.order_id && <button type="button" style={linkStyle} aria-haspopup="dialog"
                  ref={element => { if (lastOrder.current === `stamp:${entry.id}`) orderFocus.current = element; }}
                  onClick={event => openOrder(entry.order_id!, event.currentTarget, `stamp:${entry.id}`)}>Order #{entry.order_number}</button>}
              </div>)}
              {stamps.loading && <p role="status">Loading stamp history...</p>}
              {stamps.data.next_cursor && <button type="button" className="btn-secondary" disabled={stamps.loading}
                onClick={() => void stamps.loadMore(stamps.data!.next_cursor!)}>Load more history</button>}
            </>}
          </section>
        </>}
        {orderLoading && <p role="status">Loading order details...</p>}
        {orderError && <div role="alert"><p className="surface-error">{orderError}</p>
          <button type="button" className="btn-secondary" onClick={onDismissOrder}>Dismiss order error</button></div>}
      </div>
    </div>
  </div>;
}

function ExactTime({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{formatDateTime(value)}</time>;
}
function ResourceError({ error, retry }: { error: string | null; retry: () => Promise<void> }) {
  return error ? <div role="alert"><p className="surface-error">{error}</p>
    <button type="button" className="btn-secondary" onClick={() => void retry()}>Retry</button></div> : null;
}
