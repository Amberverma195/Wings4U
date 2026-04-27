"use client";

import { useCallback, useState } from "react";
import { useCart } from "@/lib/cart";

/**
 * Shows a dismissible banner when a guest cart's expiry is within 24 hours.
 * Encourages the guest to create an account so their cart persists beyond
 * the guest cookie TTL.
 */
export function GuestCartExpiryBanner() {
  const { isGuestCart, cartExpiresAt, items, isCartHydrated } = useCart();
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = useCallback(() => setDismissed(true), []);

  if (
    dismissed ||
    !isCartHydrated ||
    !isGuestCart ||
    !cartExpiresAt ||
    items.length === 0
  ) {
    return null;
  }

  const expiresMs = new Date(cartExpiresAt).getTime();
  const nowMs = Date.now();
  const remainingMs = expiresMs - nowMs;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  if (remainingMs <= 0 || remainingMs > TWENTY_FOUR_HOURS) {
    return null;
  }

  const hoursLeft = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "1rem",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 900,
        maxWidth: 420,
        width: "calc(100% - 2rem)",
        background: "linear-gradient(135deg, #1a1a1a 0%, #2a1a00 100%)",
        border: "1px solid #f5a623",
        borderRadius: 10,
        padding: "0.85rem 1.1rem",
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        boxShadow: "0 4px 20px rgba(245, 166, 35, 0.18)",
        fontFamily: "'DM Sans', sans-serif",
        color: "#fff",
        fontSize: 14,
        lineHeight: 1.45,
        animation: "guestBannerSlideUp 0.35s ease-out",
      }}
    >
      <style>{`
        @keyframes guestBannerSlideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(1rem); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>

      <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>🔥</span>

      <div style={{ flex: 1 }}>
        <strong style={{ color: "#f5a623" }}>
          Your cart expires in ~{hoursLeft}h
        </strong>
        <br />
        <span style={{ color: "#ccc" }}>
          Create an account to save your order and never lose your picks.
        </span>{" "}
        <a
          href="/auth/signup"
          style={{
            color: "#f5a623",
            textDecoration: "underline",
            fontWeight: 600,
          }}
        >
          Sign up →
        </a>
      </div>

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          color: "#777",
          fontSize: 18,
          cursor: "pointer",
          padding: "0 2px",
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
