"use client";

import { adminApiFetch, formatDateTime } from "../../admin-api";
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

  return (
    <>
      <Link href="/admin/support">← Back to support queue</Link>

      <section className="surface-card" style={{ marginTop: "0.75rem", marginBottom: "1rem" }}>
        <p className="surface-eyebrow" style={{ margin: 0 }}>
          {ticket.ticket_type} · {ticket.priority}
        </p>
        <h1 style={{ margin: "0.2rem 0 0" }}>{ticket.subject}</h1>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
          Status <strong>{ticket.status}</strong> · created{" "}
          {formatDateTime(ticket.created_at)}
          {ticket.order_id && (
            <>
              {" "}
              ·{" "}
              <Link href={`/admin/orders/${ticket.order_id}`}>
                related order
              </Link>
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
    </>
  );
}
