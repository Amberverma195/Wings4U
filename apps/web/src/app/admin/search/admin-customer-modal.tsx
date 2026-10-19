"use client";

import { useRef, useState } from "react";
import { formatCents, formatDateTime } from "../admin-api";
import { useAdminDialog } from "../use-admin-dialog";
import { useAdminCustomer } from "./use-admin-customer";
import { AdminStampGrantDialog } from "./admin-stamp-grant-dialog";
import type { AdminStampGrantResult } from "../../../../../api/src/modules/admin/admin-customers.dto";

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
  const [stampsExpanded, setStampsExpanded] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantResult, setGrantResult] = useState<AdminStampGrantResult | null>(null);
  const { profile, orders, stamps, applyGrant, refreshStamps } = useAdminCustomer(customerId, ordersExpanded);
  const dialogRef = useRef<HTMLDivElement>(null);
  const orderFocus = useRef<HTMLButtonElement | null>(null);
  const lastOrder = useRef<string | null>(null);
  useAdminDialog({ dialogRef, initialFocusRef: orderFocus,
    onClose, returnFocusTo, active: !suspended && !grantOpen });
  const openOrder = (id: string, trigger: HTMLButtonElement, focusKey: string) => {
    lastOrder.current = focusKey;
    orderFocus.current = trigger;
    onOpenOrder(id, trigger);
  };
  const customer = profile.data;
  const name = customer?.display_name?.trim() || [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || "Customer profile";
  const summary = stamps.data?.summary;
  const fullCard = !!summary && summary.available_stamps >= summary.stamps_per_reward;
  const grantDisabled = stamps.loading || !summary || fullCard || orderLoading;

  return <>
    <AdminStampGrantDialog open={grantOpen && !suspended} customerId={customerId} name={name}
      balance={summary?.available_stamps ?? 0} threshold={summary?.stamps_per_reward ?? 0}
      onClose={() => setGrantOpen(false)} onRefresh={refreshStamps}
      onSuccess={grant => { setGrantResult(grant); applyGrant(grant); setGrantOpen(false); }} />
    {!suspended && !grantOpen && <div role="presentation" onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="admin-customer-title" tabIndex={-1}
      className="admin-customer-modal" onMouseDown={event => event.stopPropagation()}>
      <header className="admin-customer-header">
        <div>
          <p className="admin-customer-eyebrow">Customer profile</p>
          <h2 id="admin-customer-title">{name}</h2>
          {customer && <>
            <p><strong>Phone: </strong>{customer.primary_phone ?? "No phone number."}</p>
            <p><strong>Email: </strong>{customer.primary_email ?? "No email address."}</p>
            <p className="admin-customer-account-info">Account created <ExactTime value={customer.created_at} /></p>
            <p className="admin-customer-account-info">Total orders: <strong>{customer.total_order_count}</strong> <span>(this restaurant)</span></p>
          </>}
        </div>
        <button ref={element => { if (!lastOrder.current || (lastOrder.current === "grant" && grantDisabled)) orderFocus.current = element; }}
          type="button" className="btn-secondary" onClick={onClose}>Close customer</button>
      </header>
      <div className="admin-customer-body">
        {profile.loading && <p role="status">Loading customer profile...</p>}
        <ResourceError error={profile.error} retry={profile.retry} />
        {customer && <>
          <section className="admin-customer-section">
            <h3>Addresses</h3>
            {customer.saved_addresses.length === 0 ? <p className="surface-muted">No saved addresses.</p> :
              customer.saved_addresses.map(address => <address key={address.id} className="admin-customer-history-row">
                {address.label && <strong>{address.label} </strong>}{address.is_default && <strong className="admin-customer-badge">(Default)</strong>}
                <div>{address.line1}</div><div>{address.city} {address.postal_code}</div>
              </address>)}
          </section>
          <section className="admin-customer-section">
            <h3><button type="button" className="admin-customer-disclosure" aria-expanded={ordersExpanded} aria-controls="admin-customer-orders"
              onClick={() => setOrdersExpanded(expanded => !expanded)}>Order History <span aria-hidden="true">{ordersExpanded ? "−" : "+"}</span></button></h3>
            <div id="admin-customer-orders" hidden={!ordersExpanded}>
              {orders.loading && <p role="status">Loading order history...</p>}
              <ResourceError error={orders.error} retry={orders.retry} />
              {orders.data?.orders.length === 0 && <p className="surface-muted">No orders at this restaurant.</p>}
              {orders.data?.orders.map(order => <div key={order.id} className="admin-customer-history-row">
                <button type="button" className="admin-customer-link" aria-haspopup="dialog" aria-label={`View order #${order.order_number}`}
                  ref={element => { if (lastOrder.current === `order:${order.id}`) orderFocus.current = element; }}
                  onClick={event => openOrder(order.id, event.currentTarget, `order:${order.id}`)}>Order #{order.order_number}</button>
                <p className="surface-muted"><ExactTime value={order.placed_at} /> · {order.status} · {order.fulfillment_type}</p>
                <strong className="admin-customer-total">{formatCents(order.final_payable_cents)}</strong>
              </div>)}
              {orders.data?.next_cursor && <button type="button" className="btn-secondary" disabled={orders.loading}
                onClick={() => void orders.loadMore(orders.data!.next_cursor!)}>Load more orders</button>}
            </div>
          </section>
          <section className="admin-customer-section">
            <div className="admin-customer-heading-row"><h3>Wings Rewards</h3>
              <span title={fullCard ? "Stamp card is full. Customer must redeem their reward first." : undefined}>
                <button type="button" className="btn-secondary" aria-haspopup="dialog"
                  disabled={grantDisabled}
                  ref={element => { if (lastOrder.current === "grant" && !grantDisabled) orderFocus.current = element; }}
                  onClick={() => { lastOrder.current = "grant"; setGrantOpen(true); }}>Give Stamps</button>
              </span>
            </div>
            <p className="surface-muted">Balances and stamp history apply to the customer&apos;s whole account.</p>
            {grantResult && <div role="status" className="admin-customer-grant-result">
              <p><strong>{grantResult.stamps_granted} {grantResult.stamps_granted === 1 ? "stamp" : "stamps"} added to {name}&apos;s account.</strong></p>
              {grantResult.email.status === "SENT" && <p>The customer has been notified via email.</p>}
            </div>}
            {grantResult && grantResult.email.status !== "SENT" && <p role="status" className="surface-muted">
              Email notification: {grantResult.email.status.toLowerCase()}. Provider acceptance has not been confirmed.
            </p>}
            {stamps.loading && !stamps.data && <p role="status">Loading Wings rewards...</p>}
            <ResourceError error={stamps.error} retry={stamps.retry} />
            {stamps.data && <>
              <p className="admin-customer-stamp-balance"><strong>{stamps.data.summary.available_stamps} / {stamps.data.summary.stamps_per_reward}</strong> available stamps</p>
              <progress aria-label="Wings stamp progress" value={Math.min(stamps.data.summary.available_stamps, stamps.data.summary.stamps_per_reward)}
                max={stamps.data.summary.stamps_per_reward} />
              <div className="admin-customer-stats">
                <p>Lifetime stamps earned: <strong>{stamps.data.summary.lifetime_stamps}</strong></p>
                <p>Lifetime rewards redeemed: <strong>{stamps.data.summary.lifetime_redemptions}</strong></p>
              </div>
              <p className={`admin-customer-reward ${stamps.data.summary.reward_available ? "admin-customer-reward--available" : ""}`}>
                {stamps.data.summary.reward_available ? "Free 1lb Wings reward available." : "Free 1lb Wings reward not yet available."}</p>
              <h3><button type="button" className="admin-customer-disclosure" aria-expanded={stampsExpanded} aria-controls="admin-customer-stamps"
                onClick={() => setStampsExpanded(expanded => !expanded)}>Stamp History <span aria-hidden="true">{stampsExpanded ? "−" : "+"}</span></button></h3>
              <div id="admin-customer-stamps" hidden={!stampsExpanded}>
              {stamps.data.entries.length === 0 && <p className="surface-muted">No stamp history yet.</p>}
              {stamps.data.entries.map(entry => <div key={entry.id} className="admin-customer-history-row">
                <strong className={`admin-customer-badge admin-customer-badge--${entry.delta_stamps > 0 ? "positive" : entry.delta_stamps < 0 ? "negative" : "neutral"}`}>
                  {entry.entry_type === "ADMIN_GRANTED" ? "Gifted by Wings 4 U" : entry.entry_type} · {entry.delta_stamps >= 0 ? "+" : ""}{entry.delta_stamps} stamps</strong>
                <p className="surface-muted"><ExactTime value={entry.created_at} /></p>
                <p>{entry.reason_text}</p>
                <p>Balance after event: <strong>{entry.balance_after_stamps}</strong></p>
                {entry.pounds_awarded !== null && <p>Pounds awarded: <strong>{entry.pounds_awarded}</strong></p>}
                {entry.order_accessible && entry.order_id && <button type="button" className="admin-customer-link" aria-haspopup="dialog"
                  ref={element => { if (lastOrder.current === `stamp:${entry.id}`) orderFocus.current = element; }}
                  onClick={event => openOrder(entry.order_id!, event.currentTarget, `stamp:${entry.id}`)}>Order #{entry.order_number}</button>}
              </div>)}
              {stamps.loading && <p role="status">Loading stamp history...</p>}
              {stamps.data.next_cursor && <button type="button" className="btn-secondary" disabled={stamps.loading}
                onClick={() => void stamps.loadMore(stamps.data!.next_cursor!)}>Load more history</button>}
              </div>
            </>}
          </section>
        </>}
        {orderLoading && <p role="status">Loading order details...</p>}
        {orderError && <div role="alert"><p className="surface-error">{orderError}</p>
          <button type="button" className="btn-secondary" onClick={onDismissOrder}>Dismiss order error</button></div>}
      </div>
    </div>
  </div>}
  </>;
}

function ExactTime({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{formatDateTime(value)}</time>;
}
function ResourceError({ error, retry }: { error: string | null; retry: () => Promise<void> }) {
  return error ? <div role="alert"><p className="surface-error">{error}</p>
    <button type="button" className="btn-secondary" onClick={() => void retry()}>Retry</button></div> : null;
}
