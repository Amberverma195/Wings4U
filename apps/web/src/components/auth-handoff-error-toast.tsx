"use client";

import { useEffect, useRef, useState } from "react";
import {
  addAuthHandoffErrorListener,
  consumeStoredAuthHandoffError,
  type AuthHandoffErrorEvent,
} from "@/lib/auth-handoff-toast";

const DISPLAY_MS = 4200;

export function AuthHandoffErrorToast() {
  const [message, setMessage] = useState<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function show(nextMessage: string) {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      setMessage(nextMessage);
      hideTimerRef.current = setTimeout(() => {
        setMessage(null);
        hideTimerRef.current = null;
      }, DISPLAY_MS);
    }

    const stored = consumeStoredAuthHandoffError();
    if (stored) {
      show(stored);
    }

    const removeListener = addAuthHandoffErrorListener(
      (event: AuthHandoffErrorEvent) => {
        show(event.detail.message);
      },
    );

    return () => {
      removeListener();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!message) return null;

  return (
    <div
      className="wk-address-saved-toast wk-auth-error-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
