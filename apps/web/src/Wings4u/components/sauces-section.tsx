"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { SAUCE_CATEGORY_META, SAUCE_MARKETING_TOTAL, type SauceFlavour } from "../data/sauces";

const COPIES = 2;

function SauceCard({ sauce }: { sauce: SauceFlavour }) {
  const categoryMeta = SAUCE_CATEGORY_META[sauce.cat];
  const label = categoryMeta.badge;
  const categoryAccent = categoryMeta.accent;
  const visualAccent = sauce.visualAccent;

  return (
    <div
      className="sauce-card"
      style={
        {
          "--category-c": categoryAccent,
          "--sauce-c": visualAccent,
        } as CSSProperties
      }
    >
      <div className="sauce-emoji" aria-hidden="true">
        {sauce.icon}
      </div>
      <div className="sauce-name">{sauce.displayName}</div>
      <div
        className="sauce-spice-footer"
        aria-label={`Spice level: ${label}`}
      >
        <div className="sauce-heat-row" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`heat-chilli${
                i < sauce.carouselHeat ? " heat-chilli--active" : ""
              }`}
            >
              {"\u{1F336}\u{FE0F}"}
            </span>
          ))}
        </div>
        <span
          className="sauce-badge"
          style={{
            background: `${categoryAccent}22`,
            border: `1px solid ${categoryAccent}44`,
            color: categoryAccent,
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

export function SaucesSection({ sauces }: { sauces: SauceFlavour[] }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const [carouselIn, setCarouselIn] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInView(true);
      setCarouselIn(true);
      return;
    }

    const el = sectionRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          timerRef.current = window.setTimeout(() => {
            setCarouselIn(true);
          }, 400);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );

    io.observe(el);
    return () => {
      io.disconnect();
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <section id="sauces" ref={sectionRef} className="sauces-section">
      <div className={`sauce-header reveal${inView ? " reveal--visible" : ""}`}>
        <p className="section-label sauces-section-label">The Lineup</p>

        <h2 className="sauce-count-wrapper">
          <span className={`sauce-count-hero${inView ? " sauce-count-hero--play" : ""}`}>{SAUCE_MARKETING_TOTAL}+</span>
          <span className="sauce-count-sub">
            <span className="sauce-count-sub-main">Sauces &amp; Dry Rubs</span>
            <span className="sauce-zero-excuses">Zero Excuses.</span>
          </span>
        </h2>
      </div>

      <div
        className={`sauce-carousel-wrapper${carouselIn ? " sauce-carousel-wrapper--in" : ""}`}
      >
        <div className="sauce-carousel-track">
          {Array.from({ length: COPIES }, (_, copyIdx) =>
            sauces.map((sauce) => <SauceCard key={`${copyIdx}-${sauce.id}`} sauce={sauce} />),
          ).flat()}
        </div>
      </div>
    </section>
  );
}
