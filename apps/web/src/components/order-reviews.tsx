"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { OrderItem } from "@/lib/types";

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

function Stars({
  value,
  onChange,
  readOnly = false,
}: {
  value: number;
  onChange?: (n: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Rating"
      style={{ display: "inline-flex", gap: "0.25rem" }}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            disabled={readOnly}
            onClick={() => onChange?.(n)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontSize: "1.35rem",
              color: filled ? "#e0a800" : "#c5c5c5",
              cursor: readOnly ? "default" : "pointer",
            }}
          >
            {filled ? "★" : "☆"}
          </button>
        );
      })}
    </div>
  );
}

function ReviewForm({
  orderId,
  orderItemId,
  locationId,
  onSubmitted,
}: {
  orderId: string;
  orderItemId: string;
  locationId: string;
  onSubmitted: (r: ReviewRecord) => void;
}) {
  const session = useSession();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (rating < 1) {
      setError("Please select a rating.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          apiFetch(
            `/api/v1/orders/${orderId}/order-items/${orderItemId}/reviews`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                rating,
                review_body: body.trim() || undefined,
              }),
              locationId,
            },
          ),
        session.refresh,
        session.clear,
      );
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(
          payload?.errors?.[0]?.message ?? `Review failed (${res.status})`,
        );
      }
      onSubmitted(payload.data as ReviewRecord);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit review");
    } finally {
      setSubmitting(false);
    }
  }, [orderId, orderItemId, locationId, rating, body, session, onSubmitted]);

  return (
    <div style={{ marginTop: "0.5rem" }}>
      <Stars value={rating} onChange={setRating} />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Tell us about this item (optional)"
        rows={3}
        maxLength={2000}
        style={{
          display: "block",
          width: "100%",
          marginTop: "0.5rem",
          padding: "0.5rem",
          borderRadius: "0.375rem",
          border: "1px solid #d4d4d4",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button
          type="button"
          className="btn-primary"
          disabled={submitting || rating < 1}
          onClick={submit}
        >
          {submitting ? "Submitting…" : "Submit review"}
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

function ExistingReview({ review }: { review: ReviewRecord }) {
  return (
    <div style={{ marginTop: "0.5rem" }}>
      <Stars value={review.rating} readOnly />
      {review.review_body && (
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.95rem" }}>
          {review.review_body}
        </p>
      )}
      {review.admin_reply && (
        <div
          style={{
            marginTop: "0.6rem",
            padding: "0.6rem 0.75rem",
            background: "rgba(38, 166, 91, 0.08)",
            borderLeft: "3px solid #26a65b",
            borderRadius: "0 0.375rem 0.375rem 0",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600 }}>
            Wings 4 U replied
          </p>
          <p style={{ margin: "0.2rem 0 0", fontSize: "0.9rem" }}>
            {review.admin_reply}
          </p>
        </div>
      )}
      {review.is_approved_public && (
        <p
          className="surface-muted"
          style={{ marginTop: "0.4rem", fontSize: "0.75rem" }}
        >
          Published publicly
        </p>
      )}
    </div>
  );
}

export function OrderReviews({
  orderId,
  locationId,
  items,
  orderStatus,
}: {
  orderId: string;
  /**
   * Location the order was placed at. `ReviewsController` is mounted under
   * `/orders/:orderId/...reviews` and guarded by `LocationScopeGuard`, so
   * every list/create call must send `X-Location-Id`. Without it the
   * backend returns 422 "X-Location-Id header must be a valid UUID".
   */
  locationId: string;
  items: OrderItem[];
  orderStatus: string;
}) {
  const session = useSession();
  const [reviews, setReviews] = useState<Record<string, ReviewRecord>>({});
  const [loading, setLoading] = useState(true);
  const [multiItemExpanded, setMultiItemExpanded] = useState(false);

  const eligible = orderStatus === "PICKED_UP" || orderStatus === "DELIVERED";
  const multipleItems = items.length > 1;

  const fetchReviews = useCallback(async () => {
    try {
      const res = await withSilentRefresh(
        () => apiFetch(`/api/v1/orders/${orderId}/reviews`, { locationId }),
        session.refresh,
        session.clear,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { data?: ReviewRecord[] };
      const list = body.data ?? [];
      const map: Record<string, ReviewRecord> = {};
      for (const r of list) map[r.order_item_id] = r;
      setReviews(map);
    } finally {
      setLoading(false);
    }
  }, [orderId, locationId, session]);

  useEffect(() => {
    if (!eligible) {
      setLoading(false);
      return;
    }
    void fetchReviews();
  }, [eligible, fetchReviews]);

  if (!eligible) return null;
  if (items.length === 0) return null;

  const reviewList =
    multipleItems && !multiItemExpanded ? null : (
      <>
        {items.map((item, idx) => {
          const existing = reviews[item.id];
          const last = idx === items.length - 1;
          return (
            <div
              key={item.id}
              style={{
                paddingBottom: last ? 0 : "0.75rem",
                marginBottom: last ? 0 : "0.75rem",
                borderBottom: last ? "none" : "1px solid #eee",
              }}
            >
              <p style={{ margin: 0, fontWeight: 600 }}>
                {item.product_name_snapshot}
              </p>
              {existing ? (
                <ExistingReview review={existing} />
              ) : (
                <ReviewForm
                  orderId={orderId}
                  orderItemId={item.id}
                  locationId={locationId}
                  onSubmitted={(r) =>
                    setReviews((prev) => ({ ...prev, [item.id]: r }))
                  }
                />
              )}
            </div>
          );
        })}
      </>
    );

  return (
    <section className="surface-card" style={{ marginTop: "1rem" }}>
      {loading && <p className="surface-muted">Loading…</p>}
      {!loading && multipleItems && !multiItemExpanded && (
        <div className="order-review-prompt">
          <button
            type="button"
            onClick={() => setMultiItemExpanded(true)}
            className="btn-primary order-review-prompt-action"
          >
            Rate your Order
          </button>
        </div>
      )}
      {!loading && multipleItems && multiItemExpanded && (
        <button
          type="button"
          onClick={() => setMultiItemExpanded(false)}
          className="surface-muted"
          style={{
            display: "block",
            margin: "0 0 0.75rem",
            padding: 0,
            border: "none",
            background: "none",
            cursor: "pointer",
            fontSize: "0.85rem",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
          }}
        >
          Show less
        </button>
      )}
      {!loading && reviewList}
    </section>
  );
}
