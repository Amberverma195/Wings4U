/**
 * Loading skeleton for /auth/login + /auth/signup. Mirrors the structure
 * of <AuthShell /> exactly (same wrapper / grid / column / card classes)
 * so the page snaps into place without any visual jump once the real
 * client component hydrates.
 *
 * Rendered from the route-level loading.tsx files, which Next.js wraps
 * around the page in a <Suspense> boundary automatically.
 */
export function AuthShellSkeleton() {
  return (
    <div
      className="wk-auth-shell wk-auth-shell--skeleton"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="wk-skel-sr">Loading sign-in…</span>
      <style>{AUTH_SKELETON_STYLES}</style>

      <div className="wk-auth-bg" aria-hidden>
        <span className="wk-auth-grid" />
      </div>

      <div className="wk-auth-frame">
        {/* Left column: brand / headline / features */}
        <aside className="wk-auth-brand" aria-hidden>
          <div className="wk-auth-brand-flame">
            <span className="wk-auth-flame-emoji">{"\uD83D\uDD25"}</span>
            <span className="wk-auth-flame-ring" />
          </div>

          <h1 className="wk-auth-headline">
            <span className="wk-skel-headline-row wk-skeleton-block" />
            <span className="wk-skel-headline-row wk-skel-headline-row--short wk-skeleton-block" />
          </h1>

          <p className="wk-auth-subline">
            <span className="wk-skel-line wk-skeleton-block" />
            <span className="wk-skel-line wk-skel-line--short wk-skeleton-block" />
          </p>

          <ul className="wk-auth-feature-list">
            <li className="wk-auth-feature">
              <span className="wk-auth-feature-dot" />
              <span className="wk-skel-feature wk-skeleton-block" />
            </li>
            <li className="wk-auth-feature">
              <span className="wk-auth-feature-dot" />
              <span className="wk-skel-feature wk-skel-feature--mid wk-skeleton-block" />
            </li>
            <li className="wk-auth-feature">
              <span className="wk-auth-feature-dot" />
              <span className="wk-skel-feature wk-skel-feature--short wk-skeleton-block" />
            </li>
          </ul>
        </aside>

        {/* Right column: card stage */}
        <main className="wk-auth-stage">
          <section
            className="wk-auth-card wk-auth-card--skeleton"
            aria-hidden
          >
            <div className="wk-auth-card-glow" aria-hidden />

            <div className="wk-auth-card-body">
              <span className="wk-skel-title wk-skeleton-block" />
              <div className="wk-skel-field">
                <span className="wk-skel-label wk-skeleton-block" />
                <span className="wk-skel-input wk-skeleton-block" />
              </div>
              <span className="wk-skel-cta wk-skeleton-block" />
              <span className="wk-skel-helper wk-skeleton-block" />
            </div>

            <div className="wk-auth-card-fineprint">
              <span className="wk-skel-fineprint wk-skeleton-block" />
            </div>
          </section>

          <span className="wk-skel-back wk-skeleton-block" />
        </main>
      </div>
    </div>
  );
}

