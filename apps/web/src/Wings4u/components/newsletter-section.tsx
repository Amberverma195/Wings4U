"use client";

import { useEffect, useRef, useState } from "react";

const PERKS = [
  { emoji: "\u{1F525}", text: "Weekly deals" },
  { emoji: "\u{1F9EA}", text: "New sauce alerts" },
  { emoji: "\u{1F6AB}", text: "No spam ever" },
] as const;

export function NewsletterSection() {
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

  const show = visible ? " in" : "";

  function handleOrderNow() {
    window.dispatchEvent(new Event("wings4u:open-order-method"));
  }

  return (
    <section id="newsletter" ref={sectionRef} aria-labelledby="newsletter-heading">
      <div className="bg-pattern" aria-hidden="true" />
      <div className={`newsletter-inner reveal${show}`}>
        <p className="section-label">STAY SAUCY</p>
        <h2 id="newsletter-heading">
          <span>GET </span>
          <span className="gradient-text">10% OFF</span>
          <span> YOUR FIRST ORDER</span>
        </h2>
        <button type="button" className="newsletter-btn newsletter-btn--order" onClick={handleOrderNow}>
          ORDER NOW
        </button>

        <ul className="newsletter-perks" aria-label="Newsletter perks">
          {PERKS.map((perk) => (
            <li key={perk.text} className="newsletter-perk">
              <span aria-hidden="true">{perk.emoji}</span> {perk.text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
