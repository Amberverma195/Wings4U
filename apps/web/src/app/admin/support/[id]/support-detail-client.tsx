"use client";

import { adminApiFetch, formatCents, formatDateTime } from "../../admin-api";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";

type Message = {
  id: string;
  author_user_id: string;
  message_body: string;
  is_internal_note: boolean;
  created_at: string;
};

type Event = {
  id: string;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
};

type Resolution = {
  id: string;
  resolution_type: string;
  refund_request_id: string | null;
  replacement_order_id: string | null;
  credit_amount_cents: number | null;
  note: string | null;
  created_at: string;
};

type TicketDetail = {
  id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  ticket_type: string;
  order_id: string | null;
  customer_user_id: string;
  resolution_type: string | null;
  resolved_by_user_id: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  messages: Message[];
  events: Event[];
  resolutions: Resolution[];
};

type OrderDetails = {
  ticket_id: string;
  customer: { user_id: string; name: string; phone: string; email: string | null };
  order: {
    id: string; order_number: string; status: string; fulfillment_type: string;
    placed_at: string; accepted_at: string | null; ready_at: string | null;
    completed_at: string | null; cancelled_at: string | null;
    payment_status: string; item_subtotal_cents: number; discount_total_cents: number;
    tax_cents: number; delivery_fee_cents: number; driver_tip_cents: number;
    final_payable_cents: number; customer_order_notes: string | null;
    address_snapshot: Record<string, string> | null;
  };
  payments: { id: string; method: string; status: string; amount_cents: number; created_at: string }[];
  items: {
    id: string; product_name: string; category_name: string; quantity: number;
    unit_price_cents: number; line_total_cents: number; special_instructions: string | null;
    modifiers: { name: string; group_name: string; quantity: number; price_delta_cents: number }[];
    flavours: { name: string; heat_level: string; placement: string }[];
  }[];
};

const STATUSES = ["OPEN", "IN_REVIEW", "WAITING_ON_CUSTOMER", "RESOLVED", "CLOSED"];
const RESOLUTION_TYPES = [
  "REFUND_ISSUED",
  "STORE_CREDIT_ISSUED",
  "REPLACEMENT_ORDER",
  "INFO_ONLY",
  "NO_ACTION",
];

