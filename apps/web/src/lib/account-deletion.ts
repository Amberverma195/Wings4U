"use client";

import { clearStoredDeliveryQuotes } from "./delivery-quote";

/** Only customer drafts; preserve the signup-device anti-abuse identifier. */
export function forgetDeletedAccount() {
  clearStoredDeliveryQuotes();
  if (typeof window === "undefined") return;
  for (const key of ["wings4u.cart-items-draft-v1", "wings4u.order-context", "wings4u.cart-edit-key",
    "wings4u.apply-wings-reward", "wings4u.reward-add-1lb-wings", "wings4u.promo-checkout-handoff", "wings4u.promo-applied"]) {
    try { window.sessionStorage.removeItem(key); } catch { /* Restricted browser storage. */ }
  }
}

export function leaveDeletedAccount() {
  // A full document navigation drops router, React, profile, and order caches.
  window.location.replace("/");
}
