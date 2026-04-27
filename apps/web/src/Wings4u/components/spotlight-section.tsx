"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const TAGS = ["MEDIUM HEAT", "BONE-IN / BONELESS", "6 PCS", "HOUSE RANCH"] as const;

export function SpotlightSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }

    const el = sectionRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  const show = visible ? " is-visible" : "";

  return (
    <section id="spotlight" ref={sectionRef} className="spotlight-section">
      <div className="spotlight-inner">
        <div className={`spotlight-visual reveal-left${show}`}>
          <div className="spotlight-glow-wrap" aria-hidden="true">
            <div className="spotlight-glow" />
          </div>
          <span className="spotlight-emoji" aria-hidden="true">
            {"\u{1F525}"}
          </span>
          <span className="spotlight-badge">FAN FAVOURITE</span>
        </div>

        <div className={`spotlight-copy reveal-right${show}`}>
          <p className="section-label spotlight-section-label">Signature Item</p>
          <h2 className="spotlight-title">
            <span className="spotlight-title-line">CLASSIC</span>
            <span className="spotlight-title-line gradient-text">BUFFALO</span>
          </h2>
          <p className="spotlight-desc">
            The one that started it all. Our signature cayenne buffalo sauce coats every crevice of a
            perfectly crispy wing. Bone-in or boneless {"\u2014"} both life-changing. Served with house-made
            ranch or blue cheese.
          </p>
          <ul className="spotlight-tags" aria-label="Item details">
            {TAGS.map((tag) => (
              <li key={tag} className="spotlight-tag">
                {tag}
              </li>
            ))}
          </ul>
          <p className="spotlight-price" aria-label="Price 12 dollars 99 cents">
            $12.99
          </p>
          <div className="spotlight-actions">
            <Link href="/order" className="btn-fire">
              <span className="spotlight-btn-label">ADD TO ORDER</span>
            </Link>
            <Link href="/menu" className="btn-ghost">
              <span className="spotlight-btn-label">NEXT</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
