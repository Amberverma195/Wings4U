"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { AccountSkeleton } from "@/components/account-skeleton";
import { AuthShellSkeleton } from "@/components/auth-shell-skeleton";
import { CustomerAuth, type CustomerAuthMode } from "@/components/customer-auth";
import { dispatchAuthHandoffError } from "@/lib/auth-handoff-toast";
import { useSession } from "@/lib/session";

const LazyFloatingLines = dynamic(() => import("@/components/floating-lines"), {
  ssr: false,
});

const AUTH_HANDOFF_TIMEOUT_MS = 8_000;

export type AuthHeadlineRow = {
  text: string;
  /** Apply the orange gradient/shimmer accent treatment to this row. */
  accent?: boolean;
};

export type AuthShellProps = {
  /** "login" | "signup" – passed straight to <CustomerAuth />. */
  mode: CustomerAuthMode;
  /** Accessible label for the card section. */
  cardAriaLabel: string;
  /** Lines of the big brand headline (left column). */
  headlineRows: AuthHeadlineRow[];
  /** Sub-headline below the headline. */
  subline: ReactNode;
  /** Bullet list copy under the subline. */
  features: ReactNode[];
  /** Where to send the user after the auth flow completes. */
  redirectTo?: string;
};

export function AuthShell({
  mode,
  cardAriaLabel,
  headlineRows,
  subline,
  features,
  redirectTo = "/account/profile",
}: AuthShellProps) {
  const router = useRouter();
  const session = useSession();
  const authCardRef = useRef<HTMLElement | null>(null);
  const [showFloatingLines, setShowFloatingLines] = useState(false);
  const [handoffStarted, setHandoffStarted] = useState(false);
  // After OTP, `session.authenticated` is true even when `displayName` is still
  // the E.164 placeholder — the user must stay on the auth card for "Complete
  // your profile". Do not hide/redirect until the profile is actually complete.
  const shouldRedirectAway =
    session.loaded &&
    session.authenticated &&
    session.profileComplete &&
    !session.needsProfileCompletion;
  const isHandoffActive = handoffStarted || shouldRedirectAway;

  useEffect(() => {
    if (!isHandoffActive) return;
    router.replace(redirectTo);

    const timeoutId = window.setTimeout(() => {
      dispatchAuthHandoffError();
      router.replace("/");
    }, AUTH_HANDOFF_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isHandoffActive, redirectTo, router]);

  useEffect(() => {
    if (isHandoffActive) return;

    const marker = { wings4uAuthGuard: true };
    window.history.replaceState(marker, "", window.location.href);
    window.history.pushState(marker, "", window.location.href);

    const keepOnAuthPage = () => {
      window.history.pushState(marker, "", window.location.href);
    };
    const blockMouseHistoryButtons = (event: globalThis.MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("popstate", keepOnAuthPage);
    window.addEventListener("mousedown", blockMouseHistoryButtons, true);
    window.addEventListener("mouseup", blockMouseHistoryButtons, true);
    window.addEventListener("auxclick", blockMouseHistoryButtons, true);

    return () => {
      window.removeEventListener("popstate", keepOnAuthPage);
      window.removeEventListener("mousedown", blockMouseHistoryButtons, true);
      window.removeEventListener("mouseup", blockMouseHistoryButtons, true);
      window.removeEventListener("auxclick", blockMouseHistoryButtons, true);
    };
  }, [isHandoffActive]);

  useEffect(() => {
    if (!session.loaded || isHandoffActive) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;
    const supportsIdleCallback =
      typeof window.requestIdleCallback === "function";

    const revealFloatingLines = () => {
      if (cancelled) return;
      startTransition(() => setShowFloatingLines(true));
    };

    if (supportsIdleCallback) {
      idleId = window.requestIdleCallback(revealFloatingLines, {
        timeout: 250,
      });
    } else {
      timeoutId = setTimeout(revealFloatingLines, 120);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [session.loaded, isHandoffActive]);

  const updateAuthCardRim = useCallback((e: MouseEvent<HTMLElement>) => {
    const el = authCardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const xPct = (px / r.width) * 100;
    const yPct = (py / r.height) * 100;
    el.style.setProperty("--rim-x", `${xPct}%`);
    el.style.setProperty("--rim-y", `${yPct}%`);
  }, []);

  const clearAuthCardRim = useCallback(() => {
    const el = authCardRef.current;
    if (!el) return;
    el.style.removeProperty("--rim-x");
    el.style.removeProperty("--rim-y");
  }, []);

  if (!session.loaded) {
    return <AuthShellSkeleton />;
  }

  if (isHandoffActive) {
    return redirectTo === "/account/profile" ? (
      <AccountSkeleton />
    ) : (
      <AuthShellSkeleton />
    );
  }

  return (
    <div className="wk-auth-shell">
      <style>{AUTH_PAGE_STYLES}</style>

      <div className="wk-auth-bg" aria-hidden>
        {/* Grid first so it sits under the canvas; otherwise the mesh covers the animated lines */}
        <span className="wk-auth-grid" />
        <div className="wk-auth-floating-lines">
          {showFloatingLines ? (
            <LazyFloatingLines
              linesGradient={["#F97316", "#ee8033", "#EAB308"]}
              enabledWaves={["middle", "bottom", "top"]}
              lineCount={4}
              lineDistance={42}
              bendRadius={12}
              bendStrength={-5}
              interactive={false}
              parallax={false}
              animationSpeed={1.8}
              mixBlendMode="screen"
            />
          ) : null}
        </div>
      </div>

      <div className="wk-auth-frame">
        <aside className="wk-auth-brand" aria-hidden>
          <div className="wk-auth-brand-flame" role="presentation">
            <span className="wk-auth-flame-emoji">{"\uD83D\uDD25"}</span>
            <span className="wk-auth-flame-ring" />
            <span className="wk-auth-flame-ring wk-auth-flame-ring--slow" />
          </div>

          <h1 className="wk-auth-headline">
            {headlineRows.map((row, i) => (
              <span
                key={`${row.text}-${i}`}
                className={
                  "wk-auth-headline-row" + (row.accent ? " wk-auth-headline-row--accent" : "")
                }
              >
                {row.text}
              </span>
            ))}
          </h1>

          <p className="wk-auth-subline">{subline}</p>

          <ul className="wk-auth-feature-list">
            {features.map((feature, i) => (
              <li key={i} className="wk-auth-feature">
                <span className="wk-auth-feature-dot" />
                {feature}
              </li>
            ))}
          </ul>
        </aside>

        <main className="wk-auth-stage">
          <section
            ref={authCardRef}
            className="wk-auth-card"
            aria-label={cardAriaLabel}
            onMouseMove={updateAuthCardRim}
            onMouseEnter={updateAuthCardRim}
            onMouseLeave={clearAuthCardRim}
          >
            <div className="wk-auth-card-glow" aria-hidden />
            <div className="wk-auth-card-rim" aria-hidden />

            <div className="wk-auth-card-body">
              <CustomerAuth mode={mode} onComplete={() => setHandoffStarted(true)} />
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

          <Link
            href="/"
            className="wk-auth-back-btn"
          >
            <span className="wk-auth-back-btn-arrow" aria-hidden>
              {"\u2190"}
            </span>
            <span className="wk-auth-back-btn-label">Back to menu</span>
          </Link>
        </main>
      </div>
    </div>
  );
}

const AUTH_PAGE_STYLES = `
  .wk-auth-shell {
    position: relative;
    isolation: isolate;
    min-height: 100vh;
    overflow: hidden;
    color: #f7e9c8;
    font-family: 'DM Sans', sans-serif;
    /* Solid fill so the global app shell’s orange dot texture does not tint this page */
    background: #0a0a0a;
  }

  .wk-auth-floating-lines {
    position: absolute;
    inset: 0;
    z-index: 1;
    opacity: 0.45;
    /* Allow canvas to receive pointer events (interactive/parallax); main content still wins where it stacks above */
    pointer-events: auto;
  }

  .wk-auth-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background: linear-gradient(180deg, #0a0a0a 0%, #111111 55%, #0a0a0a 100%);
  }

  .wk-auth-grid {
    position: absolute;
    inset: 0;
    z-index: 0;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
    background-size: 56px 56px;
    mask-image: radial-gradient(circle at 50% 50%, #000 30%, transparent 80%);
    opacity: 0.55;
  }

  .wk-auth-frame {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 1fr;
    gap: 2.25rem;
    max-width: 1280px;
    margin: 0 auto;
    padding: 3rem 1.5rem 4rem;
  }

  @media (min-width: 960px) {
    .wk-auth-frame {
      grid-template-columns: minmax(0, 1fr) minmax(min(100%, 560px), 1.2fr);
      /* Top-align so welcome copy and sign-in card share the same vertical start */
      align-items: start;
      gap: 3.5rem;
      padding: 4.5rem 2rem 5rem;
    }
  }

  .wk-auth-brand {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    animation: wkAuthFadeRight 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  .wk-auth-brand-flame {
    position: relative;
    width: 86px;
    height: 86px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 0.25rem;
  }
  .wk-auth-flame-emoji {
    font-size: 44px;
    filter: drop-shadow(0 4px 18px rgba(255, 106, 0, 0.65));
    animation: wkAuthFlameBob 3.2s ease-in-out infinite;
  }
  .wk-auth-flame-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid rgba(245, 166, 35, 0.55);
    animation: wkAuthRingPulse 2.6s ease-out infinite;
  }
  .wk-auth-flame-ring--slow {
    border-color: rgba(255, 106, 0, 0.35);
    animation-duration: 4s;
    animation-delay: 0.6s;
  }

  .wk-auth-headline {
    font-family: 'Bebas Neue', 'DM Sans', sans-serif;
    font-size: clamp(3rem, 8vw, 5.5rem);
    line-height: 0.92;
    letter-spacing: 1px;
    margin: 0;
    color: #f7e9c8;
    text-shadow: 0 0 30px rgba(255, 106, 0, 0.18);
  }
  .wk-auth-headline-row {
    display: block;
    animation: wkAuthRowIn 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .wk-auth-headline-row:nth-child(2) {
    animation-delay: 0.12s;
  }
  .wk-auth-headline-row--accent {
    background: linear-gradient(120deg, #ffb347 0%, #ff6a00 50%, #ffb347 100%);
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    animation:
      wkAuthRowIn 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.12s both,
      wkAuthShimmer 6s linear infinite;
  }

  .wk-auth-subline {
    margin: 0;
    color: rgba(247, 233, 200, 0.78);
    font-size: 1.05rem;
    max-width: 30ch;
    animation: wkAuthRowIn 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.24s both;
  }

  .wk-auth-feature-list {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    animation: wkAuthRowIn 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.34s both;
  }
  .wk-auth-feature {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    color: rgba(247, 233, 200, 0.85);
    font-size: 0.95rem;
  }
  .wk-auth-feature-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: linear-gradient(135deg, #ffb347, #ff6a00);
    box-shadow: 0 0 10px rgba(255, 106, 0, 0.55);
  }

  .wk-auth-stage {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
    animation: wkAuthFadeUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }

  .wk-auth-card {
    position: relative;
    align-self: center;
    width: 100%;
    max-width: 540px;
    min-height: 380px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    border-radius: 24px;
    padding: 1.75rem 2rem 1.5rem;
    background:
      linear-gradient(180deg, rgba(20, 17, 11, 0.92) 0%, rgba(10, 10, 10, 0.94) 100%);
    border: 1px solid rgba(245, 166, 35, 0.28);
    box-shadow:
      0 30px 60px -28px rgba(0, 0, 0, 0.85),
      0 0 0 1px rgba(255, 255, 255, 0.02) inset,
      0 0 60px -20px rgba(255, 106, 0, 0.4);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    overflow: hidden;
    transition:
      transform 0.5s cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 0.45s ease;
    transform-origin: center center;
  }

  .wk-auth-card:hover {
    transform: scale(1.02);
    box-shadow:
      0 30px 60px -28px rgba(0, 0, 0, 0.85),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset,
      0 0 32px -14px rgba(249, 115, 22, 0.28),
      0 0 24px -10px rgba(238, 128, 51, 0.22),
      0 0 18px rgba(234, 179, 8, 0.2);
  }

  .wk-auth-card-glow {
    position: absolute;
    inset: -1px;
    border-radius: 24px;
    padding: 1px;
    background: conic-gradient(from 90deg, transparent 0%, rgba(245, 166, 35, 0.55) 25%, transparent 50%, rgba(255, 106, 0, 0.5) 75%, transparent 100%);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    opacity: 0.65;
    pointer-events: none;
    animation: wkAuthBorderSpin 9s linear infinite;
    transition: opacity 0.45s ease;
    z-index: 0;
  }

  /* Tight spotlight at cursor only (FloatingLines palette: #F97316, #ee8033, #EAB308) */
  .wk-auth-card-rim {
    position: absolute;
    inset: 0;
    border-radius: 24px;
    padding: 2px;
    pointer-events: none;
    z-index: 1;
    opacity: 0;
    transition: opacity 0.35s ease;
    background: radial-gradient(
      ellipse 22% 20% at var(--rim-x, 85%) var(--rim-y, 15%),
      rgba(255, 255, 255, 1) 0%,
      rgba(255, 236, 210, 0.98) 10%,
      rgba(253, 186, 116, 0.92) 20%,
      rgba(249, 115, 22, 0.88) 32%,
      rgba(238, 128, 51, 0.55) 44%,
      rgba(234, 179, 8, 0.22) 56%,
      transparent 68%
    );
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
  }

  .wk-auth-card:hover .wk-auth-card-rim {
    opacity: 1;
  }

  /* Keep the spinning amber border visible on hover (signup has more fields — users
     often stay “hovered” while typing; hiding the glow made create-account feel bare). */
  .wk-auth-card:hover .wk-auth-card-glow {
    opacity: 0.38;
  }

  .wk-auth-card > :not(.wk-auth-card-glow):not(.wk-auth-card-rim) {
    position: relative;
    z-index: 2;
  }

  .wk-auth-card-body {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
  }

  .wk-auth-login-kicker {
    margin: 0 0 0.85rem;
    color: rgba(245, 166, 35, 0.9);
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    text-align: center;
  }

  .wk-auth-redirect-title {
    margin: 0;
    color: #f7e9c8;
    font-size: 2rem;
    line-height: 1.1;
    text-align: center;
  }

  .wk-auth-redirect-copy {
    margin: 0.85rem auto 0;
    max-width: 28ch;
    color: rgba(247, 233, 200, 0.75);
    font-size: 1rem;
    text-align: center;
  }

  .wk-auth-redirect-loader {
    display: flex;
    justify-content: center;
    gap: 0.55rem;
    margin-top: 1.35rem;
  }

  .wk-auth-redirect-loader span {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: linear-gradient(135deg, #ffb347, #ff6a00);
    box-shadow: 0 0 16px rgba(255, 106, 0, 0.4);
    animation: wkAuthRedirectPulse 0.9s ease-in-out infinite;
  }

  .wk-auth-redirect-loader span:nth-child(2) {
    animation-delay: 0.12s;
  }

  .wk-auth-redirect-loader span:nth-child(3) {
    animation-delay: 0.24s;
  }

  /* Scale up embedded CustomerAuth (inline styles) for a larger sign-in panel */
  .wk-auth-card-body > div {
    max-width: none !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    gap: 1.5rem !important;
  }
  .wk-auth-card-body .wk-auth-title-row {
    width: 100%;
  }
  .wk-auth-card-body h2 {
    font-size: 2.125rem !important;
    letter-spacing: 1.5px !important;
    line-height: 1.1 !important;
    max-width: none !important;
    border-bottom: none !important;
  }
  .wk-auth-card-body label {
    font-size: 0.95rem !important;
  }
  .wk-auth-card-body input:not([placeholder="000000"]) {
    padding: 0.9rem 1.1rem !important;
    font-size: 1.0625rem !important;
    border-radius: 10px !important;
  }
  .wk-auth-card-body input[placeholder="000000"] {
    padding: 0.9rem 1rem !important;
    font-size: 1.5rem !important;
    letter-spacing: 0.35em !important;
    border-radius: 10px !important;
  }
  .wk-auth-card-body p {
    font-size: 1rem !important;
  }
  .wk-auth-card-body a {
    font-size: 1rem !important;
  }
  .wk-auth-card-body button {
    padding: 0.95rem 1.75rem !important;
    font-size: 1.0625rem !important;
    border-radius: 10px !important;
    min-height: 52px;
  }

  .wk-auth-card-fineprint {
    flex-shrink: 0;
    margin-top: auto;
    padding-top: 0.75rem;
    text-align: center;
    color: rgba(247, 233, 200, 0.45);
    font-size: 12.5px;
  }
  .wk-auth-card-link {
    color: rgba(245, 166, 35, 0.9);
    text-decoration: none;
    border-bottom: 1px dotted rgba(245, 166, 35, 0.5);
  }

  .wk-auth-back-btn {
    position: relative;
    align-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    padding: 0.55rem 0.4rem;
    margin-top: 0.5rem;
    border: none;
    background: transparent;
    color: rgba(247, 233, 200, 0.78);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    font-family: inherit;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
    transition: color 0.25s ease, transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .wk-auth-back-btn-arrow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 50%;
    font-size: 0.95rem;
    line-height: 1;
    color: #f7e9c8;
    background:
      radial-gradient(120% 120% at 30% 30%, rgba(255, 188, 116, 0.4), transparent 55%),
      rgba(245, 166, 35, 0.14);
    border: 1px solid rgba(245, 166, 35, 0.45);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      0 6px 14px -10px rgba(255, 106, 0, 0.5);
    transition:
      transform 0.35s cubic-bezier(0.22, 1, 0.36, 1),
      background 0.25s ease,
      color 0.25s ease,
      border-color 0.25s ease,
      box-shadow 0.25s ease;
  }

  .wk-auth-back-btn-label {
    position: relative;
    display: inline-block;
    padding-bottom: 2px;
    background-image: linear-gradient(
      90deg,
      rgba(249, 115, 22, 0.95) 0%,
      rgba(245, 166, 35, 0.95) 50%,
      rgba(234, 179, 8, 0.95) 100%
    );
    background-size: 0% 1.5px;
    background-repeat: no-repeat;
    background-position: 100% 100%;
    transition: background-size 0.4s cubic-bezier(0.22, 1, 0.36, 1), color 0.25s ease;
  }

  .wk-auth-back-btn:hover {
    color: #f7e9c8;
    transform: translateY(-1px);
  }

  .wk-auth-back-btn:hover .wk-auth-back-btn-arrow {
    color: #160700;
    background:
      radial-gradient(120% 120% at 30% 30%, rgba(255, 215, 165, 0.95), transparent 60%),
      linear-gradient(135deg, #ff7d12 0%, #ffbc2e 100%);
    border-color: rgba(255, 188, 116, 0.95);
    transform: translateX(-4px);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.4),
      0 10px 22px -10px rgba(255, 106, 0, 0.65);
  }

  .wk-auth-back-btn:hover .wk-auth-back-btn-label {
    background-size: 100% 1.5px;
    background-position: 0 100%;
  }

  .wk-auth-back-btn:active {
    transform: translateY(0);
  }

  .wk-auth-back-btn:focus-visible {
    outline: none;
  }

  .wk-auth-back-btn:focus-visible .wk-auth-back-btn-arrow {
    border-color: rgba(255, 188, 116, 1);
    box-shadow:
      0 0 0 3px rgba(245, 166, 35, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.25);
  }

  .wk-auth-back-btn:focus-visible .wk-auth-back-btn-label {
    background-size: 100% 1.5px;
    background-position: 0 100%;
  }

  /* Inputs and the orange CTA inside CustomerAuth get a subtle glow on focus
     without changing the component's own styles. */
  .wk-auth-card input:focus {
    border-color: rgba(245, 166, 35, 0.85) !important;
    box-shadow: 0 0 0 3px rgba(245, 166, 35, 0.15);
    outline: none;
  }

  /* ---------- keyframes ---------- */
  @keyframes wkAuthFadeUp {
    0% { opacity: 0; transform: translate3d(0, 18px, 0); }
    100% { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes wkAuthFadeRight {
    0% { opacity: 0; transform: translate3d(-18px, 0, 0); }
    100% { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes wkAuthRowIn {
    0% { opacity: 0; transform: translate3d(0, 14px, 0); }
    100% { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes wkAuthShimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  @keyframes wkAuthFlameBob {
    0%, 100% { transform: translateY(0) rotate(-2deg); }
    50% { transform: translateY(-5px) rotate(2deg); }
  }
  @keyframes wkAuthRingPulse {
    0% { transform: scale(0.85); opacity: 0.7; }
    100% { transform: scale(1.45); opacity: 0; }
  }
  @keyframes wkAuthBorderSpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes wkAuthRedirectPulse {
    0%, 100% { transform: scale(0.72); opacity: 0.55; }
    50% { transform: scale(1); opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .wk-auth-back-btn,
    .wk-auth-back-btn-arrow,
    .wk-auth-back-btn-label {
      transition: none !important;
    }
    .wk-auth-back-btn:hover,
    .wk-auth-back-btn:active {
      transform: none !important;
    }
    .wk-auth-back-btn:hover .wk-auth-back-btn-arrow {
      transform: none !important;
    }
    .wk-auth-back-btn:hover .wk-auth-back-btn-label,
    .wk-auth-back-btn:focus-visible .wk-auth-back-btn-label {
      background-size: 100% 1.5px !important;
    }
    .wk-auth-flame-emoji,
    .wk-auth-flame-ring,
    .wk-auth-card-glow,
    .wk-auth-redirect-loader span,
    .wk-auth-headline-row--accent,
    .wk-auth-brand,
    .wk-auth-stage,
    .wk-auth-headline-row,
    .wk-auth-subline,
    .wk-auth-feature-list {
      animation: none !important;
    }
    .wk-auth-card-rim {
      opacity: 0 !important;
      transition: none !important;
    }
    .wk-auth-card:hover .wk-auth-card-glow {
      opacity: 0.48 !important;
    }
    .wk-auth-card {
      transition: box-shadow 0.45s ease;
    }
    .wk-auth-card:hover {
      transform: none;
    }
  }
`;
