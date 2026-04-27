"use client";

import { useCallback } from "react";

export function HeroNewsletterPromo() {
  const scrollToNewsletter = useCallback(() => {
    document.getElementById("newsletter")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="hero-newsletter-promo">
      <button
        type="button"
        className="hero-newsletter-promo__box"
        onClick={scrollToNewsletter}
        aria-label="Get 10% off your first order - go to newsletter signup"
      >
        <span className="hero-newsletter-promo__text">GET 10% OFF</span>
        <span className="hero-newsletter-promo__chick" aria-hidden="true">
          {"\u{1F425}"}
        </span>
      </button>
    </div>
  );
}
