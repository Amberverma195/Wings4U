export function WingKingsGlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Black+Han+Sans&family=DM+Sans:wght@400;600&family=Libre+Baskerville:wght@700&family=Oswald:wght@400;600;700&family=Outfit:wght@500;800&family=Poppins:wght@500;800&family=Rajdhani:wght@500;600;700&display=swap');
      @keyframes float { 0%,100%{transform:translate3d(0,0,0)} 50%{transform:translate3d(0,-18px,0)} }
      @keyframes gentleFloat {
        0%,100% { transform: translateY(0) rotate(-3deg); }
        50% { transform: translateY(-14px) rotate(3deg); }
      }
      @keyframes pulseGlow {
        0%,
        100% {
          opacity: 0.6;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.1);
        }
      }
      @keyframes spotlightBtnShine {
        0% {
          transform: translateX(-100%) skewX(-18deg);
          opacity: 0;
        }
        25% {
          opacity: 0.85;
        }
        100% {
          transform: translateX(100%) skewX(-18deg);
          opacity: 0;
        }
      }
      @keyframes slideLeft { 0%{transform:translateX(-140%) skewX(-12deg);opacity:0} 100%{transform:translateX(0) skewX(-12deg);opacity:1} }
      @keyframes slideFireLeft { 0%{transform:translate3d(-120%,0,0) skewX(-10deg);opacity:0} 100%{transform:translate3d(0,0,0) skewX(0deg);opacity:1} }
      @keyframes slideFireRight { 0%{transform:translate3d(120%,0,0) skewX(10deg);opacity:0} 100%{transform:translate3d(0,0,0) skewX(0deg);opacity:1} }
      @keyframes heroTitleIn { 0%{transform:perspective(700px) rotateX(90deg) translate3d(0,-80px,0);opacity:0} 100%{transform:perspective(700px) rotateX(0deg) translate3d(0,0,0);opacity:1} }
      @keyframes heroTitleShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      @keyframes heroTitleGlitch {
        0%,88%,100%{transform:translate3d(0,0,0)}
        89%{transform:translate3d(-4px,1px,0)}
        91%{transform:translate3d(4px,-2px,0)}
        93%{transform:translate3d(-2px,3px,0)}
        95%{transform:translate3d(3px,-1px,0)}
        96%,99%{transform:translate3d(0,0,0)}
      }
      @keyframes orbitSpin1 { from { transform: rotate(0deg) translateX(140px) rotate(0deg); } to { transform: rotate(360deg) translateX(140px) rotate(-360deg); } }
      @keyframes orbitSpin2 { from { transform: rotate(0deg) translateX(170px) rotate(0deg); } to { transform: rotate(360deg) translateX(170px) rotate(-360deg); } }
      @keyframes orbitSpin3 { from { transform: rotate(0deg) translateX(110px) rotate(0deg); } to { transform: rotate(360deg) translateX(110px) rotate(-360deg); } }
      @keyframes heroGlowOuterPulse {
        0%,100% { opacity: 0.55; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.12); }
      }
      @keyframes heroGlowInnerPulse {
        0%,100% { opacity: 0.55; transform: scale(1); }
        50% { opacity: 0.92; transform: scale(1.08); }
      }
      @keyframes fadeSlideUp { 0%{transform:translate3d(0,40px,0);opacity:0} 100%{transform:translate3d(0,0,0);opacity:1} }
      @keyframes fadeUp {
        0% { opacity: 0; transform: translateY(50px); }
        100% { opacity: 1; transform: translateY(0); }
      }

      /* Reserve space for the vertical scrollbar so content (e.g. hero proof strip) is not tucked under it on tablet/desktop. */
      html {
        scrollbar-gutter: stable;
      }

      /* Dotless-i + yellow bar: same proportions on hero (Black Han Sans) and nav (Bebas Neue).
         Em units are relative to the stem’s font size. */
      .hero-title-wing-i,
      .nav-brand-wing-i {
        --wing-i-dot-width: 0.25em;
        --wing-i-dot-height: 0.12em;
        --wing-i-dot-left: 45%;
        --wing-i-dot-top: 0.08em;
        display: inline-block;
        vertical-align: baseline;
        white-space: nowrap;
      }

      .hero-title-wing-i__stem,
      .nav-brand-wing-i__stem {
        position: relative;
        display: inline-block;
        vertical-align: baseline;
        line-height: 1;
        overflow: visible;
        color: inherit;
        font-weight: 900;
        -webkit-text-stroke: 0.045em #fff;
        paint-order: stroke fill;
      }

      /* Shorter stem only in nav; dot still uses stem font-size so yellow bar em values stay the same. */
      .nav-brand-wing-i__glyph {
        display: inline-block;
        font-size: 0.70em;
        vertical-align: baseline;
      }

      .hero-title-wing-i__dot,
      .nav-brand-wing-i__dot {
        position: absolute;
        left: var(--wing-i-dot-left);
        top: var(--wing-i-dot-top);
        transform: translateX(-50%);
        width: var(--wing-i-dot-width);
        height: var(--wing-i-dot-height);
        border-radius: 0;
        background: #fed400;
        pointer-events: none;
      }

      .hero-proof {
        display: flex;
        flex-wrap: nowrap;
        gap: 0;
        margin-top: 52px;
        margin-bottom: clamp(20px, 3vw, 36px);
        border-left: 2px solid rgba(255, 77, 0, 0.3);
        animation: fadeUp 0.9s cubic-bezier(0.23, 1, 0.32, 1) 0.75s both;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        -ms-overflow-style: none;
        box-sizing: border-box;
        padding-inline-end: max(12px, env(safe-area-inset-right, 0px));
        scroll-padding-inline-end: max(12px, env(safe-area-inset-right, 0px));
      }

      /* Flex scrollports often ignore padding for the scrollable extent; a trailing spacer reliably clears the last column past the viewport edge / scrollbar. */
      .hero-proof::after {
        content: '';
        flex: 0 0 max(20px, env(safe-area-inset-right, 0px));
        width: max(20px, env(safe-area-inset-right, 0px));
        min-height: 1px;
        align-self: stretch;
      }

      .hero-proof::-webkit-scrollbar {
        display: none;
      }

      /* Flex item beside the hero visual: allow shrinking so proof strip stays in the column (avoids clipping at the shell edge). */
      .wk-hero-content {
        min-width: 0;
        box-sizing: border-box;
      }

      .hero-proof-item {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 10px 28px;
        border-right: 1px solid #1e0900;
        white-space: nowrap;
      }

      .hero-proof-item:last-child {
        border-right: none;
      }

      .hero-proof-label {
        font-size: 11px;
        color: #ffd500;
        letter-spacing: 2px;
        font-weight: 700;
        text-transform: uppercase;
        margin-bottom: 6px;
      }

      .hero-proof-val {
        font-family: 'Oswald', sans-serif;
        font-size: 18px;
        font-weight: 700;
        color: #ff6b00;
        text-align: center;
      }

      /* Slides in from left, holds, slides back out — loops (see prefers-reduced-motion) */
      @keyframes heroNewsletterPromoPeek {
        0% {
          transform: translate3d(-120%, 0, 0);
          opacity: 0;
        }
        10% {
          opacity: 1;
        }
        18% {
          transform: translate3d(0, 0, 0);
          opacity: 1;
        }
        52% {
          transform: translate3d(0, 0, 0);
          opacity: 1;
        }
        68% {
          opacity: 1;
        }
        82% {
          transform: translate3d(-120%, 0, 0);
          opacity: 0;
        }
        100% {
          transform: translate3d(-120%, 0, 0);
          opacity: 0;
        }
      }

      .hero-newsletter-promo {
        margin-top: clamp(6px, 1.8vw, 18px);
        margin-bottom: clamp(2px, 1vw, 12px);
        width: 100%;
        max-width: 100%;
        min-height: 56px;
        overflow: hidden;
      }

      .hero-newsletter-promo__box {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        padding: 10px 18px 10px 22px;
        max-width: 100%;
        cursor: pointer;
        border: 1px solid rgba(255, 107, 0, 0.45);
        border-radius: 4px;
        background: linear-gradient(135deg, rgba(4, 1, 0, 0.96) 0%, rgba(14, 6, 0, 0.98) 100%);
        box-shadow:
          0 0 0 1px rgba(255, 140, 0, 0.1),
          0 8px 28px rgba(0, 0, 0, 0.45);
        clip-path: polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%);
        transition: box-shadow 0.2s ease, border-color 0.2s ease;
        animation: heroNewsletterPromoPeek 11s ease-in-out infinite;
        text-align: left;
        font: inherit;
        will-change: transform, opacity;
      }

      .hero-newsletter-promo__box:hover {
        animation-play-state: paused;
        border-color: rgba(255, 166, 35, 0.65);
        box-shadow:
          0 0 0 1px rgba(255, 140, 0, 0.22),
          0 12px 36px rgba(255, 80, 0, 0.2);
      }

      .hero-newsletter-promo__box:focus-visible {
        outline: 2px solid #ffaa00;
        outline-offset: 3px;
      }

      .hero-newsletter-promo__text {
        font-family: 'Black Han Sans', sans-serif;
        font-size: clamp(15px, 2vw, 19px);
        letter-spacing: 0.12em;
        color: #ffd102;
        font-weight: 800;
        line-height: 1.1;
      }

      .hero-newsletter-promo__chick {
        font-size: clamp(32px, 4.5vw, 44px);
        line-height: 1;
        filter: drop-shadow(0 2px 8px rgba(255, 120, 0, 0.35));
        flex-shrink: 0;
      }

      @media (prefers-reduced-motion: reduce) {
        .hero-newsletter-promo {
          overflow: visible;
          min-height: 0;
        }

        .hero-newsletter-promo__box {
          animation: none;
          opacity: 1;
          transform: none;
        }
      }

      @keyframes fireSweep { 0%{transform:translate3d(-150%,0,0) skewX(-20deg);opacity:0} 15%{opacity:0.85} 100%{transform:translate3d(220%,0,0) skewX(-20deg);opacity:0} }
      @keyframes wkSkeletonShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

      .hero-visual-glow {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,120,0,0.38) 0%, rgba(255,70,0,0.18) 40%, rgba(255,40,0,0.06) 65%, transparent 80%);
        opacity: 0.55;
        animation: heroGlowOuterPulse 4s ease-in-out infinite;
      }

      .hero-visual-glow-inner {
        position: absolute;
        inset: 20%;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,160,30,0.3) 0%, transparent 70%);
        opacity: 0.55;
        animation: heroGlowInnerPulse 3s ease-in-out infinite;
        animation-delay: 0.5s;
      }

      .hero-orbit-ring {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }

      .hero-orbit-item {
        position: absolute;
        top: 50%;
        left: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 52px;
        filter: drop-shadow(0 0 16px rgba(255,100,0,0.35));
        transform-origin: center;
        will-change: transform;
      }

      .hero-orbit-item--bolt {
        animation: orbitSpin1 8s linear infinite;
      }

      .hero-orbit-item--pepper {
        font-size: 60px;
        animation: orbitSpin2 11s linear infinite;
        animation-delay: -3s;
      }

      .hero-orbit-item--fire {
        font-size: 52px;
        animation: orbitSpin3 14s linear infinite;
        animation-delay: -7s;
      }

      /* Phones: hide decorative wing / orbit cluster — saves space, less visual noise */
      @media (max-width: 1528px) and (min-width: 769px) {
        .wk-landing-hero {
          gap: clamp(18px, 2.8vw, 40px);
          padding-top: clamp(1.75rem, 3vw, 2.5rem) !important;
        }

        .wk-hero-visual-column {
          width: clamp(300px, 34vw, 500px) !important;
          height: clamp(300px, 34vw, 500px) !important;
          margin-right: 0 !important;
        }
      }

      @media (max-width: 1360px) and (min-width: 1261px) {
        .hero-proof {
          overflow: visible;
          padding-inline-end: 0;
          scroll-padding-inline-end: 0;
        }

        .hero-proof::after {
          display: none;
        }

        .hero-proof-item {
          flex: 1 1 0;
          min-width: 0;
          padding: 10px 16px;
        }

        .hero-proof-label {
          font-size: 10px;
          letter-spacing: 1.5px;
          white-space: normal;
          overflow-wrap: anywhere;
        }

        .hero-proof-val {
          font-size: clamp(15px, 1.45vw, 18px);
          line-height: 1.15;
          white-space: normal;
          text-wrap: balance;
        }
      }

      @media (max-width: 1260px) and (min-width: 769px) {
        .hero-proof {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0;
          overflow: visible;
          border-left: none;
          border-top: 2px solid rgba(255, 77, 0, 0.3);
          margin-top: 36px;
          padding-top: 6px;
          padding-inline-end: 0;
          scroll-padding-inline-end: 0;
        }

        .hero-proof::after {
          display: none;
        }

        .hero-proof-item {
          min-width: 0;
          align-items: flex-start;
          text-align: left;
          padding: 14px 18px 14px 0;
          border-right: none;
          border-bottom: 1px solid rgba(30, 9, 0, 0.75);
          white-space: normal;
        }

        .hero-proof-item:nth-child(odd) {
          padding-right: 22px;
        }

        .hero-proof-item:nth-last-child(-n + 2) {
          border-bottom: none;
        }

        .hero-proof-label,
        .hero-proof-val {
          text-align: left;
        }
      }

      @media (max-width: 768px) {
        .wk-hero-visual-column {
          display: none !important;
        }

        .wk-landing-hero {
          flex-direction: column;
          align-items: stretch;
        }

        .wk-hero-content {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }

        .hero-proof {
          flex-direction: column;
          flex-wrap: nowrap;
          align-items: stretch;
          overflow-x: visible;
          overflow-y: visible;
          border-left: none;
          border-top: 2px solid rgba(255, 77, 0, 0.3);
          margin-top: 40px;
          padding-top: 6px;
          padding-inline-end: 0;
          scroll-padding-inline-end: 0;
        }

        .hero-proof::after {
          display: none;
        }

        .hero-proof-item {
          flex: 0 0 auto;
          width: 100%;
          max-width: 100%;
          align-items: flex-start;
          text-align: left;
          padding: 14px 0;
          border-right: none;
          border-bottom: 1px solid rgba(30, 9, 0, 0.75);
          white-space: normal;
        }

        .hero-proof-item:last-child {
          border-bottom: none;
        }

        .hero-proof-label {
          white-space: normal;
        }

        .hero-proof-val {
          text-align: left;
        }
      }

      /* ── Hero category marquee (8 items × 5 copies) ───────────────────── */
      .wk-landing-marquee-slot {
        padding-top: clamp(14px, 2vw, 22px);
        margin-bottom: clamp(28px, 5vw, 64px);
      }

      .wk-landing-marquee-slot .wk-hero-marquee {
        margin-top: 0;
      }

      @media (max-width: 768px) {
        .wk-landing-marquee-slot {
          padding-top: 12px;
          margin-bottom: clamp(20px, 6vw, 32px);
        }
      }

      .wk-hero-marquee {
        width: 100%;
        margin-top: clamp(28px, 4.5vw, 52px);
        padding: 14px 0;
        background: #040100;
        border-top: 1px solid rgba(245, 166, 35, 0.14);
        box-sizing: border-box;
        opacity: 0;
        transform: translateY(64px);
        transition:
          opacity 0.9s cubic-bezier(0.23, 1, 0.32, 1),
          transform 0.9s cubic-bezier(0.23, 1, 0.32, 1);
        will-change: opacity, transform;
      }

      .wk-hero-marquee--in-view {
        opacity: 1;
        transform: translateY(0);
      }

      .wk-hero-marquee:not(.wk-hero-marquee--in-view) .wk-hero-marquee-track {
        animation-play-state: paused;
      }

      .wk-hero-marquee-viewport {
        overflow: hidden;
        width: 100%;
        max-width: none;
        margin-inline: 0;
        /* Full-bleed strip — no side fade masks (avoids empty-looking gutters) */
        mask-image: none;
        -webkit-mask-image: none;
      }

      .wk-hero-marquee-track {
        display: flex;
        flex-direction: row;
        flex-wrap: nowrap;
        width: max-content;
        will-change: transform;
        /* Right-to-left scroll: content moves toward the left */
        animation: wkHeroMarqueeScroll 14s linear infinite;
      }

      @keyframes wkHeroMarqueeScroll {
        from { transform: translateX(0); }
        to { transform: translateX(-20%); }
      }

      @media (prefers-reduced-motion: reduce) {
        .wk-hero-marquee {
          opacity: 1;
          transform: none;
          transition: none;
        }

        .wk-hero-marquee-track {
          animation: none;
        }
      }

      .wk-hero-marquee-chunk {
        display: inline-flex;
        flex: 0 0 auto;
        flex-wrap: nowrap;
        align-items: baseline;
        white-space: nowrap;
        padding-right: 1.5rem;
      }

      .wk-hero-marquee-item-wrap {
        display: inline-flex;
        align-items: baseline;
        white-space: nowrap;
      }

      .wk-hero-marquee-item {
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: clamp(18px, 2.35vw, 24px);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .wk-hero-marquee-item--ghost {
        font-weight: 500;
      }

      .wk-hero-marquee-item--accent {
        color: #f5a623;
        font-weight: 800;
        text-shadow: none;
      }

      .wk-hero-marquee-emoji {
        font-size: 1em;
        margin-right: 0.15em;
        filter: none;
      }

      .wk-hero-marquee-sep {
        display: inline-block;
        margin: 0 1.35rem;
        color: rgba(255, 140, 0, 0.42);
        font-weight: 300;
        user-select: none;
      }

      /* ── Brand section (#brand) ───────────────────────────────────────── */
      #brand.brand-section {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 80px;
        align-items: center;
        padding: 72px 7% 100px;
        max-width: 100%;
        box-sizing: border-box;
      }

      @media (max-width: 960px) {
        #brand.brand-section {
          grid-template-columns: 1fr;
          gap: 48px;
          padding: 56px 6% 72px;
        }
      }

      @media (max-width: 768px) {
        #brand.brand-section {
          grid-template-columns: minmax(0, 1fr);
          width: 100%;
          max-width: 100%;
          padding: 64px clamp(1rem, 5vw, 1.5rem);
          box-sizing: border-box;
        }

        #brand.brand-section > * {
          min-width: 0;
          width: 100%;
          max-width: 100%;
        }

        .brand-numbers {
          width: 100%;
        }

        .brand-stat {
          grid-template-columns: minmax(0, 92px) minmax(0, 1fr);
          column-gap: 14px;
          padding: 20px 0;
          width: 100%;
        }

        .brand-stat-num {
          font-size: clamp(40px, 11vw, 56px);
        }

        .brand-stat-label {
          font-size: 13px;
          letter-spacing: 1.2px;
          line-height: 1.3;
        }

        #sauces.sauces-section {
          padding-left: clamp(1rem, 5vw, 1.5rem);
          padding-right: clamp(1rem, 5vw, 1.5rem);
        }

        .sauce-count-wrapper {
          flex-direction: column;
          gap: 12px;
          width: 100%;
        }

        .sauce-count-sub {
          align-items: center;
          text-align: center;
        }
      }

      .wk-shell-main {
        overflow-x: hidden;
        max-width: 100%;
        min-width: 0;
      }

      /* Prefer clip: unlike hidden, it does not create the scroll containment that breaks position:sticky in many browsers. */
      @supports (overflow: clip) {
        .wk-shell-main {
          overflow-x: clip;
        }
      }

      .brand-numbers {
        display: flex;
        flex-direction: column;
      }

      .brand-numbers.reveal-left {
        opacity: 0;
        transform: translateX(-60px);
        transition:
          opacity 0.8s cubic-bezier(0.23, 1, 0.32, 1),
          transform 0.8s cubic-bezier(0.23, 1, 0.32, 1);
      }

      .brand-numbers.reveal-left.is-visible {
        opacity: 1;
        transform: translateX(0);
      }

      .brand-copy.reveal-right {
        opacity: 0;
        transform: translateX(60px);
        transition:
          opacity 0.8s cubic-bezier(0.23, 1, 0.32, 1),
          transform 0.8s cubic-bezier(0.23, 1, 0.32, 1);
      }

      .brand-copy.reveal-right.is-visible {
        opacity: 1;
        transform: translateX(0);
      }

      @media (prefers-reduced-motion: reduce) {
        .brand-numbers.reveal-left,
        .brand-copy.reveal-right {
          opacity: 1;
          transform: none;
          transition: none;
        }
      }

      .brand-stat {
        display: grid;
        grid-template-columns: minmax(120px, 180px) minmax(0, 1fr);
        align-items: center;
        column-gap: 28px;
        padding: 28px 0;
        border-bottom: 1px solid rgba(255, 140, 0, 0.55);
      }

      .brand-stat:first-child {
        border-top: 1px solid rgba(255, 140, 0, 0.55);
      }

      .brand-stat-num {
        grid-column: 1;
        justify-self: start;
        font-family: 'Black Han Sans', sans-serif;
        font-size: clamp(52px, 6vw, 80px);
        line-height: 1;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        box-sizing: border-box;
      }

      .brand-stat-num--gradient {
        color: transparent;
        background: linear-gradient(135deg, #ff4d00, #ffd500);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .brand-stat-label {
        grid-column: 2;
        min-width: 0;
        padding-left: 0;
        font-family: 'Oswald', sans-serif;
        font-size: 16px;
        color: #ffd500;
        letter-spacing: 2px;
        text-transform: uppercase;
        line-height: 1.35;
        text-align: left;
      }

      #brand .section-label {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 4px;
        color: #ffcc33;
        text-transform: uppercase;
        margin: 0 0 14px;
      }

      .brand-heading {
        font-family: 'Black Han Sans', sans-serif;
        font-size: clamp(38px, 4.5vw, 60px);
        line-height: 1.05;
        letter-spacing: 2px;
        color: #fff;
        text-transform: uppercase;
        margin: 0 0 20px;
      }

      .brand-heading-line {
        display: block;
      }

      .brand-heading .gradient-text {
        background: linear-gradient(90deg, #ff4d00, #ffd500);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
      }

      .brand-body {
        font-size: 17px;
        color: #ffd966;
        line-height: 1.75;
        margin: 0 0 20px;
      }

      .brand-body strong {
        color: #ffd500;
        font-weight: 700;
      }

      .brand-tag {
        display: inline-block;
        margin: 8px 0 0;
        padding: 12px 20px;
        background: #120600;
        border: 1px solid #1e0900;
        border-radius: 6px;
        font-size: 15px;
        color: #ffcc33;
        font-weight: 700;
        letter-spacing: 1px;
        text-decoration: none;
        cursor: pointer;
        transition: border-color 0.2s ease, background 0.2s ease;
      }

      .brand-tag:hover {
        border-color: rgba(255, 107, 0, 0.45);
        background: #160800;
      }

      .brand-tag:focus-visible {
        outline: 2px solid rgba(255, 140, 0, 0.6);
        outline-offset: 2px;
      }

      /* ── Sauces section (#sauces) ─────────────────────────────────────── */
      @keyframes countUpSauceHero {
        0% {
          opacity: 0;
          transform: scale(0.4) rotateX(90deg);
          filter: blur(12px);
        }
        50% {
          opacity: 1;
          transform: scale(1.15) rotateX(-5deg);
          filter: blur(0) drop-shadow(0 0 40px rgba(255, 150, 0, 0.35))
            drop-shadow(0 0 80px rgba(255, 100, 0, 0.2));
        }
        70% {
          transform: scale(0.95) rotateX(2deg);
          filter: blur(0) drop-shadow(0 0 40px rgba(255, 150, 0, 0.35))
            drop-shadow(0 0 80px rgba(255, 100, 0, 0.2));
        }
        100% {
          opacity: 1;
          transform: scale(1) rotateX(0deg);
          filter: blur(0) drop-shadow(0 0 40px rgba(255, 150, 0, 0.35))
            drop-shadow(0 0 80px rgba(255, 100, 0, 0.2));
        }
      }

      @keyframes pulseRing {
        0%,
        100% {
          transform: scale(0.8);
          opacity: 0.6;
        }
        50% {
          transform: scale(1.4);
          opacity: 0;
        }
      }

      @keyframes sauceCarousel {
        from {
          transform: translateX(0);
        }
        to {
          transform: translateX(-50%);
        }
      }

      #sauces.sauces-section {
        padding: 100px 7% 80px;
        background: #080200;
        overflow: hidden;
      }

      .sauce-header.reveal {
        opacity: 0;
        transform: translateY(60px);
        transition:
          opacity 0.8s cubic-bezier(0.23, 1, 0.32, 1),
          transform 0.8s cubic-bezier(0.23, 1, 0.32, 1);
      }

      .sauce-header.reveal--visible {
        opacity: 1;
        transform: translateY(0);
      }

      .sauces-section .sauces-section-label {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 3.5px;
        color: #ffcc33;
        text-transform: uppercase;
        margin: 0 0 clamp(18px, 2.8svh, 26px);
        text-align: center;
      }

      /* Same layout as .wk-section-heading::after (menu category titles), orange–gold for dark bg */
      .sauces-section .sauces-section-label::after {
        content: '';
        display: block;
        width: min(240px, 72%);
        height: 2px;
        margin: clamp(10px, 1.4svh, 14px) auto 0;
        border-radius: 2px;
        background: linear-gradient(
          90deg,
          rgba(255, 77, 0, 0) 0%,
          rgba(255, 140, 60, 0.75) 18%,
          #ffbf00 50%,
          rgba(255, 107, 0, 0.85) 82%,
          rgba(255, 77, 0, 0) 100%
        );
        box-shadow: 0 0 14px rgba(255, 191, 0, 0.35);
      }

      .sauce-count-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 20px;
        flex-wrap: wrap;
        perspective: 1000px;
      }

      .sauce-count-hero {
        position: relative;
        display: inline-block;
        font-family: 'Black Han Sans', sans-serif;
        font-size: clamp(88px, 12vw, 160px);
        line-height: 1;
        color: transparent;
        background: linear-gradient(135deg, #ff4d00, #ffd500, #ffaa00);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        filter: drop-shadow(0 0 40px rgba(255, 150, 0, 0.35))
          drop-shadow(0 0 80px rgba(255, 100, 0, 0.2));
        opacity: 0;
        transform-style: preserve-3d;
      }

      .sauce-count-hero--play {
        animation: countUpSauceHero 1s cubic-bezier(0.23, 1, 0.32, 1) forwards;
      }

      .sauce-count-hero::after {
        content: '';
        position: absolute;
        inset: -20px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255, 180, 50, 0.15), transparent 70%);
        animation: pulseRing 2.5s ease-in-out infinite;
        pointer-events: none;
        z-index: -1;
      }

      .sauce-count-sub {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        text-align: left;
      }

      .sauce-count-sub-main {
        font-family: 'Black Han Sans', sans-serif;
        font-size: clamp(28px, 3.5vw, 48px);
        letter-spacing: 4px;
        color: #fff;
        text-transform: uppercase;
      }

      .sauce-zero-excuses {
        font-family: 'Oswald', sans-serif;
        font-size: clamp(14px, 1.6vw, 20px);
        letter-spacing: 6px;
        color: #ffcc33;
        text-transform: uppercase;
        margin-top: 6px;
      }

      .sauce-carousel-wrapper {
        --sauce-card: clamp(148px, 11vw, 182px);
        --sauce-gap: 14px;
        --sauce-edge: clamp(160px, 14vw, 260px);
        position: relative;
        margin-top: 36px;
        margin-left: auto;
        margin-right: auto;
        max-width: min(
          calc(7 * (var(--sauce-card) + var(--sauce-gap)) - var(--sauce-gap) + 2 * var(--sauce-edge)),
          100%
        );
        overflow: hidden;
        padding: 8px 0 24px;
        isolation: isolate;
        opacity: 0;
        transform: scale(0.3) translateY(60px);
        transition:
          opacity 0.9s cubic-bezier(0.23, 1, 0.32, 1),
          transform 0.9s cubic-bezier(0.23, 1, 0.32, 1);
      }

      .sauce-carousel-wrapper--in {
        opacity: 1;
        transform: scale(1) translateY(0);
      }

      .sauce-carousel-wrapper::before,
      .sauce-carousel-wrapper::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        width: var(--sauce-edge);
        z-index: 2;
        pointer-events: none;
      }

      .sauce-carousel-wrapper::before {
        left: 0;
        background: linear-gradient(
          90deg,
          #080200 0%,
          rgba(8, 2, 0, 0.88) 18%,
          rgba(8, 2, 0, 0.45) 48%,
          rgba(8, 2, 0, 0.12) 78%,
          transparent 100%
        );
        -webkit-backdrop-filter: blur(14px) saturate(1.05);
        backdrop-filter: blur(14px) saturate(1.05);
        -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 8%, rgba(0, 0, 0, 0.55) 42%, rgba(0, 0, 0, 0.2) 72%, transparent 100%);
        mask-image: linear-gradient(90deg, #000 0%, #000 8%, rgba(0, 0, 0, 0.55) 42%, rgba(0, 0, 0, 0.2) 72%, transparent 100%);
      }

      .sauce-carousel-wrapper::after {
        right: 0;
        background: linear-gradient(
          270deg,
          #080200 0%,
          rgba(8, 2, 0, 0.88) 18%,
          rgba(8, 2, 0, 0.45) 48%,
          rgba(8, 2, 0, 0.12) 78%,
          transparent 100%
        );
        -webkit-backdrop-filter: blur(14px) saturate(1.05);
        backdrop-filter: blur(14px) saturate(1.05);
        -webkit-mask-image: linear-gradient(270deg, #000 0%, #000 8%, rgba(0, 0, 0, 0.55) 42%, rgba(0, 0, 0, 0.2) 72%, transparent 100%);
        mask-image: linear-gradient(270deg, #000 0%, #000 8%, rgba(0, 0, 0, 0.55) 42%, rgba(0, 0, 0, 0.2) 72%, transparent 100%);
      }

      .sauce-carousel-track {
        display: flex;
        gap: var(--sauce-gap);
        width: max-content;
        animation: sauceCarousel 60s linear infinite;
      }

      .sauce-carousel-wrapper:not(.sauce-carousel-wrapper--in) .sauce-carousel-track {
        animation-play-state: paused;
      }

      .sauce-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        flex: 0 0 auto;
        min-width: var(--sauce-card);
        max-width: var(--sauce-card);
        min-height: calc(var(--sauce-card) * 1.32);
        box-sizing: border-box;
        background: linear-gradient(160deg, #110600, #080300);
        border: 1px solid #1e0900;
        border-radius: 10px;
        padding: 26px 14px 24px;
        text-align: center;
        transition:
          transform 0.38s cubic-bezier(0.23, 1, 0.32, 1),
          border-color 0.38s cubic-bezier(0.23, 1, 0.32, 1),
          box-shadow 0.38s cubic-bezier(0.23, 1, 0.32, 1);
      }

      .sauce-card::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 10px;
        background: radial-gradient(circle at 50% 10%, var(--sauce-c), transparent 65%);
        opacity: 0;
        transition: opacity 0.38s cubic-bezier(0.23, 1, 0.32, 1);
        pointer-events: none;
      }

      .sauce-card:hover {
        transform: translateY(-7px);
        border-color: var(--category-c);
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
      }

      .sauce-card:hover::before {
        opacity: 0.1;
      }

      .sauce-emoji {
        font-size: 42px;
        margin-bottom: 10px;
        line-height: 1;
        transition: filter 0.38s cubic-bezier(0.23, 1, 0.32, 1);
      }

      .sauce-card:hover .sauce-emoji {
        filter: drop-shadow(0 0 18px var(--sauce-c));
      }

      .sauce-name {
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Oswald', sans-serif;
        font-size: 13px;
        letter-spacing: 1px;
        color: #ddd;
        text-transform: uppercase;
        line-height: 1.25;
        margin-bottom: 0;
        flex: 1;
        padding: 4px 2px 0;
      }

      .sauce-spice-footer {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-top: auto;
        padding-top: 14px;
        border-top: 1px solid rgba(30, 9, 0, 0.75);
      }

      .sauce-heat-row {
        display: flex;
        justify-content: center;
        gap: 5px;
        margin-bottom: 0;
        flex-shrink: 0;
      }

      .heat-pip {
        width: 7px;
        height: 7px;
        border-radius: 2px;
        transform: rotate(45deg);
        background: #1a0600;
        flex-shrink: 0;
      }

      .sauce-badge {
        display: inline-block;
        font-size: 9px;
        letter-spacing: 2px;
        font-weight: 700;
        padding: 3px 9px;
        border-radius: 4px;
      }

      @media (prefers-reduced-motion: reduce) {
        .sauce-count-hero {
          opacity: 1;
          animation: none;
          transform: none;
          filter: drop-shadow(0 0 40px rgba(255, 150, 0, 0.35));
        }

        .sauce-count-hero::after {
          animation: none;
          opacity: 0.4;
          transform: scale(1);
        }

        .sauce-header.reveal {
          opacity: 1;
          transform: none;
          transition: none;
        }

        .sauce-carousel-wrapper {
          opacity: 1;
          transform: none;
          transition: none;
        }

        .sauce-carousel-track {
          animation: none;
        }
      }

      /* ── How it works (#how) ─────────────────────────────────────────── */
      #how {
        padding: 100px 7%;
      }

      #how .section-head {
        text-align: center;
        margin-bottom: 60px;
      }

      #how .section-head.reveal {
        opacity: 0;
        transform: translateY(60px);
        transition:
          opacity 0.8s cubic-bezier(0.23, 1, 0.32, 1),
          transform 0.8s cubic-bezier(0.23, 1, 0.32, 1);
      }

      #how .section-head.reveal.in {
        opacity: 1;
        transform: translateY(0);
      }

      #how .section-label {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 4px;
        color: #ffcc33;
        text-transform: uppercase;
        margin-bottom: 14px;
      }

      #how .section-head h2 {
        font-family: 'Black Han Sans', sans-serif;
        font-size: clamp(42px, 5.5vw, 72px);
        letter-spacing: 3px;
        line-height: 1;
        color: #fff;
        margin: 0;
        text-align: center;
      }

      #how .section-head .gradient-text {
        background: linear-gradient(90deg, #ff4d00, #ffd500);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      #how .section-divider {
        height: 2px;
        background: linear-gradient(90deg, transparent, #ff4d00, transparent);
        border: none;
        margin: 20px auto 0;
        max-width: 280px;
        border-radius: 1px;
      }

      #how .steps {
        display: flex;
        gap: 2px;
        margin-top: 60px;
      }

      #how .steps .step {
        flex: 1;
        background: #0d0400;
        border: 1px solid #1e0900;
        padding: 40px 30px;
        position: relative;
      }

      #how .steps .step:first-child {
        border-radius: 14px 0 0 14px;
      }

      #how .steps .step:last-child {
        border-radius: 0 14px 14px 0;
      }

      #how .steps .step.reveal {
        transition:
          opacity 0.8s cubic-bezier(0.23, 1, 0.32, 1),
          transform 0.8s cubic-bezier(0.23, 1, 0.32, 1),
          border-color 0.35s ease,
          background 0.35s ease;
      }

      #how .steps .step.reveal:not(.in) {
        opacity: 0;
        transform: translateY(60px);
        pointer-events: none;
      }

      #how .steps .step.reveal.in {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }

      #how .steps .step.reveal.in:nth-child(1) {
        transition-delay: 0s;
      }

      #how .steps .step.reveal.in:nth-child(2) {
        transition-delay: 0.12s;
      }

      #how .steps .step.reveal.in:nth-child(3) {
        transition-delay: 0.24s;
      }

      #how .steps .step.reveal.in:hover {
        transform: translateY(-6px) scale(1.01);
        border-color: rgba(255, 77, 0, 0.35);
        z-index: 1;
        background: #120800;
      }

      #how .step-num {
        font-family: 'Black Han Sans', sans-serif;
        font-size: 11px;
        letter-spacing: 4px;
        color: rgba(255, 77, 0, 0.4);
        margin-bottom: 18px;
      }

      #how .step-icon {
        font-size: 40px;
        margin-bottom: 18px;
        display: block;
        line-height: 1;
        transition: transform 0.3s ease;
      }

      #how .steps .step.reveal.in:hover .step-icon {
        transform: scale(1.15) rotate(-5deg);
      }

      #how .step-title {
        font-family: 'Oswald', sans-serif;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 2px;
        color: #ffd500;
        text-transform: uppercase;
        margin: 0 0 12px;
        line-height: 1.2;
      }

      #how .step-desc {
        font-family: 'Rajdhani', sans-serif;
        font-size: 15px;
        color: #ffd966;
        line-height: 1.65;
        margin: 0;
      }

      #how .step-arrow {
        position: absolute;
        right: -18px;
        top: 50%;
        transform: translateY(-50%);
        z-index: 2;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: #080200;
        border: 1px solid #1e0900;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: rgba(255, 77, 0, 0.25);
        pointer-events: none;
      }

      @media (max-width: 900px) {
        #how .steps {
          flex-direction: column;
          gap: 2px;
        }

        #how .steps .step:first-child {
          border-radius: 14px 14px 0 0;
        }

        #how .steps .step:last-child {
          border-radius: 0 0 14px 14px;
        }

        #how .steps .step:not(:first-child):not(:last-child) {
          border-radius: 0;
        }

        #how .step-arrow {
          display: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        #how .section-head.reveal {
          opacity: 1;
          transform: none;
          transition: none;
        }

        #how .steps .step.reveal:not(.in),
        #how .steps .step.reveal.in {
          opacity: 1;
          transform: none;
          transition: none;
        }

        #how .steps .step.reveal.in {
          transition-delay: 0s !important;
        }

        #how .steps .step.reveal.in:hover {
          transform: none;
        }

        #how .steps .step.reveal.in:hover .step-icon {
          transform: none;
        }
      }

      @keyframes tickerScroll {
        from {
          transform: translateX(0);
        }
        to {
          transform: translateX(-50%);
        }
      }

      /* ── Testimonials (#testimonials) ─────────────────────────────── */

      #testimonials {
        padding: 100px 0;
        position: relative;
      }

      #testimonials .testimonials-head {
        padding: 0 7%;
        margin-bottom: 50px;
        text-align: center;
      }

      #testimonials .testimonials-head.reveal {
        opacity: 0;
        transform: translateY(60px);
        transition:
          opacity 0.8s cubic-bezier(0.23, 1, 0.32, 1),
          transform 0.8s cubic-bezier(0.23, 1, 0.32, 1);
      }

      #testimonials .testimonials-head.reveal.in {
        opacity: 1;
        transform: translateY(0);
      }

      #testimonials .section-label {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 4px;
        color: #ffcc33;
        text-transform: uppercase;
        margin-bottom: 14px;
      }

      #testimonials .testimonials-head h2 {
        font-family: 'Black Han Sans', sans-serif;
        font-size: clamp(40px, 5vw, 64px);
        letter-spacing: 3px;
        line-height: 1.1;
        color: #fff;
        margin: 0;
        text-align: center;
      }

      #testimonials .testimonials-head .gradient-text {
        background: linear-gradient(90deg, #ff4d00, #ffd500);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      #testimonials .section-divider {
        height: 2px;
        background: linear-gradient(90deg, transparent, #ff4d00, transparent);
        border: none;
        margin: 20px auto 0;
        max-width: 280px;
        border-radius: 1px;
      }

      #testimonials .testimonials-track-wrapper {
        position: relative;
        overflow: hidden;
      }

      #testimonials .testimonials-track-wrapper::before,
      #testimonials .testimonials-track-wrapper::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        width: 100px;
        z-index: 2;
        pointer-events: none;
      }

      #testimonials .testimonials-track-wrapper::before {
        left: 0;
        background: linear-gradient(90deg, #000, transparent);
      }

      #testimonials .testimonials-track-wrapper::after {
        right: 0;
        background: linear-gradient(-90deg, #000, transparent);
      }

      #testimonials .testimonials-track-wrapper--static {
        overflow: visible;
      }

      #testimonials .testimonials-track-wrapper--static::before,
      #testimonials .testimonials-track-wrapper--static::after {
        display: none;
      }

      #testimonials .testimonials-track {
        display: flex;
        gap: 16px;
        padding: 8px 7% 20px;
        width: max-content;
        animation: tickerScroll 60s linear infinite;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }

      #testimonials .testimonials-track::-webkit-scrollbar {
        display: none;
      }

      #testimonials .testimonials-track--static {
        animation: none;
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
        flex-wrap: wrap;
        justify-content: center;
        box-sizing: border-box;
      }

      #testimonials .tcard {
        min-width: 290px;
        max-width: 310px;
        flex-shrink: 0;
        padding: 28px;
        border-radius: 16px;
        position: relative;
        overflow: hidden;
        background: linear-gradient(160deg, #1a0d00, #261200, #1a0d00);
        border: 1px solid rgba(255, 140, 40, 0.25);
        box-shadow:
          inset 0 1px 0 0 rgba(255, 170, 0, 0.08),
          0 4px 20px rgba(0, 0, 0, 0.3);
        transition: border-color 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease;
      }

      #testimonials .tcard:hover {
        border-color: rgba(255, 170, 50, 0.5);
        transform: translateY(-4px);
        box-shadow:
          inset 0 1px 0 0 rgba(255, 170, 0, 0.12),
          0 8px 32px rgba(255, 100, 0, 0.12),
          0 0 0 1px rgba(255, 140, 40, 0.15);
      }

      #testimonials .tcard-stars {
        color: #ffd500;
        font-size: 14px;
        letter-spacing: 3px;
        margin-bottom: 14px;
      }

      #testimonials .tcard-text {
        font-family: 'Rajdhani', sans-serif;
        font-size: 15px;
        color: #eedd99;
        line-height: 1.65;
        margin: 0 0 18px;
        font-style: italic;
      }

      #testimonials .tcard-author {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      #testimonials .tcard-avatar {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: linear-gradient(135deg, rgba(255, 107, 0, 0.35), rgba(255, 170, 0, 0.25));
        border: 1px solid rgba(255, 107, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Oswald', sans-serif;
        font-weight: 700;
        font-size: 15px;
        color: #ff6b00;
        flex-shrink: 0;
      }

      #testimonials .tcard-name {
        font-family: 'Oswald', sans-serif;
        font-size: 14px;
        letter-spacing: 1px;
        color: #ffd500;
        font-weight: 700;
      }

      #testimonials .tcard-handle {
        font-size: 11px;
        color: #8a6030;
      }

      #testimonials .tcard-source {
        display: inline-block;
        margin-top: 10px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 2px;
        padding: 3px 8px;
        border-radius: 3px;
        background: rgba(255, 107, 0, 0.15);
        border: 1px solid rgba(255, 107, 0, 0.3);
        color: #ffaa00;
      }

      #testimonials .testimonials-sr-list {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      @media (prefers-reduced-motion: reduce) {
        #testimonials .testimonials-head.reveal {
          opacity: 1;
          transform: none;
          transition: none;
        }

        #testimonials .testimonials-track-wrapper {
          overflow: visible;
        }

        #testimonials .testimonials-track-wrapper::before,
        #testimonials .testimonials-track-wrapper::after {
          display: none;
        }

        #testimonials .testimonials-track {
          animation: none;
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          flex-wrap: wrap;
          justify-content: center;
          box-sizing: border-box;
        }

        #testimonials .tcard:hover {
          transform: none;
        }
      }

      .wk-skeleton-block {
        position: relative;
        overflow: hidden;
        background: linear-gradient(
          90deg,
          rgba(255,255,255,0.08) 0%,
          rgba(255,255,255,0.19) 46%,
          rgba(255,255,255,0.08) 100%
        );
        background-size: 200% 100%;
        animation: wkSkeletonShimmer 1.2s linear infinite;
      }

      .fire-btn,
      .ghost-btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 14px 32px;
        font-family: 'Black Han Sans', sans-serif;
        font-size: 18px;
        text-transform: uppercase;
        cursor: pointer;
        user-select: none;
        isolation: isolate;
        overflow: hidden;
        transition: transform 200ms ease, box-shadow 200ms ease, color 200ms ease, border-color 200ms ease;
      }

      .btn-label {
        position: relative;
        z-index: 2;
        transition: color 200ms cubic-bezier(0.23,1,0.32,1);
      }

      .fire-btn {
        letter-spacing: 1.5px;
        border-radius: 4px;
        border: none;
        color: #0a0a0a;
        text-decoration: none;
        background: linear-gradient(135deg, #ff4d00 0%, #ff8c00 45%, #ffd700 100%);
        clip-path: polygon(14px 0%, 100% 0%, calc(100% - 14px) 100%, 0% 100%);
        box-shadow: 0 10px 24px rgba(255, 77, 0, 0.18);
      }

      a.fire-btn:visited {
        color: #0a0a0a;
      }

      .fire-btn::before {
        content: '';
        position: absolute;
        top: -20%;
        bottom: -20%;
        left: 0;
        width: 55%;
        background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.75) 50%, transparent 100%);
        transform: translate3d(-150%,0,0) skewX(-20deg);
        opacity: 0;
        pointer-events: none;
        z-index: 1;
      }

      .fire-btn:hover {
        transform: scale(1.08) skewX(-2deg);
        box-shadow: 0 18px 48px rgba(255, 107, 0, 0.35), 0 0 0 1px rgba(255, 140, 0, 0.25) inset;
      }

      .fire-btn:hover::before {
        animation: fireSweep 650ms ease;
      }

      /* Nav cart: same gradient / clip / sweep as hero ORDER NOW, compact for the bar */
      .fire-btn.fire-btn--nav-cart {
        padding: 0.45rem 1.05rem 0.45rem 1.12rem;
        min-width: 4.75rem;
        font-size: 0.8125rem;
        letter-spacing: 0.08em;
        line-height: 1;
        clip-path: polygon(9px 0%, 100% 0%, calc(100% - 9px) 100%, 0% 100%);
        box-shadow: 0 6px 16px rgba(255, 77, 0, 0.2);
      }

      .fire-btn.fire-btn--nav-cart:hover {
        transform: scale(1.05) skewX(-1.5deg);
        box-shadow: 0 12px 32px rgba(255, 107, 0, 0.32), 0 0 0 1px rgba(255, 140, 0, 0.22) inset;
      }

      .fire-btn.fire-btn--nav-cart .wk-nav-cart-inner {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
      }

      .fire-btn.fire-btn--nav-cart .wk-nav-cart-icon {
        font-size: 1.05em;
        flex-shrink: 0;
        display: block;
      }

      .fire-btn.fire-btn--nav-cart .cart-nav-badge {
        background: transparent;
        color: #0a0a0a;
        border: none;
        border-radius: 0;
        min-width: 0;
        height: auto;
        padding: 0;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 0.8125rem;
        font-weight: 800;
        font-family: 'DM Sans', sans-serif;
        line-height: 1;
      }

      .ghost-btn {
        padding: 14px 38px;
        letter-spacing: 3px;
        border-radius: 0;
        background: transparent;
        border: 2px solid #ff6b00;
        color: #ff6b00;
        clip-path: polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%);
      }

      .ghost-btn::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, #ff4d00, #ffaa00);
        transform: scaleX(0);
        transform-origin: left center;
        transition: transform 0.35s cubic-bezier(0.23, 1, 0.32, 1);
        z-index: 0;
      }

      .ghost-btn:hover {
        color: #000;
        box-shadow: 0 8px 22px rgba(255, 80, 0, 0.18);
      }

      .ghost-btn:hover::after {
        transform: scaleX(1);
      }

      .ghost-btn:hover .btn-label {
        color: #0a0a0a;
      }

      .wk-hero-buttons {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px;
      }

      @media (max-width: 768px) {
        .wk-hero-buttons {
          flex-direction: column;
          align-items: stretch;
          width: 100%;
        }

        .wk-hero-buttons .fire-btn,
        .wk-hero-buttons .ghost-btn {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
      }

      :root {
        /* Fallback before JS measures the real nav height; pinned bar sits flush under the nav. */
        --wk-nav-offset: 68px;
        --wk-order-stack-offset: 220px;
        --wk-menu-bar-outdent: 0px;
        /* Pickup/delivery row + category bar share the same left edge (centered column). */
        --wk-menu-align-max: 1200px;
      }

      .wk-nav-bar {
        box-sizing: border-box;
        z-index: 999;
      }

      .wk-order-sticky-stack {
        position: relative;
        /* Below nav (999), above menu body + embers so the bar stays visible when stuck */
        z-index: 998;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
        padding: 8px 0 14px;
        margin: 0 0 18px;
        background: #f8c676;
        isolation: isolate;
      }

      /* JS-pinned (menu-page): fixed under nav; left/width set inline to match menu column */
      .wk-order-sticky-stack--pinned {
        position: fixed;
        top: var(--wk-nav-offset);
        margin-bottom: 0;
        box-sizing: border-box;
      }

      .wk-order-sticky-stack > .wk-menu-sticky-cats {
        box-sizing: border-box;
        width: 100%;
        max-width: min(var(--wk-menu-align-max), 100%);
        margin-left: auto;
        margin-right: auto;
      }

      .wk-menu-sticky-cats {
        position: relative;
        z-index: 1;
        width: 100%;
        max-width: min(var(--wk-menu-align-max), 100%);
        margin-left: auto;
        margin-right: auto;
        padding: 0;
        isolation: isolate;
        align-self: center;
      }

      .wk-cat-fade-edge {
        position: relative;
        border-radius: 22px;
      }

      .wk-cat-fade-edge::before,
      .wk-cat-fade-edge::after {
        display: none;
      }

      /* Wide soft vignette — no backdrop-blur (avoids a "blob" that ends in one spot) */
      .wk-cat-fade-edge::before,
      .wk-cat-fade-edge::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        width: min(84px, 20vw);
        z-index: 3;
        pointer-events: none;
      }

      .wk-cat-fade-edge::before {
        left: 0;
        border-radius: 24px 0 0 24px;
        background: linear-gradient(
          to right,
          rgba(28, 28, 28, 0.96) 0%,
          rgba(28, 28, 28, 0.82) 24%,
          rgba(28, 28, 28, 0.5) 62%,
          rgba(28, 28, 28, 0) 100%
        );
      }

      .wk-cat-fade-edge::after {
        right: 0;
        border-radius: 0 24px 24px 0;
        background: linear-gradient(
          to left,
          rgba(28, 28, 28, 0.96) 0%,
          rgba(28, 28, 28, 0.82) 24%,
          rgba(28, 28, 28, 0.5) 62%,
          rgba(28, 28, 28, 0) 100%
        );
      }

      .wk-cat-row {
        position: relative;
        z-index: 1;
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        justify-content: space-between;
        gap: clamp(3px, 0.4vw, 5px);
        width: 100%;
        box-sizing: border-box;
        padding: 7px 9px;
        border-radius: 22px;
        background: #1c1c1c;
        box-shadow: 0 8px 24px rgba(0,0,0,0.32);
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }

      .wk-cat-row::-webkit-scrollbar {
        display: none;
      }

      .wk-cat-btn {
        position: relative;
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 30px;
        padding: 5px 8px;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: clamp(10px, 0.78vw, 11px);
        font-weight: 500;
        letter-spacing: 0;
        text-transform: none;
        white-space: nowrap;
        cursor: pointer;
        border-radius: 50px;
        border: none;
        background: rgba(255,255,255,0.06);
        color: #aaa;
        user-select: none;
        isolation: isolate;
        overflow: hidden;
        transform: scale(1);
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        box-shadow: none;
      }

      .wk-cat-label {
        position: relative;
        z-index: 1;
      }

      .wk-cat-btn:hover:not([data-active="true"]) {
        background: rgba(255,255,255,0.1);
        color: #d6d6d6;
      }

      .wk-cat-btn[data-active="true"] {
        padding: 5px 11px;
        background: linear-gradient(135deg, #ff6b35 0%, #f7c948 100%);
        color: #1c1c1c;
        font-weight: 800;
        transform: none;
        box-shadow: 0 4px 14px rgba(255,107,53,0.32);
      }

      .wk-order-settings-shell {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        /* Same centered column as the category bar: left edges line up; content stays only as wide as needed. */
        width: 100%;
        max-width: min(var(--wk-menu-align-max), 100%);
        margin-left: auto;
        margin-right: auto;
        align-self: center;
        box-sizing: border-box;
        z-index: 2;
      }

      .wk-order-settings-bar {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        flex-wrap: nowrap;
        gap: 12px;
        width: fit-content;
        max-width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 16px;
        background: #1c1c1c;
        box-shadow: 0 14px 28px rgba(0,0,0,0.22);
      }

      .wk-order-fulfillment-display,
      .wk-order-settings-panel-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px;
        border-radius: 14px;
        background: rgba(255,255,255,0.08);
        flex-shrink: 0;
      }

      .wk-order-fulfillment-chip,
      .wk-order-fulfillment-btn {
        min-height: 38px;
        padding: 0 18px;
        border-radius: 10px;
        background: transparent;
        color: rgba(255,255,255,0.56);
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        transition: background 180ms ease, color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
      }

      .wk-order-fulfillment-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
        user-select: none;
      }

      .wk-order-fulfillment-btn {
        border: none;
        cursor: pointer;
      }

      .wk-order-fulfillment-btn:hover {
        color: #f5f1ea;
      }

      .wk-order-fulfillment-btn[data-disabled="true"] {
        cursor: not-allowed;
        opacity: 0.45;
      }

      .wk-order-fulfillment-btn[data-disabled="true"]:hover {
        color: rgba(255,255,255,0.56);
      }

      .wk-order-fulfillment-chip[data-active="true"],
      .wk-order-fulfillment-btn[data-active="true"] {
        background: #f5a623;
        color: #1c1c1c;
        box-shadow: 0 10px 22px rgba(245,166,35,0.2);
      }

      .wk-order-settings-meta {
        display: flex;
        align-items: stretch;
        gap: 0;
        flex: 0 1 auto;
        min-width: 0;
        justify-content: flex-start;
        border-left: 1px solid rgba(255,255,255,0.1);
        padding-left: 2px;
      }

      .wk-order-settings-chip {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 1 auto;
        min-height: 40px;
        min-width: 0;
        padding: 0 14px;
        color: #f3efe9;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
      }

      .wk-order-settings-chip--address {
        min-width: 0;
        max-width: min(240px, 34vw);
      }

      .wk-order-settings-chip > span:last-child {
        min-width: 0;
      }

      .wk-order-settings-chip--address > span:last-child {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .wk-order-settings-meta > .wk-order-settings-chip + .wk-order-settings-chip {
        border-left: 1px solid rgba(255,255,255,0.1);
      }

      .wk-order-settings-icon {
        display: inline-flex;
        width: 15px;
        height: 15px;
        color: #f5a623;
        flex: 0 0 auto;
      }

      .wk-order-settings-icon svg {
        width: 100%;
        height: 100%;
      }

      .wk-order-settings-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        min-height: 40px;
        padding: 0 16px;
        border-radius: 12px;
        border: 1px solid rgba(245,166,35,0.8);
        background: transparent;
        color: #f5a623;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
        transition: border-color 180ms ease, background 180ms ease, color 180ms ease, transform 180ms ease;
      }

      .wk-order-settings-action:hover:not(:disabled) {
        background: rgba(245,166,35,0.08);
        border-color: #f5a623;
        transform: translateY(-1px);
      }

      .wk-order-settings-action:disabled {
        cursor: wait;
        opacity: 0.7;
      }

      .wk-order-settings-panel {
        width: min(380px, 100%);
        padding: 16px;
        border-radius: 24px;
        border: 1px solid rgba(245,166,35,0.7);
        background: #1c1c1c;
        box-shadow: 0 24px 54px rgba(0,0,0,0.3);
      }

      .wk-order-settings-panel-header {
        display: flex;
        align-items: center;
        margin-bottom: 14px;
      }

      .wk-order-settings-panel-title {
        color: #fff;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 22px;
        font-weight: 800;
      }

      .wk-order-settings-panel-toggle {
        display: flex;
        width: 100%;
      }

      .wk-order-settings-panel-toggle .wk-order-fulfillment-btn {
        flex: 1 1 0;
        justify-content: center;
      }

      .wk-order-settings-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-top: 12px;
      }

      .wk-order-settings-restriction-note {
        margin: 10px 2px 0;
        color: #ffb2a7;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.45;
      }

      .wk-order-settings-field {
        padding: 12px 12px 10px;
        border-radius: 14px;
        background: rgba(255,255,255,0.07);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
      }

      .wk-order-settings-field-label {
        display: block;
        margin-bottom: 8px;
        color: rgba(255,255,255,0.45);
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .wk-order-settings-field-value {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: #fff;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 16px;
        font-weight: 700;
      }

      .wk-order-settings-select-wrap {
        display: flex;
        position: relative;
        align-items: center;
        min-height: 48px;
        padding: 0 16px 0 14px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.08);
        background:
          linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.03) 100%),
          rgba(12,12,12,0.14);
        transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
      }

      .wk-order-settings-select-wrap:focus-within {
        border-color: rgba(245,166,35,0.45);
        box-shadow: 0 0 0 3px rgba(245,166,35,0.12);
        background:
          linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 100%),
          rgba(12,12,12,0.18);
      }

      .wk-order-settings-select-wrap::after {
        content: '▾';
        position: absolute;
        right: 14px;
        top: 50%;
        transform: translateY(-50%);
        color: rgba(255,255,255,0.55);
        font-size: 13px;
        pointer-events: none;
      }

      .wk-order-settings-select-icon {
        display: inline-flex;
        width: 15px;
        height: 15px;
        margin-right: 10px;
        color: #f5a623;
        flex: 0 0 auto;
      }

      .wk-order-settings-select-icon svg {
        width: 100%;
        height: 100%;
      }

      .wk-order-settings-select {
        width: 100%;
        appearance: none;
        border: none;
        background: transparent;
        color-scheme: dark;
        color: #fff;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 16px;
        font-weight: 700;
        line-height: 1.25;
        min-height: 100%;
        padding: 0 22px 0 0;
        cursor: pointer;
      }

      .wk-order-settings-select:focus {
        outline: none;
      }

      .wk-order-settings-select option {
        background: #221d19;
        color: #fff3e3;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-weight: 600;
      }

      .wk-order-settings-caret {
        color: rgba(255,255,255,0.48);
        font-size: 11px;
        flex: 0 0 auto;
      }

      .wk-order-settings-address {
        margin-top: 10px;
        padding: 12px 12px 10px;
        border-radius: 14px;
        background: rgba(255,255,255,0.07);
      }

      .wk-order-settings-address[data-invalid="true"] {
        box-shadow: inset 0 0 0 1px rgba(255, 122, 103, 0.6);
      }

      .wk-order-settings-address-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }

      .wk-order-settings-address-header .wk-order-settings-field-label {
        margin-bottom: 0;
      }

      .wk-order-settings-address-change {
        flex-shrink: 0;
        padding: 4px 10px;
        border-radius: 8px;
        border: 1px solid rgba(245,166,35,0.45);
        background: rgba(245,166,35,0.12);
        color: rgba(245,190,120,0.98);
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
      }

      .wk-order-settings-address-change:hover {
        background: rgba(245,166,35,0.22);
        border-color: rgba(245,166,35,0.65);
      }

      .wk-order-settings-address-value {
        display: grid;
        gap: 4px;
        color: #fff;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.4;
      }

      .wk-order-settings-address-value span:last-child {
        color: rgba(255,255,255,0.72);
        font-size: 13px;
        font-weight: 600;
      }

      .wk-order-settings-address-empty {
        color: rgba(255,255,255,0.62);
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.4;
      }

      .wk-order-settings-address-error {
        margin: 10px 0 0;
        color: #ffb2a7;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.4;
      }

      .wk-address-picker-card {
        width: min(440px, 100%);
      }

      .wk-address-picker-card .wk-method-card-inner {
        padding: 28px 24px 22px;
      }

      .wk-address-picker-card .wk-method-title {
        font-size: clamp(22px, 4vw, 32px);
        text-align: left;
        margin: 0 0 0 4px;
      }

      .wk-address-picker-card .wk-method-header {
        text-align: left;
        padding-top: 0;
        margin-bottom: 8px;
      }

      .wk-address-picker-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: min(52vh, 420px);
        overflow-y: auto;
        margin: 0 0 14px;
        padding: 2px 0;
      }

      .wk-address-picker-row {
        display: flex;
        align-items: stretch;
        gap: 6px;
        width: 100%;
        text-align: left;
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,0.1);
        background: rgba(0,0,0,0.35);
        padding: 8px 8px 8px 12px;
        color: #fff;
        font-family: 'Outfit', 'Poppins', sans-serif;
        transition: border-color 0.15s ease, background 0.15s ease;
      }

      .wk-address-picker-row:hover {
        border-color: rgba(245,166,35,0.45);
        background: rgba(245,166,35,0.08);
      }

      .wk-address-picker-row[data-selected="true"] {
        border-color: rgba(245,166,35,0.85);
        box-shadow: 0 0 0 1px rgba(245,166,35,0.2) inset;
      }

      .wk-address-picker-row-select {
        flex: 1;
        min-width: 0;
        text-align: left;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        padding: 4px 4px 4px 4px;
        border-radius: 10px;
      }

      .wk-address-picker-row-select:focus-visible {
        outline: 2px solid rgba(245,166,35,0.65);
        outline-offset: 2px;
      }

      .wk-address-picker-row-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
      }

      .wk-address-picker-icon-btn {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        padding: 0;
        border: none;
        border-radius: 10px;
        background: rgba(255,255,255,0.06);
        color: rgba(245,190,120,0.95);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
      }

      .wk-address-picker-icon-btn:hover {
        background: rgba(245,166,35,0.18);
        color: #fff4e0;
      }

      .wk-address-picker-icon-btn:focus-visible {
        outline: 2px solid rgba(245,166,35,0.55);
        outline-offset: 1px;
      }

      .wk-address-picker-icon-btn--danger:hover {
        background: rgba(180, 40, 40, 0.35);
        color: #ffc9c9;
      }

      .wk-address-picker-row-line1 {
        font-size: 15px;
        font-weight: 700;
        line-height: 1.35;
      }

      .wk-address-picker-row-meta {
        margin-top: 4px;
        font-size: 13px;
        font-weight: 600;
        color: rgba(255,255,255,0.68);
      }

      .wk-address-picker-empty {
        color: rgba(255,255,255,0.58);
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 14px;
        font-weight: 600;
        margin: 0 0 12px;
        padding: 10px 14px;
        border-radius: 14px;
        background: rgba(255,255,255,0.05);
      }

      .wk-address-picker-add {
        width: 100%;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px dashed rgba(245,166,35,0.45);
        background: rgba(245,166,35,0.08);
        color: rgba(245,190,120,0.98);
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
      }

      .wk-address-picker-add:hover {
        background: rgba(245,166,35,0.16);
        border-color: rgba(245,166,35,0.65);
      }

      .wk-menu-section-title {
        margin: 18px 0 12px;
        padding: 10px 14px;
        border-radius: 16px;
        border: 1px solid rgba(245,166,35,0.25);
        background: rgba(0,0,0,0.35);
        color: #f5a623;
        font-family: 'Bebas Neue', sans-serif;
        letter-spacing: 4px;
        text-align: center;
      }

      .wk-wings-options {
        list-style: none;
        padding: 0;
        margin: 12px 0 0;
        display: grid;
        gap: 6px;
      }

      .wk-wings-options li {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 12px;
        border: 1px solid rgba(245,166,35,0.14);
        background: rgba(0,0,0,0.28);
        color: rgba(255,255,255,0.82);
        font-size: 13px;
        line-height: 1.25;
      }

      .wk-wings-opt-price {
        color: #fff4e6;
        font-weight: 700;
        white-space: nowrap;
      }

      /* ── Category sections (long scroll) ─────────────────────────── */

      .wk-menu-section {
        scroll-margin-top: calc(var(--wk-order-stack-offset) + 16px);
        padding-bottom: 44px;
      }

      .wk-menu-section:first-child {
        padding-top: clamp(4px, 1svh, 8px);
      }

      .wk-menu-section + .wk-menu-section {
        border-top: 1px solid rgba(40, 28, 18, 0.22);
        padding-top: 40px;
        margin-top: 12px;
      }

      .wk-section-heading {
        position: relative;
        font-family: 'Bebas Neue', sans-serif;
        font-size: clamp(22px, 6vw, 32px);
        letter-spacing: clamp(1px, 0.6vw, 4px);
        line-height: 1.05;
        color: #170f09;
        margin: 0 0 clamp(18px, 2.8svh, 28px);
        text-align: center;
        max-width: 100%;
        overflow-wrap: anywhere;
        hyphens: auto;
      }

      .wk-section-heading::after {
        content: '';
        display: block;
        width: min(240px, 72%);
        height: 2px;
        margin: clamp(8px, 1.4svh, 12px) auto 0;
        background: linear-gradient(
          90deg,
          rgba(23,15,9,0) 0%,
          rgba(23,15,9,0.28) 18%,
          rgba(23,15,9,0.62) 50%,
          rgba(23,15,9,0.28) 82%,
          rgba(23,15,9,0) 100%
        );
      }

      .wk-section-note,
      .wk-combo-note {
        margin: clamp(-4px, -0.7svh, -8px) auto clamp(14px, 2.2svh, 20px);
        padding: clamp(8px, 1.4svh, 10px) clamp(12px, 1.3vw, 14px);
        border-radius: 16px;
        border: 1px solid rgba(255,166,35,0.18);
        background: rgba(12,12,12,0.56);
        color: rgba(255,255,255,0.8);
        font-size: clamp(12px, 1.4svh, 13px);
        text-align: center;
        letter-spacing: 0.5px;
        max-width: min(640px, 100%);
      }

      .wk-section-note--highlight {
        background: rgba(12,12,12,0.7);
        border-color: rgba(255,166,35,0.22);
        color: #fff6e8;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 16px;
        font-weight: 700;
        line-height: 1.45;
        letter-spacing: 0.01em;
      }

      .wk-section-note-kicker {
        display: block;
        margin-bottom: 4px;
        color: #f5a623;
        font-family: 'Bebas Neue', sans-serif;
        font-size: 16px;
        letter-spacing: 2px;
        text-transform: uppercase;
      }

      .wk-salads-empty {
        margin: 0 auto clamp(14px, 2.2svh, 20px);
        padding: clamp(12px, 2svh, 16px) clamp(14px, 1.6vw, 18px);
        border-radius: 16px;
        border: 1px dashed rgba(255, 166, 35, 0.25);
        background: rgba(12, 12, 12, 0.45);
        color: rgba(255, 255, 255, 0.72);
        font-size: clamp(12px, 1.4svh, 14px);
        line-height: 1.5;
        text-align: center;
        max-width: min(560px, 100%);
      }

      .wk-salads-empty p {
        margin: 0;
      }

      .wk-address-saved-toast {
        position: fixed;
        left: 50%;
        bottom: max(24px, env(safe-area-inset-bottom, 0px));
        transform: translateX(-50%);
        z-index: 400;
        max-width: min(calc(100vw - 32px), 420px);
        padding: 14px 20px;
        border-radius: 14px;
        border: 1px solid rgba(255, 188, 0, 0.35);
        background: rgba(14, 12, 10, 0.94);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
        color: #ffbc00;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 15px;
        font-weight: 700;
        text-align: center;
        letter-spacing: 0.02em;
        animation: wk-toast-in 220ms ease-out;
      }

      .wk-auth-error-toast {
        border-color: rgba(248, 113, 113, 0.48);
        color: #fecaca;
        background: rgba(24, 10, 10, 0.96);
      }

      @keyframes wk-toast-in {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(12px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      /* Above .wk-nav-bar (999) so the modal/backdrop cover the nav; scroll + safe-area on short phones */
      .wk-method-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.78);
        backdrop-filter: blur(10px);
        z-index: 1200;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        padding: max(env(safe-area-inset-top, 0px), 12px) 22px max(env(safe-area-inset-bottom, 0px), 22px);
        box-sizing: border-box;
      }

      @media (min-height: 900px) {
        .wk-method-overlay {
          align-items: center;
        }
      }

      .wk-method-card {
        width: min(980px, 100%);
        background: transparent;
        border-radius: 26px;
        padding: 0;
      }

      .wk-method-card-inner {
        position: relative;
        border-radius: 20px;
        padding: 34px 34px 28px;
        background: radial-gradient(circle at 20% 10%, rgba(255,77,0,0.14) 0%, transparent 55%), rgba(10,10,10,0.94);
        border: 1px solid rgba(255,140,0,0.2);
        box-shadow: 0 30px 90px rgba(0,0,0,0.7);
        overflow: hidden;
      }

      .wk-method-card-inner:hover .wk-auth-card-rim {
        opacity: 1;
      }

      .wk-method-card-inner:hover .wk-auth-card-glow {
        opacity: 0.38;
      }

      .wk-method-card-inner > :not(.wk-auth-card-glow):not(.wk-auth-card-rim) {
        position: relative;
        z-index: 2;
      }

      .wk-method-close {
        position: absolute;
        top: 14px;
        right: 14px;
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border-radius: 12px;
        border: 1px solid rgba(245,166,35,0.25);
        background: rgba(0,0,0,0.35);
        color: rgba(255,255,255,0.85);
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        transition: transform 200ms cubic-bezier(0.23,1,0.32,1), border-color 200ms ease, background 200ms ease;
      }

      .wk-method-close:hover {
        transform: scale(1.05);
        border-color: rgba(245,166,35,0.6);
        background: rgba(0,0,0,0.5);
      }

      .wk-method-header {
        text-align: center;
        padding-top: 6px;
      }

      .wk-method-step {
        font-family: 'Bebas Neue', sans-serif;
        letter-spacing: 4px;
        font-size: 16px;
        color: #ffcd00;
      }

      .wk-method-title {
        margin: 10px 0 6px;
        font-family: 'Black Han Sans', sans-serif;
        letter-spacing: 2px;
        font-size: clamp(28px, 3.4vw, 44px);
        line-height: 1.05;
        color: #fff;
      }

      .wk-method-sub {
        margin: 0;
        color: rgba(210, 190, 170, 0.9);
        font-size: 14px;
      }

      .wk-method-sub--accent {
        color: #ffbc00;
      }

      .wk-method-options {
        display: flex;
        gap: 18px;
        margin-top: 26px;
        margin-bottom: 18px;
      }

      .wk-method-option {
        flex: 1;
        text-align: left;
        border-radius: 18px;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(0,0,0,0.35);
        padding: 22px;
        color: #fff;
        cursor: pointer;
        user-select: none;
        position: relative;
        overflow: hidden;
        transition:
          transform 220ms cubic-bezier(0.23,1,0.32,1),
          box-shadow 220ms cubic-bezier(0.23,1,0.32,1),
          border-color 220ms cubic-bezier(0.23,1,0.32,1);
      }

      .wk-method-option::after {
        content: '';
        position: absolute;
        inset: 0;
        background: rgba(245,166,35,0.12);
        transform: scaleX(0);
        transform-origin: left;
        transition: transform 260ms cubic-bezier(0.23,1,0.32,1);
        z-index: 0;
      }

      .wk-method-option > * {
        position: relative;
        z-index: 1;
      }

      .wk-method-option:hover {
        transform: scale(1.02);
        border-color: rgba(245,166,35,0.55);
        box-shadow: 0 22px 52px rgba(0,0,0,0.55);
      }

      .wk-method-option:hover::after {
        transform: scaleX(1);
      }

      .wk-method-option[data-selected="true"] {
        border-color: rgba(245,166,35,0.95);
        box-shadow: 0 26px 62px rgba(0,0,0,0.65), 0 0 0 1px rgba(245,166,35,0.22) inset;
      }

      .wk-method-option[data-disabled="true"] {
        cursor: not-allowed;
        opacity: 0.58;
        transform: none;
        box-shadow: none;
      }

      .wk-method-option[data-disabled="true"]::after {
        transform: scaleX(0);
      }

      .wk-method-option[data-disabled="true"]:hover {
        transform: none;
        border-color: rgba(255,255,255,0.08);
        box-shadow: none;
      }

      .wk-method-option-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      .wk-method-icon {
        font-size: 54px;
        filter: drop-shadow(0 10px 22px rgba(0,0,0,0.55));
      }

      .wk-method-check {
        width: 24px;
        height: 24px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        background: #f5a623;
        color: #0a0a0a;
        font-weight: 900;
        font-size: 14px;
        box-shadow: 0 10px 18px rgba(245,166,35,0.25);
      }

      .wk-method-tags {
        display: flex;
        gap: 10px;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }

      .wk-method-tag {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid rgba(245,166,35,0.35);
        background: rgba(245,166,35,0.12);
        color: rgba(245,166,35,0.95);
        font-family: 'Bebas Neue', sans-serif;
        font-size: 14px;
        letter-spacing: 2px;
      }

      .wk-method-option-name {
        font-family: 'Black Han Sans', sans-serif;
        letter-spacing: 2px;
        font-size: 22px;
        margin-bottom: 6px;
      }

      .wk-method-option-desc {
        color: #ffbc00;
        font-size: 13px;
        line-height: 1.45;
        max-width: 36ch;
      }

      .wk-method-address-panel {
        margin-top: 26px;
        margin-bottom: 18px;
        padding: 18px;
        border-radius: 22px;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(0,0,0,0.35);
        box-shadow: 0 22px 52px rgba(0,0,0,0.42);
      }

      .wk-method-address-grid {
        display: grid;
        gap: 12px;
      }

      .wk-method-address-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .wk-method-address-field {
        display: block;
        padding: 12px 12px 10px;
        border-radius: 14px;
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.15);
        transition: border-color 0.2s ease, background 0.2s ease;
      }

      .wk-method-address-field:focus-within {
        background: rgba(255,255,255,0.16);
        border-color: rgba(245,166,35,0.6);
      }

      .wk-method-address-label {
        display: block;
        margin-bottom: 8px;
        color: #ffcd00;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .wk-method-address-input {
        width: 100%;
        padding: 0;
        border: none;
        outline: none;
        background: transparent;
        color: #fff;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 16px;
        font-weight: 700;
      }

      .wk-method-address-input::placeholder {
        color: rgba(255,255,255,0.48);
      }

      .wk-method-form-error {
        margin: 12px 2px 0;
        color: #ffcd00;
        font-size: 13px;
        font-weight: 600;
      }

      @keyframes wkMethodFormErrorPulse {
        0% {
          transform: translateX(0) scale(1);
          opacity: 0.65;
        }
        18% {
          transform: translateX(-6px) scale(1.02);
          opacity: 1;
        }
        36% {
          transform: translateX(6px) scale(1.02);
        }
        54% {
          transform: translateX(-4px);
        }
        72% {
          transform: translateX(4px);
        }
        100% {
          transform: translateX(0) scale(1);
          opacity: 1;
        }
      }

      .wk-method-form-error--pulse {
        animation: wkMethodFormErrorPulse 0.55s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
      }

      @media (prefers-reduced-motion: reduce) {
        .wk-method-form-error--pulse {
          animation: none;
        }
      }

      .wk-method-back {
        margin-top: 14px;
        padding: 0;
        border: none;
        background: transparent;
        color: #ffcd00;
        font-family: 'Outfit', 'Poppins', sans-serif;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
      }

      .wk-method-back:hover {
        color: #ffe566;
      }

      .wk-method-continue {
        width: 100%;
        margin-top: 6px;
        padding: 14px 18px;
        border-radius: 16px;
        border: 1px solid rgba(245,166,35,0.55);
        background: linear-gradient(135deg, #ff4d00 0%, #ff8c00 45%, #ffd700 100%);
        color: #111;
        font-family: 'Black Han Sans', sans-serif;
        letter-spacing: 2px;
        text-transform: uppercase;
        cursor: pointer;
        position: relative;
        overflow: hidden;
        isolation: isolate;
        box-shadow: 0 8px 16px rgba(255, 77, 0, 0.25);
        transition:
          transform 220ms cubic-bezier(0.23,1,0.32,1),
          border-color 220ms cubic-bezier(0.23,1,0.32,1),
          box-shadow 220ms cubic-bezier(0.23,1,0.32,1),
          color 220ms cubic-bezier(0.23,1,0.32,1);
      }

      .wk-method-continue:hover:not(:disabled) {
        transform: translate3d(0,-2px,0);
        border-color: rgba(245,166,35,0.85);
        box-shadow: 0 12px 24px rgba(255, 77, 0, 0.4);
      }

      .wk-method-continue-label {
        position: relative;
        z-index: 1;
      }

      .wk-method-continue:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      /* ── Spotlight (#spotlight) ───────────────────────────────────── */
      #spotlight.spotlight-section {
        padding: 100px 7%;
        background: linear-gradient(135deg, #080200, #0d0400);
        border-top: 1px solid #1e0900;
        border-bottom: 1px solid #1e0900;
        overflow: hidden;
        box-sizing: border-box;
      }

      #spotlight .spotlight-inner {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 80px;
        align-items: center;
        max-width: 100%;
      }

      #spotlight .spotlight-visual {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 360px;
      }

      #spotlight .spotlight-visual.reveal-left {
        opacity: 0;
        transform: translateX(-60px);
        transition:
          opacity 0.8s cubic-bezier(0.23, 1, 0.32, 1),
          transform 0.8s cubic-bezier(0.23, 1, 0.32, 1);
      }

      #spotlight .spotlight-visual.reveal-left.is-visible {
        opacity: 1;
        transform: translateX(0);
      }

      #spotlight .spotlight-glow-wrap {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 320px;
        height: 320px;
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 0;
      }

      #spotlight .spotlight-glow {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255, 77, 0, 0.18), transparent 70%);
        animation: pulseGlow 4s ease-in-out infinite;
      }

      #spotlight .spotlight-emoji {
        position: relative;
        z-index: 2;
        font-size: 180px;
        line-height: 1;
        animation: gentleFloat 5s ease-in-out infinite;
        filter: drop-shadow(0 0 40px rgba(255, 80, 0, 0.3));
      }

      #spotlight .spotlight-badge {
        position: absolute;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #ff4d00, #ffaa00);
        color: #000;
        font-family: 'Black Han Sans', sans-serif;
        font-size: 12px;
        letter-spacing: 3px;
        font-weight: 700;
        padding: 8px 16px;
        border-radius: 4px;
        text-transform: uppercase;
        z-index: 3;
      }

      #spotlight .spotlight-copy.reveal-right {
        opacity: 0;
        transform: translateX(60px);
        transition:
          opacity 0.8s cubic-bezier(0.23, 1, 0.32, 1),
          transform 0.8s cubic-bezier(0.23, 1, 0.32, 1);
      }

      #spotlight .spotlight-copy.reveal-right.is-visible {
        opacity: 1;
        transform: translateX(0);
      }

      #spotlight .spotlight-section-label.section-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 4px;
        color: #ffcc33;
        text-transform: uppercase;
        margin: 0 0 14px;
      }

      #spotlight .spotlight-title {
        font-family: 'Black Han Sans', sans-serif;
        font-size: clamp(40px, 4.5vw, 64px);
        letter-spacing: 2px;
        line-height: 1;
        color: #fff;
        margin: 0 0 20px;
        text-transform: uppercase;
      }

      #spotlight .spotlight-title-line {
        display: block;
      }

      #spotlight .spotlight-title .gradient-text {
        background: linear-gradient(90deg, #ff4d00, #ffd500);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
      }

      #spotlight .spotlight-desc {
        font-size: 17px;
        color: #ffd966;
        line-height: 1.75;
        margin: 0 0 28px;
      }

      #spotlight .spotlight-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0 0 32px;
        padding: 0;
        list-style: none;
      }

      #spotlight .spotlight-tag {
        background: rgba(255, 77, 0, 0.1);
        border: 1px solid rgba(255, 77, 0, 0.25);
        color: #ffcc33;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 2px;
        padding: 6px 14px;
        border-radius: 4px;
        text-transform: uppercase;
      }

      #spotlight .spotlight-price {
        font-family: 'Black Han Sans', sans-serif;
        font-size: clamp(38px, 4vw, 56px);
        line-height: 1;
        margin: 0 0 28px;
        color: #fff4e6;
        -webkit-text-fill-color: #fff4e6;
      }

      #spotlight .spotlight-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px;
      }

      #spotlight .btn-fire,
      #spotlight .btn-ghost {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: 'Black Han Sans', sans-serif;
        font-size: 18px;
        letter-spacing: 3px;
        text-transform: uppercase;
        text-decoration: none;
        cursor: pointer;
        user-select: none;
        isolation: isolate;
        overflow: hidden;
        transition: transform 0.28s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.28s ease,
          color 0.28s ease, border-color 0.28s ease;
      }

      #spotlight .spotlight-btn-label {
        position: relative;
        z-index: 2;
      }

      #spotlight .btn-fire {
        padding: 16px 42px;
        border: none;
        color: #000;
        background: linear-gradient(135deg, #ff4d00, #ff6b00, #ffaa00);
        clip-path: polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%);
        box-shadow: 0 8px 20px rgba(255, 80, 0, 0.15);
      }

      #spotlight .btn-fire::before {
        content: '';
        position: absolute;
        top: -25%;
        bottom: -25%;
        left: 0;
        width: 45%;
        background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.75) 50%, transparent 100%);
        transform: translateX(-120%) skewX(-18deg);
        opacity: 0;
        pointer-events: none;
        z-index: 1;
      }

      #spotlight .btn-fire:hover {
        transform: scale(1.06) skewX(-2deg);
        box-shadow: 0 10px 28px rgba(255, 80, 0, 0.28);
      }

      #spotlight .btn-fire:hover::before {
        animation: spotlightBtnShine 0.65s ease forwards;
      }

      #spotlight .btn-ghost {
        padding: 14px 38px;
        background: transparent;
        border: 2px solid #ff6b00;
        color: #ff6b00;
        clip-path: polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%);
      }

      #spotlight .btn-ghost::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, #ff4d00, #ffaa00);
        transform: scaleX(0);
        transform-origin: left center;
        transition: transform 0.35s cubic-bezier(0.23, 1, 0.32, 1);
        z-index: 0;
      }

      #spotlight .btn-ghost:hover {
        color: #000;
        box-shadow: 0 8px 22px rgba(255, 80, 0, 0.18);
      }

      #spotlight .btn-ghost:hover::after {
        transform: scaleX(1);
      }

      @media (max-width: 960px) {
        #spotlight .spotlight-inner {
          grid-template-columns: 1fr;
          gap: 48px;
        }

        #spotlight .spotlight-visual {
          min-height: 280px;
        }

        #spotlight .spotlight-emoji {
          font-size: clamp(120px, 28vw, 180px);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        #spotlight .spotlight-glow {
          animation: none;
          opacity: 0.85;
          transform: scale(1);
        }

        #spotlight .spotlight-emoji {
          animation: none;
        }

        #spotlight .spotlight-visual.reveal-left,
        #spotlight .spotlight-copy.reveal-right {
          opacity: 1;
          transform: none;
          transition: none;
        }

        #spotlight .btn-fire:hover {
          transform: none;
        }
      }

      /* ── Newsletter (#newsletter) ─────────────────────────────────── */
      #newsletter {
        padding: 80px 7%;
        background: linear-gradient(135deg, #0d0400, #120600);
        border-top: 1px solid #1e0900;
        border-bottom: 1px solid #1e0900;
        text-align: center;
        position: relative;
        overflow: hidden;
        box-sizing: border-box;
      }

      #newsletter .bg-pattern {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background-image: radial-gradient(circle at 2px 2px, rgba(255, 77, 0, 0.06) 1px, transparent 0);
        background-size: 32px 32px;
        z-index: 0;
      }

      #newsletter .newsletter-inner {
        position: relative;
        z-index: 2;
        max-width: 520px;
        margin: 0 auto;
      }

      #newsletter .newsletter-inner.reveal {
        opacity: 0;
        transform: translateY(60px);
        transition:
          opacity 0.8s cubic-bezier(0.23, 1, 0.32, 1),
          transform 0.8s cubic-bezier(0.23, 1, 0.32, 1);
      }

      #newsletter .newsletter-inner.reveal.in {
        opacity: 1;
        transform: translateY(0);
      }

      #newsletter .section-label {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 4px;
        color: #ffcc33;
        text-transform: uppercase;
        margin-bottom: 14px;
      }

      #newsletter .newsletter-inner h3 {
        font-family: 'Black Han Sans', sans-serif;
        font-size: clamp(28px, 4vw, 42px);
        letter-spacing: 3px;
        margin: 0 0 12px;
        color: #fff;
        line-height: 1.15;
      }

      #newsletter .newsletter-inner .gradient-text {
        background: linear-gradient(90deg, #ff4d00, #ffd500);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      #newsletter .newsletter-desc {
        font-family: 'Rajdhani', sans-serif;
        font-size: 15px;
        color: #ffd966;
        margin: 0 0 28px;
        line-height: 1.6;
      }

      #newsletter .newsletter-form {
        display: flex;
        gap: 0;
        max-width: 440px;
        margin: 0 auto;
      }

      #newsletter .newsletter-input {
        flex: 1;
        min-width: 0;
        background: #0a0300;
        border: 2px solid #1e0900;
        border-right: none;
        color: #ffd500;
        font-family: 'Rajdhani', sans-serif;
        font-size: 15px;
        font-weight: 600;
        padding: 14px 18px;
        border-radius: 8px 0 0 8px;
        outline: none;
        transition: border-color 0.3s ease;
        box-sizing: border-box;
      }

      #newsletter .newsletter-input::placeholder {
        color: #FFD630;
      }

      #newsletter .newsletter-input:focus {
        border-color: #ff6b00;
        border-right: none;
      }

      #newsletter .newsletter-btn {
        background: linear-gradient(135deg, #ff4d00, #ffaa00);
        border: none;
        color: #000;
        font-family: 'Black Han Sans', sans-serif;
        font-size: 14px;
        letter-spacing: 2px;
        padding: 14px 28px;
        cursor: pointer;
        border-radius: 0 8px 8px 0;
        white-space: nowrap;
        text-transform: uppercase;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      #newsletter .newsletter-btn:hover {
        box-shadow: 0 4px 18px rgba(255, 80, 0, 0.3);
      }

      #newsletter .newsletter-perks {
        display: flex;
        justify-content: center;
        gap: 24px;
        margin: 18px 0 0;
        padding: 0;
        list-style: none;
        flex-wrap: wrap;
      }

      #newsletter .newsletter-perk {
        font-family: 'Rajdhani', sans-serif;
        font-size: 12px;
        color: #b8863a;
        letter-spacing: 1px;
        font-weight: 600;
      }

      #newsletter .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      @media (max-width: 900px) {
        #newsletter .newsletter-form {
          flex-direction: column;
          gap: 0;
        }

        #newsletter .newsletter-input {
          border-right: 2px solid #1e0900;
          border-radius: 8px 8px 0 0;
        }

        #newsletter .newsletter-input:focus {
          border-right: 2px solid #ff6b00;
        }

        #newsletter .newsletter-btn {
          border-radius: 0 0 8px 8px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        #newsletter .newsletter-inner.reveal {
          opacity: 1;
          transform: none;
          transition: none;
        }
      }

      /* ── Order CTA (#cta) ─────────────────────────────────────────── */
      #cta.order-cta-section {
        position: relative;
        padding: 100px 7% 72px;
        background: #080200;
        overflow: hidden;
        text-align: center;
        box-sizing: border-box;
      }

      #cta.order-cta-section::before {
        content: '';
        position: absolute;
        left: 50%;
        top: 42%;
        transform: translate(-50%, -50%);
        width: min(92vw, 760px);
        height: min(92vw, 760px);
        background: radial-gradient(circle, rgba(255, 77, 0, 0.14), transparent 62%);
        pointer-events: none;
        z-index: 0;
      }

      #cta .order-cta-inner {
        position: relative;
        z-index: 1;
        max-width: 920px;
        margin: 0 auto;
      }

      #cta .order-cta-title {
        font-family: 'Black Han Sans', sans-serif;
        text-transform: uppercase;
        margin: 0;
        line-height: 1.02;
        letter-spacing: 3px;
      }

      #cta .order-cta-line {
        display: block;
      }

      #cta .order-cta-line--plain {
        font-size: clamp(32px, 4.2vw, 52px);
        color: #fff;
      }

      #cta .order-cta-line--gradient {
        margin-top: 4px;
        font-size: clamp(44px, 6vw, 80px);
        line-height: 1;
        background: linear-gradient(180deg, #ffe44d, #ffd500 35%, #ff6b00 72%, #ff4d00);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        filter: drop-shadow(0 4px 24px rgba(255, 90, 0, 0.25));
      }

      #cta .order-cta-badges {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 10px;
        margin: 32px 0 24px;
        padding: 0;
        list-style: none;
      }

      #cta .order-cta-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: rgba(8, 2, 0, 0.85);
        border: 1px solid rgba(255, 107, 0, 0.45);
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1.5px;
        color: #ffcc33;
        text-transform: uppercase;
      }

      #cta .order-cta-badge-ico {
        font-size: 15px;
        line-height: 1;
      }

      #cta .order-cta-sub {
        font-size: clamp(15px, 1.5vw, 17px);
        color: #e8a84a;
        line-height: 1.65;
        margin: 0 auto 36px;
        max-width: 520px;
      }

      #cta .order-cta-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 16px;
        margin-bottom: 40px;
      }

      #cta .btn-fire,
      #cta .btn-ghost {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: 'Black Han Sans', sans-serif;
        font-size: 18px;
        letter-spacing: 3px;
        text-transform: uppercase;
        text-decoration: none;
        cursor: pointer;
        user-select: none;
        isolation: isolate;
        overflow: hidden;
        transition: transform 0.28s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.28s ease,
          color 0.28s ease, border-color 0.28s ease;
      }

      #cta .order-cta-btn-label {
        position: relative;
        z-index: 2;
      }

      #cta .btn-fire {
        padding: 16px 42px;
        border: none;
        color: #000;
        background: linear-gradient(135deg, #ff4d00, #ff6b00, #ffaa00);
        clip-path: polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%);
        box-shadow: 0 8px 20px rgba(255, 80, 0, 0.15);
      }

      #cta .btn-fire::before {
        content: '';
        position: absolute;
        top: -25%;
        bottom: -25%;
        left: 0;
        width: 45%;
        background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.75) 50%, transparent 100%);
        transform: translateX(-120%) skewX(-18deg);
        opacity: 0;
        pointer-events: none;
        z-index: 1;
      }

      #cta .btn-fire:hover {
        transform: scale(1.06) skewX(-2deg);
        box-shadow: 0 10px 28px rgba(255, 80, 0, 0.28);
      }

      #cta .btn-fire:hover::before {
        animation: spotlightBtnShine 0.65s ease forwards;
      }

      #cta .btn-ghost {
        padding: 14px 38px;
        background: transparent;
        border: 2px solid #ff6b00;
        color: #ff6b00;
        clip-path: polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%);
      }

      #cta .btn-ghost::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, #ff4d00, #ffaa00);
        transform: scaleX(0);
        transform-origin: left center;
        transition: transform 0.35s cubic-bezier(0.23, 1, 0.32, 1);
        z-index: 0;
      }

      #cta .btn-ghost:hover {
        color: #000;
        box-shadow: 0 8px 22px rgba(255, 80, 0, 0.18);
      }

      #cta .btn-ghost:hover::after {
        transform: scaleX(1);
      }

      #cta .order-cta-meta {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 3px;
        color: #ffcc33;
        text-transform: uppercase;
        margin: 0;
        opacity: 0.95;
      }

      @media (max-width: 640px) {
        #cta .order-cta-actions {
          flex-direction: column;
          width: 100%;
        }

        #cta .btn-fire,
        #cta .btn-ghost {
          width: 100%;
          max-width: 360px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        #cta .btn-fire:hover {
          transform: none;
        }
      }

      /* ── Fire embers (global) ───────────────────────────────────────── */
      @keyframes riseEmber {
        0% {
          transform: translateY(0) translateX(0) scale(1);
          opacity: 0;
        }
        10% {
          opacity: var(--max-opacity);
        }
        50% {
          transform: translateY(-50vh) translateX(var(--drift)) scale(0.8);
        }
        85% {
          opacity: var(--fade-opacity);
        }
        100% {
          transform: translateY(-110vh) translateX(var(--drift-end)) scale(0);
          opacity: 0;
        }
      }

      .fire-embers {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 100%;
        pointer-events: none;
        overflow: hidden;
        z-index: 996;
      }

      .fire-base {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 120px;
        background: linear-gradient(to top, rgba(255, 77, 0, 0.08), rgba(255, 60, 0, 0.03) 40%, transparent);
        pointer-events: none;
        z-index: 0;
      }

      .heat-distort {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 200px;
        background: transparent;
        backdrop-filter: blur(0.5px);
        -webkit-backdrop-filter: blur(0.5px);
        mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.3), transparent);
        -webkit-mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.3), transparent);
        pointer-events: none;
        z-index: 1;
      }

      .ember {
        position: absolute;
        bottom: -20px;
        border-radius: 50%;
        will-change: transform, opacity;
        animation-name: riseEmber;
        animation-timing-function: ease-out;
        animation-iteration-count: infinite;
        z-index: 2;
      }

      .ember--small {
        width: 2px;
        height: 2px;
        background: #ff4d00;
        filter: blur(1px);
      }

      .ember--small.ember--noblur-small {
        filter: none;
      }

      .ember--medium {
        width: 4px;
        height: 4px;
        background: #ff6b00;
        filter: blur(0.5px);
        box-shadow: 0 0 6px 2px rgba(255, 107, 0, 0.3);
      }

      .ember--large {
        width: 6px;
        height: 6px;
        background: #ffaa00;
        filter: blur(0);
        box-shadow:
          0 0 12px 4px rgba(255, 170, 0, 0.4),
          0 0 24px 8px rgba(255, 77, 0, 0.15);
      }

      @media (prefers-reduced-motion: reduce) {
        .fire-embers {
          display: none;
        }
      }

      @media (max-width: 900px) {
        .heat-distort {
          display: none;
        }
      }

      /* ── Site footer (#footer) ─────────────────────────────────────── */
      #footer {
        flex-shrink: 0;
        background: #020100;
        border-top: 1px solid #0e0500;
        padding: 56px clamp(1.25rem, 4vw, 4.25rem) 36px;
        box-sizing: border-box;
      }

      #footer .footer-top {
        display: grid;
        grid-template-columns:
          minmax(220px, 1.05fr)
          minmax(280px, 1.2fr)
          minmax(250px, 1fr)
          minmax(150px, 0.65fr);
        align-items: flex-start;
        gap: clamp(28px, 3.2vw, 48px);
        max-width: min(1320px, 100%);
        margin: 0 auto 44px;
      }

      #footer .nav-brand {
        font-family: 'Black Han Sans', sans-serif;
        font-size: 32px;
        letter-spacing: 3px;
        margin-bottom: 8px;
        line-height: 1.1;
      }

      #footer .footer-logo-wings {
        color: #ff6b00;
      }

      #footer .footer-logo-four {
        color: #fff;
      }

      #footer .footer-brand p {
        font-size: 15px;
        color: #ffd500;
        line-height: 1.6;
        max-width: 320px;
        margin: 0;
      }

      #footer .footer-col h4 {
        font-family: 'Oswald', sans-serif;
        font-size: clamp(15px, 1.25vw, 18px);
        letter-spacing: 2.4px;
        color: #ff4d00;
        font-weight: 700;
        opacity: 1;
        margin: 0 0 18px;
        text-transform: uppercase;
      }

      #footer .footer-col h4::after {
        content: '.';
      }

      #footer .footer-col {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        width: 100%;
        min-width: 0;
      }

      #footer .footer-col--menu {
        max-width: 380px;
      }

      #footer .footer-col--visit {
        max-width: 360px;
      }

      #footer .footer-col--info {
        max-width: 180px;
      }

      #footer .footer-col a,
      #footer .footer-col p,
      #footer .footer-hours-toggle {
        font-family: 'Rajdhani', sans-serif;
        font-size: 15px;
        color: #ffd500;
        text-decoration: none;
        margin: 0 0 10px;
        line-height: 1.45;
      }

      #footer .footer-menu-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 20px;
        width: 100%;
      }

      #footer .footer-menu-grid a,
      #footer .footer-menu-grid .footer-menu-loading {
        margin: 0;
      }

      #footer .footer-menu-loading {
        font-family: 'Rajdhani', sans-serif;
        font-size: 15px;
        color: rgba(255, 213, 0, 0.55);
      }

      #footer .footer-menu-head-row {
        width: 100%;
      }

      #footer .footer-menu-head-row h4 {
        margin: 0 0 18px;
      }

      #footer .footer-menu-disclosure--mobile {
        display: none;
      }

      #footer .footer-menu-mobile-panel {
        width: 100%;
        margin-top: 10px;
        padding-left: 2px;
      }

      #footer .footer-menu-mobile-panel a {
        margin: 0 0 10px;
        display: block;
      }

      #footer .footer-menu-mobile-summary {
        font-size: clamp(13px, 3.4vw, 15px);
        padding: 10px 12px;
      }

      #footer .footer-col a:hover {
        color: #ff6b00;
      }

      #footer .footer-address {
        margin-bottom: 8px;
        max-width: 100%;
      }

      #footer .footer-hours-disclosure {
        width: 100%;
        margin-top: 4px;
      }

      #footer .footer-hours-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        margin: 0;
        padding: 11px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255, 77, 0, 0.24);
        background: rgba(15, 6, 1, 0.9);
        cursor: pointer;
        list-style: none;
        box-sizing: border-box;
      }

      #footer .footer-hours-toggle::-webkit-details-marker {
        display: none;
      }

      #footer .footer-hours-toggle::after {
        content: '▾';
        color: #ff4d00;
        font-size: 15px;
        line-height: 1;
        transition: transform 0.22s ease;
      }

      #footer .footer-hours-disclosure[open] .footer-hours-toggle::after {
        transform: rotate(180deg);
      }

      #footer .footer-hours {
        width: 100%;
        margin: 12px 0 0;
        padding-left: 2px;
      }

      #footer .footer-hours p {
        margin: 0 0 6px;
      }

      #footer .footer-bottom {
        display: flex;
        justify-content: space-between;
        align-items: center;
        max-width: min(1320px, 100%);
        margin: 0 auto;
        padding-top: 28px;
        border-top: 1px solid #0e0500;
        flex-wrap: wrap;
        gap: 12px;
      }

      #footer .footer-bottom p {
        font-size: 12px;
        color: #ffd500;
        letter-spacing: 1px;
        margin: 0;
      }

      #footer .footer-social {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      #footer .social-btn {
        width: 36px;
        height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        background: #0e0500;
        border: 1px solid #1e0a00;
        font-size: 16px;
        line-height: 1;
        text-decoration: none;
        transition: border-color 0.2s ease;
      }

      #footer .social-btn:hover {
        border-color: rgba(255, 77, 0, 0.4);
      }

      @media (max-width: 1080px) {
        #footer .footer-top {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        #footer .footer-col--menu,
        #footer .footer-col--visit,
        #footer .footer-col--info {
          max-width: none;
        }
      }

      @media (max-width: 720px) {
        #footer {
          padding: 48px clamp(1rem, 5vw, 1.5rem) 30px;
        }

        #footer .footer-top {
          grid-template-columns: 1fr;
          gap: 28px;
          margin-bottom: 36px;
        }

        #footer .footer-menu-disclosure--mobile {
          display: block;
          flex: 1 1 auto;
          min-width: 0;
          max-width: min(220px, 56vw);
        }

        #footer .footer-menu-disclosure--mobile[open] {
          flex-basis: 100%;
          max-width: none;
          width: 100%;
        }

        #footer .footer-menu-grid--desktop {
          display: none !important;
        }

        #footer .footer-menu-head-row {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 0;
        }

        #footer .footer-menu-head-row h4 {
          margin-bottom: 0;
        }
      }

      @media (max-width: 440px) {
        #footer .footer-menu-grid {
          grid-template-columns: 1fr;
        }
      }

      /* ── Back to top ────────────────────────────────────────────── */

      .wk-back-to-top {
        position: fixed;
        bottom: 28px;
        right: 28px;
        z-index: 180;
        width: 44px;
        height: 44px;
        display: grid;
        place-items: center;
        border-radius: 14px;
        border: 1px solid rgba(245, 166, 35, 0.45);
        background: rgba(10, 10, 10, 0.88);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: #f5a623;
        font-size: 20px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
      }

      .wk-back-to-top:hover {
        transform: translateY(-2px);
        border-color: #f5a623;
        box-shadow: 0 14px 36px rgba(245, 166, 35, 0.2);
      }

      /* Cart: sticky column (pickup/delivery + summary) stays below main nav */
      .wk-cart-right-column {
        position: sticky;
        top: calc(var(--wk-nav-offset, 64px) + 10px);
        z-index: 170;
        align-self: flex-start;
      }

      /* Cart: desktop-only — nudge settings bar from the right edge beside YOUR ORDER.
         On mobile, no extra margin so the bar stays visually centered in the yellow panel. */
      @media (min-width: 761px) {
        .wk-cart-order-settings-top {
          margin-right: clamp(44px, 7.25vw, 128px);
        }
      }

      /* Cart: pickup/delivery bar layout (right column or top row beside YOUR ORDER). */
      .wk-cart-right-column .wk-order-settings-shell,
      .wk-cart-order-settings-top .wk-order-settings-shell {
        width: 100%;
        max-width: 100%;
      }

      .wk-cart-right-column .wk-order-settings-bar,
      .wk-cart-order-settings-top .wk-order-settings-bar {
        width: 100%;
        max-width: 100%;
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-start;
        gap: 10px 12px;
        row-gap: 12px;
        box-sizing: border-box;
      }

      .wk-cart-right-column .wk-order-fulfillment-display,
      .wk-cart-order-settings-top .wk-order-fulfillment-display {
        display: flex;
        flex: 0 0 100%;
        width: 100%;
        min-width: 0;
        gap: 8px;
        box-sizing: border-box;
      }

      .wk-cart-right-column .wk-order-fulfillment-chip,
      .wk-cart-order-settings-top .wk-order-fulfillment-chip {
        flex: 1 1 0;
        min-width: 0;
        justify-content: center;
        text-align: center;
      }

      /* Two columns only: date | time row. (A third 1fr column with only two children stole width and squeezed the time row, overlapping text + Change.) */
      .wk-cart-right-column .wk-order-settings-meta,
      .wk-cart-order-settings-top .wk-order-settings-meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: stretch;
        column-gap: 0;
        row-gap: 14px;
        flex: 1 1 auto;
        min-width: 0;
        border-left: none;
        padding-left: 0;
      }

      .wk-cart-right-column .wk-order-settings-meta.wk-order-settings-meta--delivery,
      .wk-cart-order-settings-top .wk-order-settings-meta.wk-order-settings-meta--delivery {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .wk-cart-right-column .wk-order-settings-chip--address,
      .wk-cart-order-settings-top .wk-order-settings-chip--address {
        max-width: none;
        min-width: 0;
      }

      .wk-cart-right-column .wk-order-settings-chip,
      .wk-cart-order-settings-top .wk-order-settings-chip {
        white-space: nowrap;
        min-width: 0;
        padding: 0 16px;
      }

      .wk-cart-right-column .wk-order-settings-meta > .wk-order-settings-chip + .wk-order-settings-chip,
      .wk-cart-order-settings-top .wk-order-settings-meta > .wk-order-settings-chip + .wk-order-settings-chip {
        border-left: 1px solid rgba(255,255,255,0.1);
      }

      .wk-cart-right-column .wk-order-settings-action,
      .wk-cart-order-settings-top .wk-order-settings-action {
        position: relative;
        grid-column: 1 / -1;
        width: 100%;
        margin-top: 2px;
      }

      .wk-cart-right-column .wk-order-settings-action::before,
      .wk-cart-order-settings-top .wk-order-settings-action::before {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: -9px;
        border-top: 1px solid rgba(255,255,255,0.1);
        pointer-events: none;
      }

      @media (max-width: 1100px) and (min-width: 761px) {
        .wk-order-sticky-stack .wk-order-settings-shell,
        .wk-order-sticky-stack .wk-order-settings-bar {
          width: 100%;
        }

        .wk-order-sticky-stack .wk-order-settings-bar {
          flex-wrap: wrap;
          gap: 12px;
        }

        .wk-order-sticky-stack .wk-order-fulfillment-display {
          width: 100%;
        }

        .wk-order-sticky-stack .wk-order-fulfillment-display .wk-order-fulfillment-chip {
          flex: 1 1 0;
          justify-content: center;
        }

        .wk-order-sticky-stack .wk-order-settings-meta {
          display: grid;
          width: 100%;
          border-left: none;
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 12px;
          padding-left: 0;
          column-gap: 0;
          row-gap: 0;
        }

        .wk-order-sticky-stack .wk-order-settings-meta:not(.wk-order-settings-meta--delivery) {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .wk-order-sticky-stack .wk-order-settings-meta.wk-order-settings-meta--delivery {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .wk-order-sticky-stack .wk-order-settings-chip,
        .wk-order-sticky-stack .wk-order-settings-action {
          width: 100%;
          min-width: 0;
        }

        .wk-order-sticky-stack .wk-order-settings-chip--address {
          max-width: none;
        }

        .wk-order-sticky-stack .wk-order-settings-action {
          margin-top: 0;
        }
      }

      /* Cart line card: wide = thumb left; phone = full-width thumb on top, footer row qty | actions */
      .wk-cart-line-card-row {
        display: flex;
        gap: 16px;
        align-items: flex-start;
      }

      .wk-cart-line-thumb {
        width: 88px;
        min-width: 88px;
        height: 88px;
        flex-shrink: 0;
      }

      .wk-cart-line-card-body {
        flex: 1;
        min-width: 0;
      }

      @media (max-width: 640px) {
        .wk-cart-line-card-row {
          flex-direction: column;
          align-items: stretch;
          gap: 12px;
        }

        .wk-cart-line-thumb {
          width: 100%;
          min-width: 0;
          height: clamp(140px, 38vw, 200px);
          max-height: 220px;
        }

        .wk-cart-line-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .wk-cart-line-thumb-placeholder {
          font-size: clamp(32px, 10vw, 52px) !important;
          letter-spacing: 0.06em;
        }

        .wk-cart-line-card-body {
          flex: none;
          width: 100%;
        }

        .wk-cart-line-footer {
          flex-wrap: nowrap !important;
          justify-content: space-between !important;
          align-items: center !important;
          gap: 10px !important;
        }

        .wk-cart-line-actions {
          flex-wrap: nowrap !important;
          flex-shrink: 0;
          gap: 8px !important;
        }

        .wk-cart-line-actions button {
          white-space: nowrap;
        }

        .wk-cart-line-footer .cart-item-qty-wrap {
          flex-shrink: 0;
        }
      }

      .cart-item-qty-wrap {
        border: 1px solid rgba(245, 166, 35, 0.55);
        border-radius: 999px;
        padding: 3px 6px;
        background: rgba(255, 244, 230, 0.16);
        box-shadow:
          inset 0 1px 0 rgba(255, 230, 200, 0.22),
          0 2px 8px rgba(0, 0, 0, 0.2);
      }

      .cart-item-qty-btn {
        width: 30px;
        height: 30px;
        border-radius: 999px;
        border: none;
        background: rgba(255, 255, 255, 0.08);
        color: #ff9a5c;
        font-family: 'Bebas Neue', sans-serif;
        font-size: 18px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        cursor: pointer;
        transition: background 0.2s ease, color 0.2s ease, transform 0.15s ease;
      }

      .cart-item-qty-btn:hover {
        background: rgba(245, 166, 35, 0.45);
        color: #170f09;
      }

      .cart-item-qty-btn:active {
        transform: scale(0.94);
      }

      .cart-line-btn-edit:hover {
        background: rgba(245, 166, 35, 0.42) !important;
        border-color: rgba(245, 166, 35, 0.65) !important;
        color: #170f09 !important;
        transform: translateY(-1px);
      }

      .cart-line-btn-remove:hover {
        background: rgba(255, 120, 60, 0.18) !important;
        border-color: rgba(255, 180, 120, 0.55) !important;
        color: #ffd4c4 !important;
        transform: translateY(-1px);
      }

      .cart-promo-apply-btn:hover {
        background: rgba(245, 166, 35, 0.2) !important;
        border-color: rgba(245, 166, 35, 0.45) !important;
        color: #fff8ef !important;
        transform: translateY(-1px);
      }

      /* Cart: secondary link back to /order (matches YOUR ORDER header) */
      .cart-back-to-menu-link {
        display: inline-flex;
        align-items: center;
        margin-top: 14px;
        padding: 0.5rem 1.15rem 0.5rem 0.95rem;
        border-radius: 999px;
        font-family: 'DM Sans', sans-serif;
        font-weight: 700;
        font-size: clamp(14px, 1.4vw, 16px);
        letter-spacing: 0.03em;
        color: #0c0300;
        background: rgba(255, 255, 255, 0.5);
        border: 2px solid rgba(194, 73, 20, 0.38);
        box-shadow: 0 2px 10px rgba(12, 3, 0, 0.08);
        text-decoration: none;
        transition:
          background 0.18s ease,
          border-color 0.18s ease,
          transform 0.18s ease,
          box-shadow 0.18s ease;
      }

      .cart-back-to-menu-link:hover {
        background: rgba(255, 255, 255, 0.78);
        border-color: rgba(245, 166, 35, 0.55);
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(12, 3, 0, 0.1);
      }

      .cart-back-to-menu-link:focus-visible {
        outline: 2px solid rgba(245, 166, 35, 0.75);
        outline-offset: 3px;
      }

      /* Sauces page CTA gradient (see sauces-page .btnFire) */
      .cart-checkout-fire-btn {
        margin-top: 18px;
        width: 100%;
        box-sizing: border-box;
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        isolation: isolate;
        padding: 16px 24px;
        border: none;
        cursor: pointer;
        background: linear-gradient(135deg, #ff4d00, #ff6b00, #ffaa00);
        color: #000;
        font-family: 'Black Han Sans', sans-serif;
        font-size: clamp(16px, 2vw, 18px);
        letter-spacing: 3px;
        text-transform: uppercase;
        clip-path: polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%);
        transition: transform 0.3s, box-shadow 0.3s;
      }

      .cart-checkout-fire-btn::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.28), transparent);
        transform: translateX(-100%);
        transition: transform 0.45s;
        z-index: 1;
        pointer-events: none;
      }

      .cart-checkout-fire-btn .btn-label {
        position: relative;
        z-index: 2;
      }

      .cart-checkout-fire-btn:hover:not(:disabled) {
        transform: scale(1.04) skewX(-2deg);
        box-shadow:
          0 14px 36px rgba(255, 80, 0, 0.34),
          0 0 0 1px rgba(255, 200, 120, 0.22) inset;
        filter: saturate(1.06) brightness(1.02);
      }

      .cart-checkout-fire-btn:hover:not(:disabled)::before {
        transform: translateX(100%);
      }

      .cart-checkout-fire-btn:active:not(:disabled) {
        transform: scale(0.99) skewX(-1deg);
        box-shadow: 0 6px 18px rgba(255, 80, 0, 0.2);
        filter: saturate(1);
      }

      .cart-checkout-fire-btn:focus {
        outline: none;
      }

      .cart-checkout-fire-btn:focus-visible {
        outline: 2px solid rgba(255, 200, 100, 0.95);
        outline-offset: 3px;
      }

      @media (max-width: 760px) {
        .wk-cart-right-column {
          position: static;
          z-index: auto;
        }

        :root {
          --wk-menu-bar-outdent: 0px;
        }

        .wk-order-sticky-stack > .wk-order-settings-shell,
        .wk-order-sticky-stack > .wk-menu-sticky-cats {
          margin-left: 0;
          margin-right: 0;
          width: 100%;
        }

        .wk-order-settings-bar {
          width: 100%;
          flex-wrap: wrap;
          justify-content: flex-start;
          gap: 10px;
          padding: 12px;
        }
        .wk-order-fulfillment-display,
        .wk-order-settings-panel-toggle {
          width: 100%;
        }
        .wk-order-fulfillment-display .wk-order-fulfillment-chip,
        .wk-order-settings-panel-toggle .wk-order-fulfillment-btn {
          flex: 1 1 0;
          justify-content: center;
        }
        .wk-order-settings-meta {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: stretch;
          column-gap: 12px;
          row-gap: 10px;
          border-left: none;
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-left: 0;
          padding-top: 10px;
        }
        /* Menu (/order): mobile + delivery — date, time, address one row; Change full width below */
        .wk-order-sticky-stack .wk-order-settings-meta > .wk-order-settings-chip--address,
        .wk-order-sticky-stack .wk-order-settings-meta > .wk-order-settings-action {
          grid-column: 1 / -1;
        }
        /* Cart: mobile — pickup: date | time row; Change full width; delivery: date, time, address, then Change */
        .wk-cart-right-column .wk-order-settings-meta:not(.wk-order-settings-meta--delivery),
        .wk-cart-order-settings-top .wk-order-settings-meta:not(.wk-order-settings-meta--delivery) {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          align-items: center;
          column-gap: 10px;
          row-gap: 10px;
        }
        .wk-cart-right-column .wk-order-settings-meta:not(.wk-order-settings-meta--delivery) .wk-order-settings-schedule-row,
        .wk-cart-order-settings-top .wk-order-settings-meta:not(.wk-order-settings-meta--delivery) .wk-order-settings-schedule-row {
          display: contents;
        }
        .wk-cart-right-column .wk-order-settings-meta:not(.wk-order-settings-meta--delivery) .wk-order-settings-time-row,
        .wk-cart-order-settings-top .wk-order-settings-meta:not(.wk-order-settings-meta--delivery) .wk-order-settings-time-row {
          display: contents;
        }
        .wk-cart-right-column .wk-order-settings-meta:not(.wk-order-settings-meta--delivery) .wk-order-settings-chip--address,
        .wk-cart-order-settings-top .wk-order-settings-meta:not(.wk-order-settings-meta--delivery) .wk-order-settings-chip--address {
          grid-column: 1 / -1;
        }
        .wk-cart-right-column .wk-order-settings-meta:not(.wk-order-settings-meta--delivery) > .wk-order-settings-action,
        .wk-cart-order-settings-top .wk-order-settings-meta:not(.wk-order-settings-meta--delivery) > .wk-order-settings-action {
          grid-column: 1 / -1;
          width: 100%;
          max-width: none;
        }
        .wk-cart-right-column .wk-order-settings-meta.wk-order-settings-meta--delivery,
        .wk-cart-order-settings-top .wk-order-settings-meta.wk-order-settings-meta--delivery {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 10px;
          row-gap: 10px;
          width: 100%;
        }
        .wk-cart-right-column .wk-order-settings-meta.wk-order-settings-meta--delivery .wk-order-settings-schedule-row,
        .wk-cart-order-settings-top .wk-order-settings-meta.wk-order-settings-meta--delivery .wk-order-settings-schedule-row {
          display: contents;
        }
        .wk-cart-right-column .wk-order-settings-meta.wk-order-settings-meta--delivery .wk-order-settings-time-row,
        .wk-cart-order-settings-top .wk-order-settings-meta.wk-order-settings-meta--delivery .wk-order-settings-time-row {
          display: contents;
        }
        .wk-cart-right-column .wk-order-settings-meta.wk-order-settings-meta--delivery > .wk-order-settings-chip--date,
        .wk-cart-order-settings-top .wk-order-settings-meta.wk-order-settings-meta--delivery > .wk-order-settings-chip--date {
          order: 1;
        }
        .wk-cart-right-column .wk-order-settings-meta.wk-order-settings-meta--delivery > .wk-order-settings-chip--time,
        .wk-cart-order-settings-top .wk-order-settings-meta.wk-order-settings-meta--delivery > .wk-order-settings-chip--time {
          order: 2;
        }
        .wk-cart-right-column .wk-order-settings-meta.wk-order-settings-meta--delivery > .wk-order-settings-chip--address,
        .wk-cart-order-settings-top .wk-order-settings-meta.wk-order-settings-meta--delivery > .wk-order-settings-chip--address {
          order: 3;
        }
        .wk-cart-right-column .wk-order-settings-meta.wk-order-settings-meta--delivery > .wk-order-settings-action,
        .wk-cart-order-settings-top .wk-order-settings-meta.wk-order-settings-meta--delivery > .wk-order-settings-action {
          order: 4;
          width: 100%;
          max-width: none;
        }
        .wk-cart-right-column .wk-order-settings-chip + .wk-order-settings-schedule-row,
        .wk-cart-order-settings-top .wk-order-settings-chip + .wk-order-settings-schedule-row {
          border-top: none;
          padding-top: 0;
        }
        /* Date + time share row; suppress chip+chip divider between those two only */
        .wk-cart-right-column .wk-order-settings-meta > .wk-order-settings-chip + .wk-order-settings-chip,
        .wk-cart-order-settings-top .wk-order-settings-meta > .wk-order-settings-chip + .wk-order-settings-chip {
          border-top: none;
          padding-top: 0;
        }
        .wk-order-settings-chip {
          min-height: auto;
          padding: 0;
        }
        .wk-order-settings-chip--address {
          max-width: none;
        }
        .wk-order-settings-chip + .wk-order-settings-chip {
          border-left: none;
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 8px;
        }
        .wk-order-settings-chip + .wk-order-settings-time-row {
          border-left: none;
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 8px;
        }
        .wk-order-settings-time-row + .wk-order-settings-chip {
          border-left: none;
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 8px;
        }
        .wk-order-settings-action,
        .wk-order-settings-panel {
          width: 100%;
        }

        .wk-order-settings-time-row .wk-order-settings-action {
          width: auto;
        }

        .wk-order-settings-action {
          margin-left: 0;
        }

        .wk-order-sticky-stack .wk-order-settings-meta,
        .wk-cart-right-column .wk-order-settings-meta,
        .wk-cart-order-settings-top .wk-order-settings-meta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: stretch;
          column-gap: 12px;
          row-gap: 10px;
        }

        .wk-cart-right-column .wk-order-settings-meta.wk-order-settings-meta--delivery,
        .wk-cart-order-settings-top .wk-order-settings-meta.wk-order-settings-meta--delivery {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .wk-order-sticky-stack .wk-order-settings-meta > .wk-order-settings-chip--address,
        .wk-order-sticky-stack .wk-order-settings-meta > .wk-order-settings-action,
        .wk-cart-right-column .wk-order-settings-meta > .wk-order-settings-chip--address,
        .wk-cart-order-settings-top .wk-order-settings-meta > .wk-order-settings-chip--address,
        .wk-cart-right-column .wk-order-settings-meta > .wk-order-settings-action,
        .wk-cart-order-settings-top .wk-order-settings-meta > .wk-order-settings-action {
          grid-column: 1 / -1;
        }

        .wk-order-sticky-stack .wk-order-settings-chip,
        .wk-cart-right-column .wk-order-settings-chip,
        .wk-cart-order-settings-top .wk-order-settings-chip {
          min-height: auto;
          padding: 0;
          white-space: normal;
        }

        .wk-order-sticky-stack .wk-order-settings-chip--address,
        .wk-cart-right-column .wk-order-settings-chip--address,
        .wk-cart-order-settings-top .wk-order-settings-chip--address {
          max-width: none;
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 10px;
        }

        .wk-order-sticky-stack .wk-order-settings-meta > .wk-order-settings-chip + .wk-order-settings-chip,
        .wk-cart-right-column .wk-order-settings-meta > .wk-order-settings-chip + .wk-order-settings-chip,
        .wk-cart-order-settings-top .wk-order-settings-meta > .wk-order-settings-chip + .wk-order-settings-chip {
          border-left: none;
          border-top: none;
          padding-top: 0;
        }

        .wk-order-sticky-stack .wk-order-settings-action,
        .wk-cart-right-column .wk-order-settings-action,
        .wk-cart-order-settings-top .wk-order-settings-action {
          width: 100%;
          margin-top: 4px;
        }

        .wk-order-sticky-stack .wk-order-settings-action::before,
        .wk-cart-right-column .wk-order-settings-action::before,
        .wk-cart-order-settings-top .wk-order-settings-action::before {
          top: -11px;
        }
        .wk-order-settings-grid {
          grid-template-columns: 1fr;
        }
        .wk-method-card-inner {
          padding: 28px 18px 22px;
        }
        .wk-method-options {
          flex-direction: column;
        }
        .wk-method-address-row {
          grid-template-columns: 1fr;
        }
        .wk-method-option-desc {
          max-width: none;
        }
      }
    `}</style>
  );
}
