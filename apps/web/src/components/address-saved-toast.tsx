"use client";

import { useEffect, useRef, useState } from "react";
import { DELIVERY_ADDRESS_SAVED_EVENT } from "@/lib/delivery-address";

const DISPLAY_MS = 3800;

export function AddressSavedToast() {
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onSaved() {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      setVisible(true);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        hideTimerRef.current = null;
      }, DISPLAY_MS);
    }

    window.addEventListener(DELIVERY_ADDRESS_SAVED_EVENT, onSaved);
    return () => {
      window.removeEventListener(DELIVERY_ADDRESS_SAVED_EVENT, onSaved);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="wk-address-saved-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      Address saved to My Addresses
    </div>
  );
}
