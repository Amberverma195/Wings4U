"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";
import { adminApiFetch, formatCents, formatDateTime } from "../admin-api";

type OrderRef = {
  id: string;
  order_number: number;
  status: string;
  customer_name_snapshot: string | null;
  final_payable_cents: number;
};

type CancellationRequest = {
  id: string;
  order_id: string;
  request_source: string;
  reason_text: string;
  status: string;
  created_at: string;
  order: OrderRef | null;
};

type RefundRequest = {
  id: string;
  order_id: string;
  amount_cents: number;
  refund_method: string;
  reason_text: string;
  status: string;
  created_at: string;
  order: OrderRef | null;
};

type CancellationListResponse = {
  items: CancellationRequest[];
  next_cursor: string | null;
};
type RefundListResponse = {
  items: RefundRequest[];
  next_cursor: string | null;
};

type Tab = "cancellations" | "refunds";

function CancellationCard({
  request,
  onResolved,
}: {
  request: CancellationRequest;
  onResolved: () => void;
}) {
  const session = useSession();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (action: "APPROVE" | "DENY") => {
    setBusy(action === "APPROVE" ? "approve" : "deny");
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          adminApiFetch(
            `/api/v1/admin/cancellation-requests/${request.id}/decide`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action,
                admin_notes: notes.trim() || undefined,
              }),
            },
          ),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Action failed (${res.status})`,
        );
      }
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="surface-card" style={{ padding: "1rem", marginBottom: "0.75rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>
            {request.order ? (
              <Link href={`/admin/orders/${request.order.id}`}>
                Order #{request.order.order_number}
              </Link>
            ) : (
              <>Order {request.order_id.slice(0, 8)}…</>
            )}
          </h3>
          <p className="surface-muted" style={{ margin: "0.2rem 0 0", fontSize: "0.8rem" }}>
            {request.request_source} · requested {formatDateTime(request.created_at)}
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
          {request.status}
        </span>
      </div>

      <p style={{ margin: "0.6rem 0 0", fontSize: "0.95rem" }}>
        <strong>Reason:</strong> {request.reason_text}
      </p>
      {request.order && (
        <p className="surface-muted" style={{ margin: "0.3rem 0 0", fontSize: "0.85rem" }}>
          {request.order.customer_name_snapshot ?? "Guest"} ·{" "}
          {formatCents(request.order.final_payable_cents)} · status{" "}
          {request.order.status}
        </p>
      )}

      <textarea
        rows={2}
        placeholder="Optional admin notes (visible in audit log)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
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

      <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-primary"
          disabled={busy !== null}
          onClick={() => void decide("APPROVE")}
          style={{ width: "auto" }}
        >
          {busy === "approve" ? "Approving…" : "Approve & cancel order"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => void decide("DENY")}
          style={{ width: "auto" }}
        >
          {busy === "deny" ? "Denying…" : "Deny"}
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

function RefundCard({
  request,
  onResolved,
}: {
  request: RefundRequest;
  onResolved: () => void;
}) {
  const session = useSession();
  const [method, setMethod] = useState<string>(request.refund_method ?? "STORE_CREDIT");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (action: "APPROVE" | "REJECT") => {
    setBusy(action === "APPROVE" ? "approve" : "reject");
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          adminApiFetch(`/api/v1/admin/refund-requests/${request.id}/decide`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action,
              refund_method: action === "APPROVE" ? method : undefined,
              admin_notes: notes.trim() || undefined,
            }),
          }),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Action failed (${res.status})`,
        );
      }
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="surface-card" style={{ padding: "1rem", marginBottom: "0.75rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>
            {request.order ? (
              <Link href={`/admin/orders/${request.order.id}`}>
                Order #{request.order.order_number}
              </Link>
            ) : (
              <>Order {request.order_id.slice(0, 8)}…</>
            )}{" "}
            — {formatCents(request.amount_cents)}
          </h3>
          <p className="surface-muted" style={{ margin: "0.2rem 0 0", fontSize: "0.8rem" }}>
            Requested {formatDateTime(request.created_at)} · current method{" "}
            {request.refund_method}
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
          {request.status}
        </span>
      </div>

      <p style={{ margin: "0.6rem 0 0", fontSize: "0.95rem" }}>
        <strong>Reason:</strong> {request.reason_text}
      </p>

      <div
        style={{
          marginTop: "0.6rem",
          display: "flex",
          gap: "0.5rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <label style={{ fontSize: "0.85rem" }}>
          Refund via{" "}
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            style={{
              padding: "0.4rem 0.5rem",
              borderRadius: "0.375rem",
              border: "1px solid #d4d4d4",
            }}
          >
            <option value="STORE_CREDIT">Store credit</option>
            <option value="ORIGINAL_PAYMENT">Original payment</option>
            <option value="CASH">Cash</option>
          </select>
        </label>
      </div>

      <textarea
        rows={2}
        placeholder="Optional admin notes (visible in audit log)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
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

      <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-primary"
          disabled={busy !== null}
          onClick={() => void decide("APPROVE")}
          style={{ width: "auto" }}
        >
          {busy === "approve" ? "Issuing…" : `Approve & issue ${method.toLowerCase().replace("_", " ")}`}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => void decide("REJECT")}
          style={{ width: "auto" }}
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

export function ApprovalsClient() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>("cancellations");

  const [cancellations, setCancellations] = useState<CancellationRequest[]>([]);
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCancellations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () => adminApiFetch("/api/v1/admin/cancellation-requests?status=PENDING"),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Load failed (${res.status})`,
        );
      }
      setCancellations((json.data as CancellationListResponse).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [session]);

  const loadRefunds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () => adminApiFetch("/api/v1/admin/refund-requests?status=PENDING"),
        session.refresh,
        session.clear,
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.errors?.[0]?.message ?? `Load failed (${res.status})`,
        );
      }
      setRefunds((json.data as RefundListResponse).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (tab === "cancellations") void loadCancellations();
    else void loadRefunds();
  }, [tab, loadCancellations, loadRefunds]);

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>
        <p className="surface-eyebrow" style={{ margin: 0 }}>Approvals</p>
        <h1 style={{ margin: "0.2rem 0 0" }}>Pending decisions</h1>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0.75rem" }}>
          KDS / chat-initiated cancellations and refund requests waiting on
          admin review.
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["cancellations", "refunds"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? "btn-primary" : "btn-secondary"}
              onClick={() => setTab(t)}
              style={{ width: "auto", padding: "0.45rem 1rem" }}
            >
              {t === "cancellations"
                ? `Cancellations${cancellations.length ? ` (${cancellations.length})` : ""}`
                : `Refunds${refunds.length ? ` (${refunds.length})` : ""}`}
            </button>
          ))}
        </div>
      </section>

      {error && <p className="surface-error">{error}</p>}

      {tab === "cancellations" ? (
        cancellations.length === 0 && !loading ? (
          <p className="surface-muted">No pending cancellation requests.</p>
        ) : (
          cancellations.map((r) => (
            <CancellationCard
              key={r.id}
              request={r}
              onResolved={() =>
                setCancellations((prev) => prev.filter((p) => p.id !== r.id))
              }
            />
          ))
        )
      ) : refunds.length === 0 && !loading ? (
        <p className="surface-muted">No pending refund requests.</p>
      ) : (
        refunds.map((r) => (
          <RefundCard
            key={r.id}
            request={r}
            onResolved={() =>
              setRefunds((prev) => prev.filter((p) => p.id !== r.id))
            }
          />
        ))
      )}

      {loading && <p className="surface-muted">Loading…</p>}
    </>
  );
}