const AUTH_SKELETON_STYLES = `
  .wk-skel-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* ----- Layout (mirrors AuthShell exactly so the page swap is seamless) ----- */
  .wk-auth-shell--skeleton {
    position: relative;
    isolation: isolate;
    min-height: calc(100vh - 64px);
    overflow: hidden;
    color: #f7e9c8;
    font-family: 'DM Sans', sans-serif;
    background: #0a0a0a;
  }

  .wk-auth-shell--skeleton .wk-auth-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background: linear-gradient(180deg, #0a0a0a 0%, #111111 55%, #0a0a0a 100%);
  }

  .wk-auth-shell--skeleton .wk-auth-grid {
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

  .wk-auth-shell--skeleton .wk-auth-frame {
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
    .wk-auth-shell--skeleton .wk-auth-frame {
      grid-template-columns: minmax(0, 1fr) minmax(min(100%, 560px), 1.2fr);
      align-items: start;
      gap: 3.5rem;
      padding: 4.5rem 2rem 5rem;
    }
  }

  .wk-auth-shell--skeleton .wk-auth-brand {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
  }

  .wk-auth-shell--skeleton .wk-auth-brand-flame {
    position: relative;
    width: 86px;
    height: 86px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 0.25rem;
  }

  .wk-auth-shell--skeleton .wk-auth-flame-emoji {
    font-size: 44px;
    opacity: 0.4;
    filter: drop-shadow(0 4px 18px rgba(255, 106, 0, 0.45));
  }

  .wk-auth-shell--skeleton .wk-auth-flame-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid rgba(245, 166, 35, 0.32);
  }

  .wk-auth-shell--skeleton .wk-auth-headline {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    /* match the rendered headline height (clamp 3rem-5.5rem * 2 rows ~= 6-11rem) */
    min-height: clamp(5.5rem, 16vw, 10rem);
  }

  .wk-skel-headline-row {
    display: block;
    height: clamp(2.6rem, 7vw, 4.6rem);
    width: 70%;
    border-radius: 8px;
  }

  .wk-skel-headline-row--short {
    width: 45%;
  }

  .wk-auth-shell--skeleton .wk-auth-subline {
    margin: 0;
    max-width: 30ch;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .wk-skel-line {
    display: block;
    height: 14px;
    width: 100%;
    border-radius: 6px;
  }

  .wk-skel-line--short {
    width: 70%;
  }

  .wk-auth-shell--skeleton .wk-auth-feature-list {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .wk-auth-shell--skeleton .wk-auth-feature {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .wk-auth-shell--skeleton .wk-auth-feature-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: linear-gradient(135deg, rgba(255, 179, 71, 0.55), rgba(255, 106, 0, 0.55));
    box-shadow: 0 0 10px rgba(255, 106, 0, 0.35);
  }

  .wk-skel-feature {
    display: block;
    flex: 0 0 auto;
    height: 14px;
    width: 220px;
    border-radius: 6px;
  }

  .wk-skel-feature--mid {
    width: 180px;
  }

  .wk-skel-feature--short {
    width: 240px;
  }

  /* Card stage */
  .wk-auth-shell--skeleton .wk-auth-stage {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .wk-auth-card--skeleton {
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
  }

  .wk-auth-card--skeleton .wk-auth-card-glow {
    position: absolute;
    inset: -1px;
    border-radius: 24px;
    padding: 1px;
    background: conic-gradient(
      from 90deg,
      transparent 0%,
      rgba(245, 166, 35, 0.55) 25%,
      transparent 50%,
      rgba(255, 106, 0, 0.5) 75%,
      transparent 100%
    );
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    opacity: 0.5;
    pointer-events: none;
    animation: wkAuthBorderSpin 9s linear infinite;
    z-index: 0;
  }

  .wk-auth-card--skeleton > :not(.wk-auth-card-glow) {
    position: relative;
    z-index: 2;
  }

  .wk-auth-card--skeleton .wk-auth-card-body {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .wk-skel-title {
    display: block;
    height: 36px;
    width: 70%;
    margin: 0 auto;
    border-radius: 10px;
  }

  .wk-skel-field {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .wk-skel-label {
    display: block;
    height: 14px;
    width: 35%;
    border-radius: 6px;
  }

  .wk-skel-input {
    display: block;
    height: 52px;
    width: 100%;
    border-radius: 10px;
  }

  .wk-skel-cta {
    display: block;
    height: 52px;
    width: 100%;
    border-radius: 10px;
    background: linear-gradient(
      90deg,
      rgba(255, 122, 26, 0.22) 0%,
      rgba(255, 178, 64, 0.32) 46%,
      rgba(255, 122, 26, 0.22) 100%
    );
    background-size: 200% 100%;
    animation: wkSkeletonShimmer 1.2s linear infinite;
  }

  .wk-skel-helper {
    display: block;
    height: 14px;
    width: 50%;
    margin: 0 auto;
    border-radius: 6px;
  }

  .wk-auth-card--skeleton .wk-auth-card-fineprint {
    flex-shrink: 0;
    margin-top: auto;
    padding-top: 0.75rem;
    text-align: center;
  }

  .wk-skel-fineprint {
    display: inline-block;
    height: 12px;
    width: 60%;
    border-radius: 6px;
  }

  .wk-skel-back {
    align-self: center;
    display: block;
    height: 18px;
    width: 140px;
    margin-top: 0.5rem;
    border-radius: 9px;
  }

  @keyframes wkAuthBorderSpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .wk-auth-card--skeleton .wk-auth-card-glow,
    .wk-skel-cta {
      animation: none !important;
    }
  }
`;
