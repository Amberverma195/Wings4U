"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { adminApiFetch, formatDateTime } from "../admin-api";

type AuditEntry = {
  id: string;
  location_id: string | null;
  actor_user_id: string | null;
  actor_role_snapshot: string;
  action_key: string;
  entity_type: string;
  entity_id: string | null;
  reason_text: string | null;
  payload_json: unknown;
  created_at: string;
};

type ListResponse = {
  logs: AuditEntry[];
  next_cursor: string | null;
};

export function AuditLogClient() {
  const session = useSession();
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (append: boolean, nextCursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (append && nextCursor) qs.set("cursor", nextCursor);
        const res = await withSilentRefresh(
          () => adminApiFetch(`/api/v1/admin/audit-log?${qs.toString()}`),
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
        setItems((prev) => (append ? [...prev, ...data.logs] : data.logs));
        setCursor(data.next_cursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [session],
  );

  useEffect(() => {
    void load(false, null);
  }, [load]);

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>

        <h1 style={{ margin: "0.2rem 0 0" }}>Audit log</h1>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0" }}>
          Every admin-driven mutation (decisions, credits, settings changes,
          force cancels) is recorded here for traceability.
        </p>
      </section>

      {error && <p className="surface-error">{error}</p>}

      <section className="surface-card" style={{ padding: "1rem" }}>
        {items.length === 0 && !loading ? (
          <p className="surface-muted">No audit entries yet.</p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.85rem",
            }}
          >
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "0.4rem 0.4rem 0.4rem 0" }}>When</th>
                <th style={{ padding: "0.4rem" }}>Action</th>
                <th style={{ padding: "0.4rem" }}>Entity</th>
                <th style={{ padding: "0.4rem" }}>Actor</th>
                <th style={{ padding: "0.4rem" }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}
                >
                  <td
                    style={{
                      padding: "0.45rem 0.4rem 0.45rem 0",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatDateTime(row.created_at)}
                  </td>
                  <td style={{ padding: "0.45rem 0.4rem", fontWeight: 600 }}>
                    {row.action_key}
                  </td>
                  <td style={{ padding: "0.45rem 0.4rem" }}>
                    {row.entity_type}
                    {row.entity_id && (
                      <span className="surface-muted">
                        {" "}
                        · {row.entity_id.slice(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "0.45rem 0.4rem" }} className="surface-muted">
                    {row.actor_role_snapshot}
                    {row.actor_user_id ? ` · ${row.actor_user_id.slice(0, 8)}…` : ""}
                  </td>
                  <td style={{ padding: "0.45rem 0.4rem" }} className="surface-muted">
                    {row.reason_text ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
      </section>
    </>
  );
}
