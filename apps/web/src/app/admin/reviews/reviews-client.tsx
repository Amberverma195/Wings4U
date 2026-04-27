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
      onUpdated(body.data as ReviewRecord);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reply failed");
    } finally {
      setBusy(null);
    }
  }, [review.id, reply, session, onUpdated]);

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
      onUpdated(body.data as ReviewRecord);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(null);
    }
  }, [review.id, review.is_approved_public, session, onUpdated]);

  return (
    <div
      className="surface-card"
      style={{ marginBottom: "1rem", padding: "1rem" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.5rem",
        }}
      >
        <div>
          <Stars value={review.rating} />
          <span
            className="surface-muted"
            style={{ marginLeft: "0.5rem", fontSize: "0.85rem" }}
          >
            {new Date(review.created_at).toLocaleString()}
          </span>
        </div>
        <button
          type="button"
          className={review.is_approved_public ? "btn-secondary" : "btn-primary"}
          disabled={busy !== null}
          onClick={togglePublish}
        >
          {review.is_approved_public ? "Unpublish" : "Publish"}
        </button>
      </div>
      {review.review_body && (
        <p style={{ margin: "0 0 0.75rem" }}>{review.review_body}</p>
      )}
      <p className="surface-muted" style={{ fontSize: "0.75rem", margin: 0 }}>
        Order: {review.order_id} — Item: {review.order_item_id}
      </p>

      <div style={{ marginTop: "0.75rem" }}>
        <label
          htmlFor={`reply-${review.id}`}
          style={{ fontSize: "0.85rem", fontWeight: 600 }}
        >
          Reply
        </label>
        <textarea
          id={`reply-${review.id}`}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          maxLength={2000}
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
        <button
          type="button"
          className="btn-primary"
          style={{ marginTop: "0.5rem" }}
          disabled={busy !== null || reply.trim().length < 1}
          onClick={submitReply}
        >
          {busy === "reply"
            ? "Saving…"
            : review.admin_reply
              ? "Update reply"
              : "Send reply"}
        </button>
        {review.admin_replied_at && (
          <span
            className="surface-muted"
            style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}
          >
            Last replied {new Date(review.admin_replied_at).toLocaleString()}
          </span>
        )}
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
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
          {(["all", "unreplied", "replied"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={filter === f ? "btn-primary" : "btn-secondary"}
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
