"use client";

import { adminApiFetch } from "../admin-api";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { formatCents, formatDateTime } from "../admin-api";

type SearchResponse = {
  query: string;
  orders: Array<{
    id: string;
    order_number: number;
    status: string;
    customer_name_snapshot: string | null;
    final_payable_cents: number;
    placed_at: string;
  }>;
  tickets: Array<{
    id: string;
    subject: string;
    status: string;
    ticket_type: string;
  }>;
  customers: Array<{
    id: string;
    display_name: string | null;
    first_name: string | null;
    last_name: string | null;
  }>;
};

export function GlobalSearchClient() {
  const session = useSession();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setError("Enter at least 2 characters.");
        setData(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await withSilentRefresh(
          () =>
            adminApiFetch(`/api/v1/admin/search?q=${encodeURIComponent(trimmed)}`),
          session.refresh,
          session.clear,
        );
        const json = await res.json();
        if (!res.ok) {
          throw new Error(
            json?.errors?.[0]?.message ?? `Search failed (${res.status})`,
          );
        }
        setData(json.data as SearchResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        setLoading(false);
      }
    },
    [session],
  );

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>
        <p className="surface-eyebrow" style={{ margin: 0 }}>Find anything</p>
        <h1 style={{ margin: "0.2rem 0 0" }}>Global search</h1>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0.75rem" }}>
          Search by order number, customer name, phone or email, ticket subject,
          or ticket description.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(query);
          }}
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 1042, jane@example.com, 555-…"
            style={{
              flex: 1,
              minWidth: "16rem",
              padding: "0.55rem 0.7rem",
              borderRadius: "0.5rem",
              border: "1px solid #d4d4d4",
              fontFamily: "inherit",
            }}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={loading || query.trim().length < 2}
            style={{ width: "auto" }}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </form>
      </section>

      {error && <p className="surface-error">{error}</p>}

      {data && (
        <>
          <section className="surface-card" style={{ marginBottom: "1rem", padding: "1rem" }}>
            <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
              Orders ({data.orders.length})
            </h2>
            {data.orders.length === 0 ? (
              <p className="surface-muted">No matching orders.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {data.orders.map((o) => (
                  <li
                    key={o.id}
                    style={{
                      padding: "0.5rem 0",
                      borderTop: "1px solid rgba(0,0,0,0.06)",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "1rem",
                    }}
                  >
                    <div>
                      <Link
                        href={`/admin/orders/${o.id}`}
                        style={{ fontWeight: 600 }}
                      >
                        Order #{o.order_number}
                      </Link>
                      <div className="surface-muted" style={{ fontSize: "0.8rem" }}>
                        {o.customer_name_snapshot ?? "Guest"} ·{" "}
                        {formatDateTime(o.placed_at)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div>{formatCents(o.final_payable_cents)}</div>
                      <div className="surface-muted" style={{ fontSize: "0.75rem" }}>
                        {o.status}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface-card" style={{ marginBottom: "1rem", padding: "1rem" }}>
            <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
              Support tickets ({data.tickets.length})
            </h2>
            {data.tickets.length === 0 ? (
              <p className="surface-muted">No matching tickets.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {data.tickets.map((t) => (
                  <li
                    key={t.id}
                    style={{
                      padding: "0.5rem 0",
                      borderTop: "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
                    <Link href={`/admin/support/${t.id}`} style={{ fontWeight: 600 }}>
                      {t.subject}
                    </Link>
                    <div className="surface-muted" style={{ fontSize: "0.8rem" }}>
                      {t.ticket_type} · {t.status}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface-card" style={{ padding: "1rem" }}>
            <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
              Customers ({data.customers.length})
            </h2>
            {data.customers.length === 0 ? (
              <p className="surface-muted">No matching customers.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {data.customers.map((c) => {
                  const name =
                    c.display_name ??
                    [c.first_name, c.last_name].filter(Boolean).join(" ") ??
                    "Unnamed";
                  return (
                    <li
                      key={c.id}
                      style={{
                        padding: "0.5rem 0",
                        borderTop: "1px solid rgba(0,0,0,0.06)",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{name}</span>{" "}
                      <span className="surface-muted" style={{ fontSize: "0.8rem" }}>
                        {c.id}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
