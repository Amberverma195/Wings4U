"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useSession, withSilentRefresh } from "@/lib/session";
import { SUPPORT_TICKET_TYPES, type SupportTicketType } from "@/lib/types";

function typeLabel(t: SupportTicketType): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SupportTicketForm({
  orderId,
  locationId,
  onDone,
}: {
  orderId: string;
  /**
   * Location the order was placed at. `SupportController` is guarded by
   * `LocationScopeGuard`, so `POST /support/tickets` requires a valid
   * `X-Location-Id` UUID header. Missing or malformed => 422
   * "X-Location-Id header must be a valid UUID".
   */
  locationId: string;
  onDone: () => void;
}) {
  const session = useSession();
  const [ticketType, setTicketType] = useState<SupportTicketType>("OTHER");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = useCallback(async () => {
    if (!subject.trim() || !description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          apiFetch("/api/v1/support/tickets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticket_type: ticketType,
              subject: subject.trim(),
              description: description.trim(),
              order_id: orderId,
            }),
            locationId,
          }),
        session.refresh,
        session.clear,
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.errors?.[0]?.message ?? `Failed (${res.status})`);
      }
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  }, [orderId, locationId, ticketType, subject, description, session]);

  if (success) {
    return (
      <div style={{ textAlign: "center", padding: "1rem 0" }}>
        <h3 style={{ margin: "0 0 0.5rem", color: "var(--accent-strong)" }}>Ticket submitted</h3>
        <p className="surface-muted">Our team will review your request and get back to you.</p>
        <button className="btn-secondary" style={{ marginTop: "0.75rem" }} onClick={onDone}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ margin: "0 0 1rem" }}>Open a support ticket</h3>

      <div className="checkout-field">
        <label>Issue type</label>
        <select
          value={ticketType}
          onChange={(e) => setTicketType(e.target.value as SupportTicketType)}
        >
          {SUPPORT_TICKET_TYPES.map((t) => (
            <option key={t} value={t}>{typeLabel(t)}</option>
          ))}
        </select>
      </div>

      <div className="checkout-field">
        <label>Subject</label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Brief summary of the issue"
        />
      </div>

      <div className="checkout-field">
        <label>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell us what happened…"
          rows={3}
        />
      </div>

      {error && <p className="surface-error" style={{ marginBottom: "0.75rem" }}>{error}</p>}

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button
          className="btn-primary"
          style={{ flex: 1 }}
          disabled={submitting || !subject.trim() || !description.trim()}
          onClick={() => void submit()}
        >
          {submitting ? "Submitting…" : "Submit ticket"}
        </button>
        <button className="btn-secondary" onClick={onDone} disabled={submitting}>
          Cancel
        </button>
      </div>
    </div>
  );
}
