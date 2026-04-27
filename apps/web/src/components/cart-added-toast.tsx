"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/lib/cart";

const DISPLAY_MS = 3200;

/**
 * Shown when a line is appended or merged via `addItem` (not `replaceItem`).
 */
export function CartAddedToast() {
  const { cartAddNonce } = useCart();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const prevNonceRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (cartAddNonce === prevNonceRef.current) return;
    prevNonceRef.current = cartAddNonce;
    setVisible(true);
  }, [cartAddNonce]);

  useEffect(() => {
    if (!visible) return;
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      hideTimerRef.current = null;
    }, DISPLAY_MS);

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [visible]);

  useEffect(() => {
    setVisible(false);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      className="wk-address-saved-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      Item added to cart
    </div>
  );
}
