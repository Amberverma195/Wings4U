"use client";

import { adminApiFetch } from "../admin-api";
import { useCallback, useEffect, useState } from "react";
import { useSession, withSilentRefresh } from "@/lib/session";

type ReviewRecord = {
  id: string;
  order_id: string;
  order_item_id: string;
  customer_user_id: string;
  rating: number;
  review_body: string | null;
  is_approved_public: boolean;
  admin_reply: string | null;
  admin_replied_at: string | null;
  admin_replied_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  order_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  item_name?: string | null;
};

type ListResponse = {
  items: ReviewRecord[];
  next_cursor: string | null;
};

function Stars({ value }: { value: number }) {
  return (
    <span aria-label={`${value} of 5 stars`}>
      {"★".repeat(value)}
      <span style={{ color: "#c5c5c5" }}>{"★".repeat(5 - value)}</span>
    </span>
  );
}

function ReviewCard({
  review,
  onUpdated,
}: {
  review: ReviewRecord;
  onUpdated: (r: ReviewRecord) => void;
}) {
  const session = useSession();
  const [reply, setReply] = useState(review.admin_reply ?? "");
  const [busy, setBusy] = useState<"reply" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitReply = useCallback(async () => {
    setBusy("reply");
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          adminApiFetch(`/api/v1/admin/reviews/${review.id}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: reply.trim() }),
          }),
        session.refresh,
        session.clear,
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(
          body?.errors?.[0]?.message ?? `Reply failed (${res.status})`,
        );
      }
      onUpdated({ ...review, ...(body.data as ReviewRecord) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reply failed");
    } finally {
      setBusy(null);
    }
  }, [review, reply, session, onUpdated]);

  const togglePublish = useCallback(async () => {
    setBusy("publish");
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          adminApiFetch(`/api/v1/admin/reviews/${review.id}/publish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publish: !review.is_approved_public }),
          }),
        session.refresh,
        session.clear,
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(
          body?.errors?.[0]?.message ?? `Publish failed (${res.status})`,
        );
      }
      onUpdated({ ...review, ...(body.data as ReviewRecord) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(null);
    }
  }, [review, session, onUpdated]);

  const customerName = review.customer_name || "Customer";
  const orderNumber = review.order_number ? `#${review.order_number}` : review.order_id.slice(0, 8);
  const itemName = review.item_name || "Menu item";

  return (
    <div
      className="surface-card"
      style={{ marginBottom: "1rem", padding: "1.25rem" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Stars value={review.rating} />
            <span
              className="surface-muted"
              style={{ fontSize: "0.85rem" }}
            >
              {new Date(review.created_at).toLocaleString()}
            </span>
          </div>
          <div style={{ marginTop: "0.35rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "4px",
                background: review.is_approved_public
                  ? "rgba(38, 166, 91, 0.15)"
                  : "rgba(180, 100, 0, 0.15)",
                color: review.is_approved_public ? "#26a65b" : "#d97706",
                border: review.is_approved_public
                  ? "1px solid rgba(38, 166, 91, 0.3)"
                  : "1px solid rgba(180, 100, 0, 0.3)",
              }}
            >
              {review.is_approved_public ? "Published Publicly" : "Internal Only (Unpublished)"}
            </span>
          </div>
        </div>

        <button
          type="button"
          className={review.is_approved_public ? "btn-secondary" : "btn-primary"}
          disabled={busy !== null}
          onClick={togglePublish}
        >
          {busy === "publish"
            ? "Updating…"
            : review.is_approved_public
              ? "Unpublish"
              : "Publish"}
        </button>
      </div>

      {/* Customer & Order Context */}
      <div
        style={{
          padding: "0.75rem",
          borderRadius: "0.375rem",
          background: "rgba(255, 255, 255, 0.04)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          marginBottom: "0.75rem",
          fontSize: "0.85rem",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "0.5rem",
        }}
      >
        <div>
          <strong style={{ color: "#ffd500" }}>Customer:</strong> {customerName}
          {review.customer_phone ? (
            <div className="surface-muted" style={{ fontSize: "0.8rem" }}>
              Phone: {review.customer_phone}
            </div>
          ) : null}
          {review.customer_email ? (
            <div className="surface-muted" style={{ fontSize: "0.8rem" }}>
              Email: {review.customer_email}
            </div>
          ) : null}
        </div>
        <div>
          <strong style={{ color: "#ffd500" }}>Order:</strong> {orderNumber}
          <div className="surface-muted" style={{ fontSize: "0.8rem" }}>
            Reviewed item: <strong>{itemName}</strong>
          </div>
        </div>
      </div>

      {review.review_body ? (
        <p style={{ margin: "0 0 0.75rem", fontStyle: "italic", fontSize: "0.95rem" }}>
          &ldquo;{review.review_body}&rdquo;
        </p>
      ) : (
        <p className="surface-muted" style={{ margin: "0 0 0.75rem", fontStyle: "italic", fontSize: "0.85rem" }}>
          (No written comment provided)
        </p>
      )}

      {/* Collapsible Technical IDs for Troubleshooting */}
      <details className="surface-muted" style={{ fontSize: "0.75rem", margin: "0.5rem 0" }}>
        <summary style={{ cursor: "pointer" }}>Technical IDs for troubleshooting</summary>
        <div style={{ marginTop: "0.25rem", paddingLeft: "0.5rem", borderLeft: "2px solid rgba(255, 255, 255, 0.1)" }}>
          Order ID: {review.order_id} · Item ID: {review.order_item_id} · User ID: {review.customer_user_id} · Review ID: {review.id}
        </div>
      </details>

      <div style={{ marginTop: "0.75rem" }}>
        <label
          htmlFor={`reply-${review.id}`}
          style={{ fontSize: "0.85rem", fontWeight: 600 }}
        >
          Admin Reply
        </label>
        <textarea
          id={`reply-${review.id}`}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Write a reply visible to the customer on their order details..."
          style={{
            display: "block",
            width: "100%",
            marginTop: "0.25rem",
            padding: "0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid #d4d4d4",
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null || reply.trim().length < 1}
            onClick={submitReply}
          >
            {busy === "reply"
              ? "Saving…"
              : review.admin_reply
                ? "Update reply"
                : "Save reply"}
          </button>
          {review.admin_replied_at && (
            <span
              className="surface-muted"
              style={{ fontSize: "0.8rem" }}
            >
              Last replied {new Date(review.admin_replied_at).toLocaleString()}
            </span>
          )}
        </div>
      </div>
      {error && (
        <p
          className="surface-error"
          style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function AdminReviewsClient() {
  const session = useSession();
  const [items, setItems] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "replied" | "unreplied">("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (filter !== "all") qs.set("has_reply", filter === "replied" ? "true" : "false");
        if (!replace && cursor) qs.set("cursor", cursor);
        const res = await withSilentRefresh(
          () => adminApiFetch(`/api/v1/admin/reviews?${qs.toString()}`),
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
    [filter, cursor, session],
  );

  useEffect(() => {
    setCursor(null);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const applyUpdate = (updated: ReviewRecord) =>
    setItems((prev) =>
      prev.map((r) => (r.id === updated.id ? updated : r)),
    );

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>
        <p className="surface-eyebrow" style={{ margin: 0 }}>Reputation</p>
        <h1 style={{ margin: "0.2rem 0 0" }}>Customer reviews</h1>
        <p className="surface-muted" style={{ margin: "0.4rem 0 0" }}>
          Reply to customer reviews and choose which ones to publish publicly.
        </p>
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-start" }}>
          {(["all", "unreplied", "replied"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={filter === f ? "btn-primary" : "btn-secondary"}
              style={{
                width: "140px",
                height: "42px",
                padding: "0",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "unreplied" ? "Needs reply" : "Replied"}
            </button>
          ))}
        </div>
      </section>

      {error && <p className="surface-error">{error}</p>}

      {items.length === 0 && !loading && (
        <p className="surface-muted">No reviews match this filter.</p>
      )}

      {items.map((r) => (
        <ReviewCard key={r.id} review={r} onUpdated={applyUpdate} />
      ))}

      {cursor && (
        <div style={{ textAlign: "center", margin: "1rem 0" }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={() => void load(false)}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
