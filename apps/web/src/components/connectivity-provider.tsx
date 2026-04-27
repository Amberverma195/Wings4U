"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { apiFetch } from "@/lib/api";
import {
  CONNECTIVITY_EVENT,
  type ConnectivityReason,
} from "@/lib/connectivity-events";

async function checkHealth(): Promise<boolean> {
  try {
    const res = await apiFetch("/api/v1/health", { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

const COPY: Record<
  ConnectivityReason,
  { title: string; body: string; retryLabel: string }
> = {
  offline: {
    title: "You went offline 😔",
    body: "Your wings need the internet too. Reconnect and try again.",
    retryLabel: "Retry connection",
  },
  network: {
    title: "Wings are on pause for a second",
    body: "We're restoring connection to bring your wings back online. Please try again shortly.",
    retryLabel: "Retry connection",
  },
  server: {
    title: "Something went wrong",
    body: "Something got in the way of your wings. Give it a second and try again.",
    retryLabel: "Retry connection",
  },
};

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ConnectivityReason>("network");
  const [retrying, setRetrying] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const show = useCallback((next: ConnectivityReason) => {
    setReason(next);
    setOpen(true);
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [open]);

  const tryRecover = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return;
    }
    setRetrying(true);
    try {
      const ok = await checkHealth();
      if (ok) dismiss();
      else if (typeof navigator !== "undefined" && navigator.onLine) {
        show("network");
      }
    } finally {
      setRetrying(false);
    }
  }, [dismiss, show]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onOffline = () => show("offline");
    const onOnline = () => {
      void tryRecover();
    };

    const onConnectivity = (e: Event) => {
      const ce = e as CustomEvent<{ reason?: ConnectivityReason }>;
      const r = ce.detail?.reason;
      if (r === "offline" || r === "network" || r === "server") show(r);
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener(CONNECTIVITY_EVENT, onConnectivity as EventListener);

    if (!navigator.onLine) show("offline");

    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(
        CONNECTIVITY_EVENT,
        onConnectivity as EventListener
      );
    };
  }, [show, tryRecover]);

  /* ---- Rim spotlight mouse tracking (same as auth card) ---- */
  const updateRim = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const xPct = ((e.clientX - r.left) / r.width) * 100;
    const yPct = ((e.clientY - r.top) / r.height) * 100;
    el.style.setProperty("--rim-x", `${xPct}%`);
    el.style.setProperty("--rim-y", `${yPct}%`);
  }, []);

  const clearRim = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.removeProperty("--rim-x");
    el.style.removeProperty("--rim-y");
  }, []);

  const text = COPY[reason];

  return (
    <>
      {children}
      {open ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="wk-connectivity-title"
          aria-describedby="wk-connectivity-desc"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10050,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            background: "rgba(6, 4, 2, 0.82)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            padding: "1.25rem",
          }}
        >
          {/* Card — uses the same wk-auth-card class from globals.css */}
          <div
            ref={cardRef}
            className="wk-auth-card"
            onMouseMove={updateRim}
            onMouseEnter={updateRim}
            onMouseLeave={clearRim}
            style={{
              maxWidth: 460,
              minHeight: "auto",
              textAlign: "center",
              padding: "2.25rem 2rem 2rem",
            }}
          >
            {/* Spinning amber border glow */}
            <div className="wk-auth-card-glow" aria-hidden />
            {/* Mouse-following rim spotlight */}
            <div className="wk-auth-card-rim" aria-hidden />

            <h1
              id="wk-connectivity-title"
              style={{
                position: "relative",
                zIndex: 2,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: "clamp(1.85rem, 6vw, 2.5rem)",
                letterSpacing: "0.08em",
                margin: "0 0 14px",
                textAlign: "center",
                color: "#fff8ef",
                lineHeight: 1.1,
                textShadow: "0 2px 16px rgba(0, 0, 0, 0.45)",
              }}
            >
              {text.title}
            </h1>
            <p
              id="wk-connectivity-desc"
              style={{
                position: "relative",
                zIndex: 2,
                margin: "0 0 28px",
                color: "#ffd28a",
                fontSize: 15,
                lineHeight: 1.6,
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontWeight: 500,
                letterSpacing: "0.01em",
              }}
            >
              {text.body}
            </p>
            <button
              type="button"
              style={{
                position: "relative",
                zIndex: 2,
                width: "100%",
                padding: "0.85rem 1.5rem",
                borderRadius: 10,
                border: "none",
                background: "#f5a623",
                color: "#0a0a0a",
                fontWeight: 700,
                fontSize: 15,
                fontFamily: "'DM Sans', system-ui, sans-serif",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                cursor: "pointer",
                transition: "opacity 0.15s, transform 0.15s",
                opacity: retrying ? 0.7 : 1,
                pointerEvents: retrying ? "none" : "auto",
              }}
              onClick={() => void tryRecover()}
              disabled={retrying}
            >
              {retrying ? "Checking…" : text.retryLabel}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
