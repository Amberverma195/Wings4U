"use client";

import Link from "next/link";

export function OrderCtaSection() {
  return (
    <section id="cta" className="order-cta-section" aria-labelledby="cta-heading">
      <div className="order-cta-inner">
        <h2 id="cta-heading" className="order-cta-title">
          <span className="order-cta-line order-cta-line--plain">READY TO GET</span>
          <span className="order-cta-line order-cta-line--gradient">SAUCY?</span>
        </h2>

        <ul className="order-cta-badges">
          <li className="order-cta-badge">
            <span className="order-cta-badge-ico" aria-hidden="true">
              {"\u{1F6CD}\uFE0F"}
            </span>
            PICKUP IN 15 MIN
          </li>
          <li className="order-cta-badge">
            <span className="order-cta-badge-ico" aria-hidden="true">
              {"\u{1F69A}"}
            </span>
            DELIVERY AVAILABLE
          </li>
          <li className="order-cta-badge">
            <span className="order-cta-badge-ico" aria-hidden="true">
              {"\u{1F336}\uFE0F"}
            </span>
            70+ SAUCES &amp; RUBS
          </li>
        </ul>

        <p className="order-cta-sub">
          Order for pickup or get it delivered straight to your door. Hot, fresh, no compromises.
        </p>

        <div className="order-cta-actions">
          <Link href="/order" className="btn-fire">
            <span className="order-cta-btn-label">START YOUR ORDER {"\u2192"}</span>
          </Link>
          <Link href="/#sauces" className="btn-ghost">
            <span className="order-cta-btn-label">EXPLORE SAUCES</span>
          </Link>
        </div>

        <p className="order-cta-meta">MON-SUN {"\u2022"} LONDON, ON</p>
      </div>
    </section>
  );
}
