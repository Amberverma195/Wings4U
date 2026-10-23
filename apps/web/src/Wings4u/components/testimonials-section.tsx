"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { DEFAULT_LOCATION_ID } from "@/lib/env";

export type PublicReview = {
  rating: number;
  comment: string | null;
  item_name: string | null;
  attribution: string;
  created_at: string;
  admin_reply: string | null;
  admin_replied_at: string | null;
};

function avatarInitial(attribution: string): string {
  const trimmed = attribution.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "W";
}

function formatReviewDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function TestimonialsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadReviews() {
      try {
        const res = await apiFetch("/api/v1/reviews/public", {
          locationId: DEFAULT_LOCATION_ID,
        });
        if (!res.ok) {
          if (!cancelled) setReviews([]);
          return;
        }
        const body = (await res.json()) as { data?: PublicReview[] } | null;
        const list = Array.isArray(body?.data) ? body.data : [];
        if (!cancelled) {
          setReviews(list);
        }
      } catch {
        if (!cancelled) {
          setReviews([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadReviews();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }

    const el = sectionRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [loading, reviews.length]);

  // Gracefully hide the empty review area if loading or if zero reviews are approved
  if (loading || reviews.length === 0) {
    return null;
  }

  const show = visible ? " in" : "";
  const isSingle = reviews.length === 1;

  return (
    <section
      id="testimonials"
      ref={sectionRef}
      aria-labelledby="testimonials-heading"
    >
      <div className={`testimonials-head reveal${show}`}>
        <p className="section-label">REAL CUSTOMER REVIEWS</p>
        <h2 id="testimonials-heading">
          <span>THE PEOPLE HAVE </span>
          <span className="gradient-text">SPOKEN</span>
        </h2>
        <div className="section-divider" aria-hidden="true" />
      </div>

      {isSingle ? (
        <div className="testimonials-single-wrapper">
          {reviews.map((review, idx) => {
            const dateStr = formatReviewDate(review.created_at);
            const attribution = review.attribution || "Verified Wings4U Customer";
            return (
              <article key={`pub-rev-${idx}-${review.created_at}`} className="tcard tcard--single">
                <div
                  className="tcard-stars"
                  aria-label={`${review.rating} of 5 stars`}
                >
                  {"★".repeat(Math.max(1, Math.min(5, review.rating)))}
                  <span style={{ color: "rgba(255, 213, 0, 0.25)" }}>
                    {"★".repeat(Math.max(0, 5 - review.rating))}
                  </span>
                </div>

                {review.item_name && (
                  <div className="tcard-item-tag">
                    Reviewed: <strong>{review.item_name}</strong>
                  </div>
                )}

                {review.comment && (
                  <p className="tcard-text">&ldquo;{review.comment}&rdquo;</p>
                )}

                <div className="tcard-author">
                  <div className="tcard-avatar" aria-hidden="true">
                    {avatarInitial(attribution)}
                  </div>
                  <div>
                    <div className="tcard-name">{attribution}</div>
                    {dateStr ? (
                      <div className="tcard-date">{dateStr}</div>
                    ) : null}
                  </div>
                </div>

                {review.admin_reply && (
                  <div className="tcard-admin-reply">
                    <span className="tcard-admin-reply__label">Wings 4 U Replied</span>
                    <p className="tcard-admin-reply__text">{review.admin_reply}</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="testimonials-grid">
          {reviews.map((review, idx) => {
            const dateStr = formatReviewDate(review.created_at);
            const attribution = review.attribution || "Verified Wings4U Customer";
            return (
              <article key={`pub-rev-${idx}-${review.created_at}`} className="tcard">
                <div
                  className="tcard-stars"
                  aria-label={`${review.rating} of 5 stars`}
                >
                  {"★".repeat(Math.max(1, Math.min(5, review.rating)))}
                  <span style={{ color: "rgba(255, 213, 0, 0.25)" }}>
                    {"★".repeat(Math.max(0, 5 - review.rating))}
                  </span>
                </div>

                {review.item_name && (
                  <div className="tcard-item-tag">
                    Reviewed: <strong>{review.item_name}</strong>
                  </div>
                )}

                {review.comment && (
                  <p className="tcard-text">&ldquo;{review.comment}&rdquo;</p>
                )}

                <div className="tcard-author">
                  <div className="tcard-avatar" aria-hidden="true">
                    {avatarInitial(attribution)}
                  </div>
                  <div>
                    <div className="tcard-name">{attribution}</div>
                    {dateStr ? (
                      <div className="tcard-date">{dateStr}</div>
                    ) : null}
                  </div>
                </div>

                {review.admin_reply && (
                  <div className="tcard-admin-reply">
                    <span className="tcard-admin-reply__label">Wings 4 U Replied</span>
                    <p className="tcard-admin-reply__text">{review.admin_reply}</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
