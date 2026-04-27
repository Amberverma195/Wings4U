"use client";

import { useEffect, useRef, useState } from "react";

type Review = {
  quote: string;
  name: string;
  handle: string;
  source: "Google" | "Yelp" | "UberEats";
};

const REVIEWS: Review[] = [
  {
    quote:
      "Honey Gold is absolutely unreal. Sweet, smoky, sticky in the best possible way. My weekly ritual.",
    name: "Priya S.",
    handle: "@priya_foodie",
    source: "Google",
  },
  {
    quote:
      "Crispy every time. The dry rubs are insane \u2014 I rotate between Lemon Pepper and Cajun. London finally has real wings.",
    name: "Marcus T.",
    handle: "@marcus_eats",
    source: "Yelp",
  },
  {
    quote:
      "Ordered for the office. Fifteen minutes later we were fighting over the last drumette. Worth every penny.",
    name: "Aisha K.",
    handle: "@aisha.kitchen",
    source: "UberEats",
  },
  {
    quote:
      "Bone-in, extra sauce, no regrets. The buffalo has actual heat and flavor \u2014 not just vinegar.",
    name: "Jordan L.",
    handle: "@jordo_wings",
    source: "Google",
  },
  {
    quote:
      "Delivery was fast and the wings were still crunchy. That should be illegal. Already ordered again.",
    name: "Sam R.",
    handle: "@samreviewsfood",
    source: "Yelp",
  },
];

function avatarInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

export function TestimonialsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduceMotion(true);
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
      { threshold: 0.1 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  const show = visible ? " in" : "";
  const loop = reduceMotion ? REVIEWS : [...REVIEWS, ...REVIEWS];

  return (
    <section
      id="testimonials"
      ref={sectionRef}
      aria-labelledby="testimonials-heading"
    >
      <div className={`testimonials-head reveal${show}`}>
        <p className="section-label">REAL PEOPLE</p>
        <h2 id="testimonials-heading">
          <span>THE PEOPLE HAVE </span>
          <span className="gradient-text">SPOKEN</span>
        </h2>
        <div className="section-divider" aria-hidden="true" />
      </div>

      <div
        className={`testimonials-track-wrapper${reduceMotion ? " testimonials-track-wrapper--static" : ""}`}
      >
        <div
          className={`testimonials-track${reduceMotion ? " testimonials-track--static" : ""}`}
          aria-hidden={reduceMotion ? undefined : true}
        >
          {loop.map((review, i) => (
            <article key={`${review.name}-${review.handle}-${i}`} className="tcard">
              <div className="tcard-stars" aria-hidden="true">
                {"\u2605".repeat(5)}
              </div>
              <p className="tcard-text">&ldquo;{review.quote}&rdquo;</p>
              <div className="tcard-author">
                <div className="tcard-avatar" aria-hidden="true">
                  {avatarInitial(review.name)}
                </div>
                <div>
                  <div className="tcard-name">{review.name}</div>
                  <div className="tcard-handle">{review.handle}</div>
                </div>
              </div>
              <span className="tcard-source">{review.source}</span>
            </article>
          ))}
        </div>
      </div>

      {!reduceMotion ? (
        <ul className="testimonials-sr-list">
          {REVIEWS.map((review) => (
            <li key={review.handle}>
              {review.quote} {"\u2014"} {review.name}, {review.source}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
