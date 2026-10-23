"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { CustomerAuth } from "@/components/customer-auth";
import { useSession } from "@/lib/session";
import { useModalDialog } from "@/lib/use-modal-dialog";

type Props = {
  /** What to render once the user is authenticated. */
  children: ReactNode;
  /** What to render underneath the modal while the user is signed out
   *  (defaults to nothing, which keeps the page clean). */
  fallback?: ReactNode;
  /** Accessible label for the modal dialog. */
  ariaLabel?: string;
};

/**
 * Wrap any client area that requires authentication. While the session is
 * loading, render the optional fallback so refreshes do not flash stale UI.
 * While the user is signed out a sign-in modal pops up (re-using the
 * checkout-style amber card). Once they sign in, `CustomerAuth` calls
 * `session.refresh()` internally â€” that flips `session.authenticated` to true
 * here and the gated `children` mount.
 */
export function RequireAuthModal({
  children,
  fallback = null,
  ariaLabel = "Sign in to continue",
}: Props) {
  const session = useSession();
  const cardRef = useRef<HTMLElement | null>(null);

  const updateRim = useCallback((e: MouseEvent<HTMLElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--rim-x", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--rim-y", `${((e.clientY - r.top) / r.height) * 100}%`);
  }, []);

  const clearRim = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.removeProperty("--rim-x");
    el.style.removeProperty("--rim-y");
  }, []);

  const open = session.loaded && !session.authenticated;

  useModalDialog({
    dialogRef: cardRef,
    active: open,
    closeOnEscape: false,
  });

  if (!session.loaded) {
    return <>{fallback}</>;
  }

  if (session.authenticated) {
    return <>{children}</>;
  }

  return (
    <>
      {fallback}
      <div
        className="wk-checkout-auth-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <section
          ref={cardRef}
          className="wk-auth-card wk-auth-card--lg"
          tabIndex={-1}
          onMouseMove={updateRim}
          onMouseEnter={updateRim}
          onMouseLeave={clearRim}
        >
          <div className="wk-auth-card-glow" aria-hidden />
          <div className="wk-auth-card-rim" aria-hidden />
          <div className="wk-auth-card-body">
            <CustomerAuth mode="login" />
          </div>
          <div className="wk-auth-card-fineprint">
            By continuing you agree to our{" "}
            <a href="/terms" className="wk-auth-card-link">
              Terms
            </a>{" "}
            &amp;{" "}
            <a href="/privacy" className="wk-auth-card-link">
              Privacy
            </a>
            .
          </div>
        </section>
      </div>
    </>
  );
}
