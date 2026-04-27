"use client";

import { adminApiFetch } from "../admin-api";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";

type ChangeRequest = {
  id: string;
  order_id: string;
  order_number: number;
  order_status: string;
  type: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requested_items_json: Array<{
    menu_item_id: string;
    quantity: number;
    modifier_option_ids: string[];
    special_instructions: string | null;
  }>;
  created_at: string;
};

type ListResponse = {
  items: ChangeRequest[];
  next_cursor: string | null;
};

function RequestCard({
  request,
  onResolved,
}: {
  request: ChangeRequest;
  onResolved: () => void;
}) {
  const session = useSession();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (path: string, body?: unknown) => {
      setError(null);
      try {
        const res = await withSilentRefresh(
          () =>
            adminApiFetch(path, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: body ? JSON.stringify(body) : undefined,
            }),
          session.refresh,
          session.clear,
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.errors?.[0]?.message ?? `Action failed (${res.status})`);
        }
        onResolved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
      }
    },
    [session, onResolved],
  );

  const approve = async () => {
    setBusy("approve");
    try {
      await call(`/api/v1/admin/order-changes/${request.id}/approve`);
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (reason.trim().length < 5) {
      setError("Rejection reason must be at least 5 characters");
      return;
    }
    setBusy("reject");
    try {
      await call(`/api/v1/admin/order-changes/${request.id}/reject`, {
        reason: reason.trim(),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="surface-card"
      style={{ marginBottom: "0.75rem", padding: "1rem" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Order #{request.order_number}</h3>
          <p className="surface-muted" style={{ margin: "0.2rem 0 0", fontSize: "0.8rem" }}>
            Status: {request.order_status} · requested{" "}
            {new Date(request.created_at).toLocaleString()}
          </p>
        </div>
        <span
          style={{
            padding: "0.15rem 0.5rem",
            borderRadius: "0.375rem",
            background: "rgba(245, 158, 11, 0.18)",
            fontSize: "0.75rem",
            fontWeight: 600,
          }}
        >
          PENDING
        </span>
      </div>

      <ul style={{ margin: "0.6rem 0 0", paddingLeft: "1.2rem", fontSize: "0.9rem" }}>
        {request.requested_items_json.map((it, idx) => (
          <li key={idx}>
            {it.quantity}× menu item {it.menu_item_id.slice(0, 8)}…
            {it.modifier_option_ids.length > 0 &&
              ` (${it.modifier_option_ids.length} modifier${
                it.modifier_option_ids.length === 1 ? "" : "s"
              })`}
            {it.special_instructions ? ` — "${it.special_instructions}"` : ""}
          </li>
        ))}
      </ul>

      <div
        style={{
          marginTop: "0.75rem",
          display: "flex",
          gap: "0.5rem",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="btn-primary"
          disabled={busy !== null}
          onClick={approve}
        >
          {busy === "approve" ? "Approving…" : "Approve"}
        </button>
        <div style={{ flex: 1, minWidth: "14rem" }}>
          <input
            type="text"
            placeholder="Rejection reason (min 5 chars)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              padding: "0.45rem 0.6rem",
              borderRadius: "0.375rem",
              border: "1px solid #d4d4d4",
              fontFamily: "inherit",
            }}
          />
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null || reason.trim().length < 5}
          onClick={reject}
        >
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
      {error && (
        <p className="surface-error" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function AdminOrderChangesClient() {
  const session = useSession();
  const [items, setItems] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (replace: boolean, nextCursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (!replace && nextCursor) qs.set("cursor", nextCursor);
        const res = await withSilentRefresh(
          () => adminApiFetch(`/api/v1/admin/order-changes?${qs.toString()}`),
          session.refresh,
          session.clear,
        );
        const body = await res.json();
        if (!res.ok) {
          throw new Error(
            body?.errors?.[0]?.message ?? `Load failed (${res.status})`,
          );
        }
        const data = body.data as ListResponse;
        setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
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
    void load(true, null);
  }, [load]);

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>
        <p className="surface-eyebrow" style={{ margin: 0 }}>Add-items queue</p>
        <h1 style={{ margin: "0.2rem 0 0" }}>Order change requests</h1>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0" }}>
          Approve or reject customer requests to add items to active orders.
        </p>
      </section>

      {error && <p className="surface-error">{error}</p>}

      {items.length === 0 && !loading && (
        <p className="surface-muted">No pending add-items requests.</p>
      )}

      {items.map((r) => (
        <RequestCard
          key={r.id}
          request={r}
          onResolved={() => {
            setItems((prev) => prev.filter((p) => p.id !== r.id));
          }}
        />
      ))}

      {cursor && (
        <div style={{ textAlign: "center", margin: "1rem 0" }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={() => void load(false, cursor)}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
