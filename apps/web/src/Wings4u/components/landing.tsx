"use client";

import { useCallback, useEffect, useState } from "react";
import { styles } from "../styles";
import { BrandSection } from "./brand-section";
import { HeroNewsletterPromo } from "./hero-newsletter-promo";
import { HeroCategoryMarquee } from "./hero-category-marquee";
import { HowItWorksSection } from "./how-it-works-section";
import { SaucesSection } from "./sauces-section";

const HERO_PROOF_ITEMS = [
  { label: "Bone-In or Boneless", value: "Pick your style" },
  { label: "Heat Levels", value: "Mild to wild" },
  { label: "Dry Rubs & Sauces", value: "Your call" },
  { label: "Meals for 1 or Crew", value: "Solo to group" },
] as const;

export function Landing({
  onOrderNow,
  onSauces,
}: {
  onOrderNow: () => void;
  onSauces: () => void;
}) {
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setShowBackToTop(window.scrollY > 520);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <>
      <div style={styles.landing}>
        <div className="wk-landing-marquee-slot">
          <HeroCategoryMarquee />
        </div>

        <section className="wk-landing-hero" style={styles.hero} aria-label="Welcome to Wings 4 U">
          <div className="wk-hero-content" style={styles.heroContent}>
            <p style={styles.heroEyebrow}>
              {"\u{1F525} LONDON'S BEST WING SPOT \u00B7 Est. 2026"}
            </p>
            <h1 className="wk-hero-title" style={styles.heroTitle}>
              <span className="wk-hero-title-line" style={styles.heroTitleWings}>
                W
                <span className="hero-title-wing-i">
                  <span className="hero-title-wing-i__stem">
                    <span className="hero-title-wing-i__dot" aria-hidden="true" />
                    {"\u{0131}"}
                  </span>
                </span>
                NGS
              </span>
              <span className="wk-hero-title-line" style={styles.heroTitleAccent}>THAT HIT</span>
              <span className="wk-hero-title-line wk-hero-title-line--different" style={styles.heroTitleGradient}>DIFFERENT</span>
            </h1>
            <p style={styles.heroSub}>
              <span style={{ display: "block" }}>Hand-breaded. Sauced to perfection.</span>
              <span style={{ display: "block" }}>Crispy Every Time. NO EXCUSES...</span>
            </p>
            <div className="wk-hero-buttons" style={styles.heroButtons}>
              <button className="fire-btn" onClick={onOrderNow} type="button">
                <span className="btn-label">
                  ORDER NOW {"\u2192"}
                </span>
              </button>
              <button className="ghost-btn" onClick={onSauces} type="button">
                <span className="btn-label">SAUCES</span>
              </button>
            </div>

            <ul className="hero-proof" aria-label="What we offer">
              {HERO_PROOF_ITEMS.map((item) => (
                <li key={item.label} className="hero-proof-item">
                  <div className="hero-proof-label">{item.label}</div>
                  <div className="hero-proof-val">{item.value}</div>
                </li>
              ))}
            </ul>

            <HeroNewsletterPromo />
          </div>
          <div style={styles.heroImageBlock} className="wk-hero-visual-column">
            <div style={styles.heroVisualCluster}>
              <div style={styles.heroGlowAnchor} aria-hidden="true">
                <div className="hero-visual-glow">
                  <div className="hero-visual-glow-inner" />
                </div>
              </div>
              <div style={styles.wingEmojis}>
                <span style={styles.heroCenterWing}>
                  {"\u{1F357}"}
                </span>
                <div className="hero-orbit-ring" aria-hidden="true">
                  <span className="hero-orbit-item hero-orbit-item--bolt">{"\u26A1"}</span>
                  <span className="hero-orbit-item hero-orbit-item--pepper">{"\u{1F336}\uFE0F"}</span>
                  <span className="hero-orbit-item hero-orbit-item--fire">{"\u{1F525}"}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <BrandSection />

        <SaucesSection />

        <HowItWorksSection />
      </div>

      {showBackToTop ? (
        <button className="wk-back-to-top" onClick={scrollToTop} aria-label="Back to top" type="button">
          ^
        </button>
      ) : null}
    </>
  );
}