export function SupportDetailClient({ ticketId }: { ticketId: string }) {
  const session = useSession();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [sending, setSending] = useState(false);

  const [statusDraft, setStatusDraft] = useState<string>("");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const [resolutionType, setResolutionType] = useState<string>("INFO_ONLY");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [resolving, setResolving] = useState(false);

  const [orderModal, setOrderModal] = useState(false);
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () => adminApiFetch(`/api/v1/support/tickets/${ticketId}`),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Load failed (${res.status})`,
        );
      }
      const t = json.data as TicketDetail;
      setTicket(t);
      setStatusDraft(t.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [ticketId, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendMessage = async () => {
    if (!reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          adminApiFetch(`/api/v1/support/tickets/${ticketId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message_body: reply.trim(),
              is_internal_note: internalNote,
            }),
          }),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Send failed (${res.status})`,
        );
      }
      setReply("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const updateStatus = async () => {
    if (!ticket || statusDraft === ticket.status) return;
    setUpdatingStatus(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          adminApiFetch(`/api/v1/support/tickets/${ticketId}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: statusDraft }),
          }),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Update failed (${res.status})`,
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const submitResolution = async () => {
    if (!resolutionNotes.trim()) {
      setError("Resolution notes are required.");
      return;
    }
    setResolving(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          adminApiFetch(`/api/v1/support/tickets/${ticketId}/resolutions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              resolution_type: resolutionType,
              notes: resolutionNotes.trim(),
            }),
          }),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Resolve failed (${res.status})`,
        );
      }
      setResolutionNotes("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resolve failed");
    } finally {
      setResolving(false);
    }
  };

  if (loading && !ticket) {
    return <p className="surface-muted">Loading ticket…</p>;
  }
  if (!ticket) {
    return (
      <>
        <p className="surface-error">{error ?? "Ticket not found."}</p>
        <Link href="/admin/support">← Back to support queue</Link>
      </>
    );
  }

  const openOrderDetails = async () => {
    setOrderModal(true);
    setOrderLoading(true);
    setOrderError(null);
    try {
      const res = await withSilentRefresh(
        () => adminApiFetch(`/api/v1/admin/support-tickets/${ticketId}/order-details`),
        session.refresh, session.clear,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.errors?.[0]?.message ?? `Failed (${res.status})`);
      setOrderDetails(json.data as OrderDetails);
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setOrderLoading(false);
    }
  };

  return (
    <>
      <Link href="/admin/support">← Back to support queue</Link>

      <section className="surface-card" style={{ marginTop: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
          <div>
            <p className="surface-eyebrow" style={{ margin: 0 }}>
              {ticket.ticket_type} · {ticket.priority}
            </p>
            <h1 style={{ margin: "0.2rem 0 0" }}>{ticket.subject}</h1>
          </div>
          {ticket.order_id && (
            <button
              type="button"
              className="btn-secondary"
              style={{ width: "auto", whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={() => void openOrderDetails()}
            >
              📦 Order Details
            </button>
          )}
        </div>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
          Status <strong>{ticket.status}</strong> · created{" "}
          {formatDateTime(ticket.created_at)}
          {ticket.order_id && (
            <>
              {" "}·{" "}
              <Link href={`/admin/orders/${ticket.order_id}`}>related order</Link>
            </>
          )}
        </p>
        <p style={{ marginTop: "0.75rem" }}>{ticket.description}</p>
      </section>

      {error && <p className="surface-error">{error}</p>}

      <section className="surface-card" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Conversation</h2>
        {ticket.messages.length === 0 ? (
          <p className="surface-muted">No messages yet.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {ticket.messages.map((m) => (
              <li
                key={m.id}
                style={{
                  padding: "0.6rem 0.75rem",
                  borderRadius: "0.5rem",
                  background: m.is_internal_note
                    ? "rgba(245, 158, 11, 0.08)"
                    : "rgba(0,0,0,0.02)",
                  marginBottom: "0.5rem",
                  border: m.is_internal_note
                    ? "1px dashed rgba(245, 158, 11, 0.5)"
                    : "1px solid transparent",
                }}
              >
                <div
                  className="surface-muted"
                  style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }}
                >
                  {m.is_internal_note ? "Internal note · " : ""}
                  {m.author_user_id.slice(0, 8)}… · {formatDateTime(m.created_at)}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.message_body}</div>
              </li>
            ))}
          </ul>
        )}

        <textarea
          rows={3}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Reply or add an internal note"
          style={{
            display: "block",
            width: "100%",
            marginTop: "0.6rem",
            padding: "0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid #d4d4d4",
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
        <div
          style={{
            marginTop: "0.5rem",
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem" }}>
            <input
              type="checkbox"
              checked={internalNote}
              onChange={(e) => setInternalNote(e.target.checked)}
            />
            Internal note (hidden from customer)
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={sending || !reply.trim()}
            onClick={() => void sendMessage()}
            style={{ width: "auto" }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </section>

      <section className="surface-card" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Status</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={statusDraft}
            onChange={(e) => setStatusDraft(e.target.value)}
            style={{
              padding: "0.4rem 0.5rem",
              borderRadius: "0.375rem",
              border: "1px solid #d4d4d4",
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-secondary"
            disabled={updatingStatus || statusDraft === ticket.status}
            onClick={() => void updateStatus()}
            style={{ width: "auto" }}
          >
            {updatingStatus ? "Saving…" : "Update status"}
          </button>
        </div>
      </section>

      <section className="surface-card" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Resolve</h2>
        {ticket.resolutions.length > 0 && (
          <ul style={{ margin: "0 0 0.75rem", paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
            {ticket.resolutions.map((r) => (
              <li key={r.id}>
                <strong>{r.resolution_type}</strong> · {formatDateTime(r.created_at)}
                {r.note && <> — {r.note}</>}
              </li>
            ))}
          </ul>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: "0.5rem",
            alignItems: "center",
          }}
        >
          <select
            value={resolutionType}
            onChange={(e) => setResolutionType(e.target.value)}
            style={{
              padding: "0.45rem 0.5rem",
              borderRadius: "0.375rem",
              border: "1px solid #d4d4d4",
            }}
          >
            {RESOLUTION_TYPES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            placeholder="Resolution notes (required)"
            style={{
              padding: "0.45rem 0.6rem",
              borderRadius: "0.375rem",
              border: "1px solid #d4d4d4",
              fontFamily: "inherit",
            }}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={resolving || !resolutionNotes.trim()}
            onClick={() => void submitResolution()}
            style={{ width: "auto" }}
          >
            {resolving ? "Saving…" : "Record"}
          </button>
        </div>
      </section>

      <section className="surface-card" style={{ padding: "1rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Audit timeline</h2>
        {ticket.events.length === 0 ? (
          <p className="surface-muted">No events recorded.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
            {ticket.events.map((e) => (
              <li key={e.id}>
                <strong>{e.event_type}</strong> · {formatDateTime(e.created_at)}
                {e.from_value && e.to_value && (
                  <>
                    {" "}
                    — {e.from_value} → {e.to_value}
                  </>
                )}
                {e.note && <> · {e.note}</>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Order Details Modal ── */}
      {orderModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", zIndex: 1000 }}
          onMouseDown={() => { setOrderModal(false); setOrderDetails(null); }}
        >
          <div
            style={{ width: "min(680px,100%)", maxHeight: "90vh", overflowY: "auto", background: "white", borderRadius: "20px", padding: "2rem", boxShadow: "0 32px 64px -16px rgba(0,0,0,0.25)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
              <div>
                <span className="surface-eyebrow">Order Details</span>
                <h2 style={{ margin: "0.2rem 0 0", fontSize: "1.4rem" }}>Linked Order</h2>
              </div>
              <button
                type="button"
                onClick={() => { setOrderModal(false); setOrderDetails(null); }}
                style={{ background: "#f3f4f6", border: "none", width: 36, height: 36, borderRadius: 12, fontSize: "1rem", fontWeight: 700, color: "#6b7280", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >✕</button>
            </div>

            {orderLoading && <p className="surface-muted">Loading order details…</p>}
            {orderError && <p className="surface-error">{orderError}</p>}

            {orderDetails && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                {/* Customer */}
                <div style={{ padding: "1rem", background: "#fafafa", borderRadius: 14, border: "1px solid #f3f4f6" }}>
                  <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#9ca3af" }}>Customer</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem 1rem", fontSize: "0.9rem" }}>
                    <div><strong>Name:</strong> {orderDetails.customer.name}</div>
                    <div><strong>Phone:</strong> {orderDetails.customer.phone}</div>
                    {orderDetails.customer.email && <div style={{ gridColumn: "1/-1" }}><strong>Email:</strong> {orderDetails.customer.email}</div>}
                  </div>
                </div>

                {/* Order Summary */}
                <div style={{ padding: "1rem", background: "#fafafa", borderRadius: 14, border: "1px solid #f3f4f6" }}>
                  <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#9ca3af" }}>Order</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem 1rem", fontSize: "0.9rem" }}>
                    <div><strong>#</strong> {orderDetails.order.order_number}</div>
                    <div><strong>Status:</strong> {orderDetails.order.status}</div>
                    <div><strong>Type:</strong> {orderDetails.order.fulfillment_type}</div>
                    <div><strong>Payment:</strong> {orderDetails.order.payment_status}</div>
                    <div><strong>Placed:</strong> {formatDateTime(orderDetails.order.placed_at)}</div>
                    {orderDetails.order.completed_at && <div><strong>Completed:</strong> {formatDateTime(orderDetails.order.completed_at)}</div>}
                    {orderDetails.order.cancelled_at && <div><strong>Cancelled:</strong> {formatDateTime(orderDetails.order.cancelled_at)}</div>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.5rem", marginTop: "0.75rem", padding: "0.75rem", background: "white", borderRadius: 10, border: "1px solid #e5e7eb", textAlign: "center", fontSize: "0.85rem" }}>
                    <div><div style={{ fontWeight: 800, color: "#f97316" }}>{formatCents(orderDetails.order.item_subtotal_cents)}</div><div style={{ color: "#9ca3af", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase" }}>Subtotal</div></div>
                    <div><div style={{ fontWeight: 800 }}>{formatCents(orderDetails.order.tax_cents)}</div><div style={{ color: "#9ca3af", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase" }}>Tax</div></div>
                    <div><div style={{ fontWeight: 800, color: "#059669" }}>{formatCents(orderDetails.order.final_payable_cents)}</div><div style={{ color: "#9ca3af", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase" }}>Total</div></div>
                  </div>
                  {orderDetails.order.customer_order_notes && (
                    <div style={{ marginTop: "0.75rem", padding: "0.6rem 0.8rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, fontSize: "0.85rem" }}>
                      <strong>Notes:</strong> {orderDetails.order.customer_order_notes}
                    </div>
                  )}
                  {orderDetails.order.address_snapshot && typeof orderDetails.order.address_snapshot === "object" && (
                    <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#6b7280" }}>
                      <strong>Address:</strong>{" "}
                      {[orderDetails.order.address_snapshot.line1, orderDetails.order.address_snapshot.city, orderDetails.order.address_snapshot.postalCode].filter(Boolean).join(", ")}
                    </div>
                  )}
                </div>

                {/* Payments */}
                {orderDetails.payments.length > 0 && (
                  <div style={{ padding: "1rem", background: "#fafafa", borderRadius: 14, border: "1px solid #f3f4f6" }}>
                    <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#9ca3af" }}>Payments</h3>
                    {orderDetails.payments.map((p) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0", borderBottom: "1px solid #f3f4f6", fontSize: "0.88rem" }}>
                        <span>{p.method} · <span style={{ color: "#6b7280" }}>{p.status}</span></span>
                        <span style={{ fontWeight: 700 }}>{formatCents(p.amount_cents)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Items */}
                <div style={{ padding: "1rem", background: "#fafafa", borderRadius: 14, border: "1px solid #f3f4f6" }}>
                  <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#9ca3af" }}>Items</h3>
                  {orderDetails.items.map((item) => (
                    <div key={item.id} style={{ padding: "0.6rem 0", borderBottom: "1px solid #f3f4f6" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.92rem" }}>
                        <span><strong>{item.quantity}×</strong> {item.product_name}</span>
                        <span style={{ fontWeight: 700 }}>{formatCents(item.line_total_cents)}</span>
                      </div>
                      {item.modifiers.length > 0 && (
                        <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.2rem" }}>
                          {item.modifiers.map((m, i) => <span key={i}>{i > 0 ? ", " : ""}{m.name}</span>)}
                        </div>
                      )}
                      {item.flavours.length > 0 && (
                        <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.15rem" }}>
                          🌶️ {item.flavours.map((f) => f.name).join(", ")}
                        </div>
                      )}
                      {item.special_instructions && (
                        <div style={{ fontSize: "0.8rem", color: "#b45309", marginTop: "0.15rem", fontStyle: "italic" }}>
                          "{item.special_instructions}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
