"use client";

import { useEffect, useRef, useState } from "react";

const ITEMS = [
  { emoji: "\u{1F357}", text: "WINGS" },
  { emoji: "\u{1F9C4}", text: "GARLIC BREADS" },
  { emoji: "\u{1F35F}", text: "POUTINES" },
  { emoji: "\u{1F32F}", text: "WRAPS" },
  { emoji: "\u{1F354}", text: "BURGERS" },
  { emoji: "\u{1F957}", text: "SALADS" },
  { emoji: "\u{1F357}", text: "CHICKEN TENDERS" },
  { emoji: "\u{1F95F}", text: "APPETIZERS" },
] as const;

/** Muted tints from the site palette (gold / amber / warm cream) â€” one per category, no duplicate hex */
const GHOST_TINTS = [
  "#d4a574",
  "#c9a882",
  "#b8956a",
  "#cda06e",
  "#b99d7a",
  "#c4a080",
  "#be9a72",
  "#b38a6d",
] as const;

const COPIES = 5;

export function HeroCategoryMarquee() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setInView(true);
      return;
    }

    const el = rootRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      /* Fire as the strip nears the viewport (scroll down) */
      { threshold: 0.08, rootMargin: "0px 0px 18% 0px" },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className={`wk-hero-marquee${inView ? " wk-hero-marquee--in-view" : ""}`}
      aria-hidden="true"
    >
      <div className="wk-hero-marquee-viewport">
        <div className="wk-hero-marquee-track">
          {Array.from({ length: COPIES }, (_, copyIdx) => (
            <div key={copyIdx} className="wk-hero-marquee-chunk">
              {ITEMS.map((item, itemIdx) => {
                const globalIndex = copyIdx * ITEMS.length + itemIdx;
                /* Every 4th: accent color only â€” no emoji glow / halo in CSS */
                const isAccent = globalIndex % 4 === 3;
                const ghostColor = GHOST_TINTS[itemIdx % GHOST_TINTS.length];

                const isLastInTrack =
                  copyIdx === COPIES - 1 && itemIdx === ITEMS.length - 1;

                return (
                  <span key={`${copyIdx}-${itemIdx}`} className="wk-hero-marquee-item-wrap">
                    <span
                      className={
                        isAccent
                          ? "wk-hero-marquee-item wk-hero-marquee-item--accent"
                          : "wk-hero-marquee-item wk-hero-marquee-item--ghost"
                      }
                      style={isAccent ? undefined : { color: ghostColor }}
                    >
                      <span className="wk-hero-marquee-emoji" aria-hidden="true">
                        {item.emoji}
                      </span>{" "}
                      {item.text}
                    </span>
                    {!isLastInTrack ? <span className="wk-hero-marquee-sep">{"\u00B7"}</span> : null}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
