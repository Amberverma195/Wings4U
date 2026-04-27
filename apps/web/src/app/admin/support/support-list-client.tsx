"use client";

import { adminApiFetch } from "../admin-api";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { formatDateTime } from "../admin-api";

type TicketSummary = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  ticket_type: string;
  order_id: string | null;
  customer_user_id: string;
  resolution_type: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

type ListResponse = {
  tickets: TicketSummary[];
  next_cursor: string | null;
};

const STATUS_FILTERS = [
  { id: "OPEN", label: "Open" },
  { id: "IN_REVIEW", label: "In review" },
  { id: "WAITING_ON_CUSTOMER", label: "Waiting on customer" },
  { id: "RESOLVED", label: "Resolved" },
  { id: "CLOSED", label: "Closed" },
  { id: "", label: "All" },
] as const;

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    OPEN: "rgba(220, 38, 38, 0.18)",
    IN_REVIEW: "rgba(245, 158, 11, 0.18)",
    WAITING_ON_CUSTOMER: "rgba(59, 130, 246, 0.18)",
    RESOLVED: "rgba(22, 163, 74, 0.18)",
    CLOSED: "rgba(0,0,0,0.08)",
  };
  return (
    <span
      style={{
        padding: "0.15rem 0.5rem",
        borderRadius: "0.375rem",
        background: colors[status] ?? "rgba(0,0,0,0.06)",
        fontSize: "0.7rem",
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

export function SupportListClient() {
  const session = useSession();
  const [statusFilter, setStatusFilter] = useState<string>("OPEN");
  const [items, setItems] = useState<TicketSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (append: boolean, nextCursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (statusFilter) qs.set("status", statusFilter);
        if (append && nextCursor) qs.set("cursor", nextCursor);
        const res = await withSilentRefresh(
          () => adminApiFetch(`/api/v1/support/tickets?${qs.toString()}`),
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
        setItems((prev) => (append ? [...prev, ...data.tickets] : data.tickets));
        setCursor(data.next_cursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, session],
  );

  useEffect(() => {
    setCursor(null);
    void load(false, null);
  }, [load]);

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>
        <p className="surface-eyebrow" style={{ margin: 0 }}>Support</p>
        <h1 style={{ margin: "0.2rem 0 0" }}>Tickets</h1>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0.75rem" }}>
          Triage open issues, reply, and resolve with refund / replacement /
          credit outcomes.
        </p>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id || "all"}
              type="button"
              className={statusFilter === f.id ? "btn-primary" : "btn-secondary"}
              onClick={() => setStatusFilter(f.id)}
              style={{ width: "auto", padding: "0.4rem 0.85rem" }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {error && <p className="surface-error">{error}</p>}

      {items.length === 0 && !loading ? (
        <p className="surface-muted">No tickets in this view.</p>
      ) : (
        <section className="surface-card" style={{ padding: 0, overflow: "hidden" }}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {items.map((t) => (
              <li
                key={t.id}
                style={{
                  borderBottom: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                <Link
                  href={`/admin/support/${t.id}`}
                  style={{
                    display: "block",
                    padding: "0.85rem 1rem",
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                      alignItems: "baseline",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{t.subject}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div
                    className="surface-muted"
                    style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}
                  >
                    {t.ticket_type} · {t.priority} · created{" "}
                    {formatDateTime(t.created_at)}
                    {t.order_id && (
                      <> · order {t.order_id.slice(0, 8)}…</>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cursor && (
        <div style={{ textAlign: "center", marginTop: "1rem" }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={() => void load(true, cursor)}
            style={{ width: "auto" }}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
