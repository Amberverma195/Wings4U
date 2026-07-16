"use client";

import { useEffect, useRef, useState } from "react";

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
          <span className="gradient-text">15% OFF</span>
          <span> YOUR FIRST ORDER</span>
        </h2>
        <button type="button" className="newsletter-btn newsletter-btn--order" onClick={handleOrderNow}>
          ORDER NOW
        </button>
      </div>
    </section>
  );
}
