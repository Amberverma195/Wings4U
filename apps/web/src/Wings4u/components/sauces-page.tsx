"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { WingsBrandLockup } from "@/components/wings-brand-lockup";
import { SAUCE_COUNTS, SAUCE_FLAVOURS, SAUCE_TOTAL, type SauceCategory } from "../data/sauces";
import styles from "./sauces-page.module.css";

type FilterKey = "all" | SauceCategory;

type CategoryConfig = {
  label: string;
  badge: string;
  color: string;
  bg: string;
  border: string;
  glow: string;
  filterEmoji: string;
  filterColor: string;
  heatColors: [string, string, string, string, string];
};

const SEARCH_ICON = String.fromCodePoint(0x1f50d);
const NO_RESULTS_ICON = String.fromCodePoint(0x1f937);
const CATEGORY_ORDER: SauceCategory[] = ["mild", "medium", "hot", "dryrub"];
const FILTER_ORDER: FilterKey[] = ["all", ...CATEGORY_ORDER];
const EMPTY_COUNTS: Record<SauceCategory, number> = { mild: 0, medium: 0, hot: 0, dryrub: 0 };

const GLOBAL_STYLES = `
  :root {
    --orange: #ff6b00;
    --orange-hot: #ff4d00;
    --orange-gold: #ffaa00;
    --orange-dim: #cc5500;
    --yellow: #ffd500;
    --yellow-soft: #ffcc33;
    --yellow-bright: #ffe566;
    --dark: #080200;
    --dark-2: #0d0400;
    --dark-3: #120600;
    --border: #1e0900;
    --border-glow: #ff4d0033;
    --text-muted: #b8863a;
    --text-dim: #4a2510;
    --text-yellow: #ffd966;
    --mild: #4cd964;
    --mild-bg: rgba(76, 217, 100, 0.08);
    --mild-border: rgba(76, 217, 100, 0.25);
    --medium: #ffcc00;
    --medium-bg: rgba(255, 204, 0, 0.08);
    --medium-border: rgba(255, 204, 0, 0.25);
    --hot: #ff4d00;
    --hot-bg: rgba(255, 77, 0, 0.08);
    --hot-border: rgba(255, 77, 0, 0.25);
    --dryrub: #cc66ff;
    --dryrub-bg: rgba(204, 102, 255, 0.08);
    --dryrub-border: rgba(204, 102, 255, 0.25);
  }

  body {
    background-color: #0a0a0a !important;
    background-image:
      radial-gradient(circle at 50% 50%, rgba(255,100,0,0.21) 1px, transparent 1.85px),
      radial-gradient(circle at 50% 50%, rgba(255,92,0,0.09) 0px, transparent 9.6px),
      radial-gradient(circle at 50% 50%, rgba(255,170,40,0.04) 0px, transparent 13.5px) !important;
    background-size: 40px 40px !important;
    color: #fff;
    font-family: 'Rajdhani', sans-serif;
    overflow-x: hidden;
    min-height: 100vh;
    color-scheme: dark;
    scrollbar-width: thin;
    scrollbar-color: #ff4d0055 #080200;
  }

  body::-webkit-scrollbar {
    width: 4px;
  }

  body::-webkit-scrollbar-track {
    background: #080200;
  }

  body::-webkit-scrollbar-thumb {
    background: #ff4d0055;
    border-radius: 2px;
  }

  body::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 9999;
    pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");
    background-repeat: repeat;
    background-size: 180px 180px;
    opacity: 0.6;
    mix-blend-mode: overlay;
  }
`;

const CATEGORY_CONFIG: Record<SauceCategory, CategoryConfig> = {
  mild: {
    label: "Mild",
    badge: "MILD",
    color: "var(--mild)",
    bg: "var(--mild-bg)",
    border: "var(--mild-border)",
    glow: "#4cd96455",
    filterEmoji: "\u{1F7E2}",
    filterColor: "var(--mild)",
    heatColors: ["#4cd964", "#4cd964", "#4cd964", "#4cd964", "#4cd964"],
  },
  medium: {
    label: "Medium",
    badge: "MEDIUM",
    color: "var(--medium)",
    bg: "var(--medium-bg)",
    border: "var(--medium-border)",
    glow: "#ffcc0055",
    filterEmoji: "\u{1F7E1}",
    filterColor: "var(--medium)",
    heatColors: ["#ffcc00", "#ffcc00", "#ffcc00", "#ffcc00", "#ffcc00"],
  },
  hot: {
    label: "Hot",
    badge: "HOT",
    color: "var(--hot)",
    bg: "var(--hot-bg)",
    border: "var(--hot-border)",
    glow: "#ff4d0055",
    filterEmoji: "\u{1F534}",
    filterColor: "var(--hot)",
    heatColors: ["#f5c542", "#f5a623", "#ff4d00", "#d00000", "#9b00ff"],
  },
  dryrub: {
    label: "Dry Rubs",
    badge: "DRY RUBS",
    color: "var(--dryrub)",
    bg: "var(--dryrub-bg)",
    border: "var(--dryrub-border)",
    glow: "#cc66ff55",
    filterEmoji: "\u2728",
    filterColor: "var(--dryrub)",
    heatColors: ["#cc66ff", "#cc66ff", "#cc66ff", "#cc66ff", "#cc66ff"],
  },
};

function getFilterLabel(filter: FilterKey) {
  if (filter === "all") {
    return "ALL";
  }

  const config = CATEGORY_CONFIG[filter];
  return `${config.filterEmoji} ${config.label.toUpperCase()}`;
}

function getFilterCount(filter: FilterKey) {
  if (filter === "all") {
    return SAUCE_TOTAL;
  }

  return SAUCE_COUNTS[filter];
}

function cardVars(categoryColor: string, visualAccent: string, animationDelay: string): CSSProperties {
  return {
    ["--category-c" as string]: categoryColor,
    ["--sauce-c" as string]: visualAccent,
    animationDelay,
  } as CSSProperties;
}

function buttonVars(color: string): CSSProperties {
  return {
    ["--btn-c" as string]: color,
  } as CSSProperties;
}

export function SaucesPage() {
  const heroRef = useRef<HTMLElement | null>(null);
  const controlsRef = useRef<HTMLElement | null>(null);
  const sectionRefs = useRef<Record<SauceCategory, HTMLElement | null>>({
    mild: null,
    medium: null,
    hot: null,
    dryrub: null,
  });
  const observerRef = useRef<IntersectionObserver | null>(null);
  const intervalsRef = useRef<number[]>([]);
  const [currentFilter, setCurrentFilter] = useState<FilterKey>("all");
  const [currentSearch, setCurrentSearch] = useState("");
  const [counts, setCounts] = useState<Record<SauceCategory, number>>({ ...EMPTY_COUNTS });
  const [showBackToTop, setShowBackToTop] = useState(false);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    function handleBackToTopVisibility() {
      setShowBackToTop(window.scrollY > 520);
    }

    handleBackToTopVisibility();
    window.addEventListener("scroll", handleBackToTopVisibility, { passive: true });
    return () => window.removeEventListener("scroll", handleBackToTopVisibility);
  }, []);

  useEffect(() => {
    const node = heroRef.current;
    if (!node || typeof window === "undefined") {
      return;
    }

    const clearIntervals = () => {
      intervalsRef.current.forEach((intervalId) => window.clearInterval(intervalId));
      intervalsRef.current = [];
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMotion.matches) {
      setCounts({ ...SAUCE_COUNTS });
      return () => {
        clearIntervals();
      };
    }

    const startCounters = () => {
      clearIntervals();

      CATEGORY_ORDER.forEach((category) => {
        const target = SAUCE_COUNTS[category];
        const step = Math.ceil(target / 30);
        const intervalId = window.setInterval(() => {
          setCounts((previous) => {
            const current = previous[category];
            if (current >= target) {
              window.clearInterval(intervalId);
              return previous;
            }

            const next = Math.min(current + step, target);
            if (next >= target) {
              window.clearInterval(intervalId);
            }

            return {
              ...previous,
              [category]: next,
            };
          });
        }, 30);

        intervalsRef.current.push(intervalId);
      });
    };

    observerRef.current = new window.IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) {
          return;
        }

        observerRef.current?.disconnect();
        startCounters();
      },
      { threshold: 0.3 },
    );

    observerRef.current.observe(node);

    return () => {
      observerRef.current?.disconnect();
      clearIntervals();
    };
  }, []);

  const scrollToNode = (node: HTMLElement | null) => {
    if (!node || typeof window === "undefined") {
      return;
    }

    const offset = 104;
    const top = node.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({
      top: Math.max(0, top),
      behavior: "smooth",
    });
  };

  const handleFilterClick = (filter: FilterKey) => {
    setCurrentFilter(filter);

    if (filter === "all") {
      scrollToNode(controlsRef.current);
      return;
    }

    scrollToNode(sectionRefs.current[filter]);
  };

  const normalizedSearch = currentSearch.trim().toLowerCase();
  const filteredSauces = SAUCE_FLAVOURS.filter((sauce) => {
    const matchesSearch = !normalizedSearch || sauce.name.toLowerCase().includes(normalizedSearch);
    return matchesSearch;
  });

  let visibleIndex = 0;
  const groupedSections = CATEGORY_ORDER.map((category) => {
    const items = filteredSauces
      .filter((sauce) => sauce.cat === category)
      .map((sauce) => ({
        ...sauce,
        visibleIndex: visibleIndex++,
      }));

    return {
      category,
      items,
    };
  }).filter((section) => section.items.length > 0);

  const countLabel = !normalizedSearch
    ? `${SAUCE_TOTAL}+ flavours`
    : `${filteredSauces.length} flavour${filteredSauces.length === 1 ? "" : "s"}`;
  const renderKey = normalizedSearch || "all";

  return (
    <>
      <style jsx global>{GLOBAL_STYLES}</style>
      <div className={styles.page}>
        <nav id="navbar" className={styles.navbar}>
          <WingsBrandLockup href="/" ariaLabel="Back to home" />

          <div className={styles.navRight}>
            <Link href="/" className={styles.navBack}>
              {"\u2190"} Back to Home
            </Link>
            <Link href="/order?fulfillment_type=DELIVERY" className="fire-btn">
              <span className="btn-label">
                ORDER NOW {"\u2192"}
              </span>
            </Link>
          </div>
        </nav>

        <main className={styles.main}>
          <section id="sauce-hero" className={styles.hero} ref={heroRef}>
            <div className={styles.sauceHeroGlow} aria-hidden="true" />
            <p className={styles.sauceHeroLabel}>UR TASTE BUDS WILL THANK U</p>
            <h1 className={styles.sauceHeroTitle}>
              <span className={`${styles.gradientText} ${styles.gradientTextShimmer}`}>{`${SAUCE_TOTAL}+`}</span>
              <span>FLAVOURS</span>
            </h1>
            <p className={styles.sauceHeroSub}>
              Sauces. Dry rubs. From mild and mellow to absolutely unhinged. Every single one made
              in-house, fresh, daily.
            </p>

            <div className={styles.sauceStats}>
              {CATEGORY_ORDER.map((category) => {
                const config = CATEGORY_CONFIG[category];
                return (
                  <div className={styles.sauceStat} key={category}>
                    <div
                      className={`${styles.sauceStatNum} ${styles[`${category}Count`]}`}
                      data-count={SAUCE_COUNTS[category]}
                    >
                      {counts[category]}
                    </div>
                    <div className={styles.sauceStatLabel}>{config.label}</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section id="controls" className={styles.controls} ref={controlsRef}>
            <div className={styles.searchRow}>
              <div className={styles.searchWrap}>
                <label htmlFor="sauce-search" className={styles.visuallyHidden}>
                  Search sauces and dry rubs
                </label>
                <span className={styles.searchIcon} aria-hidden="true">
                  {SEARCH_ICON}
                </span>
                <input
                  id="sauce-search"
                  className={styles.searchBox}
                  type="search"
                  value={currentSearch}
                  onChange={(event) => setCurrentSearch(event.target.value)}
                  placeholder="Search sauces & dry rubs..."
                />
                <span className={styles.searchCount} aria-live="polite">
                  {countLabel}
                </span>
              </div>
            </div>

            <div className={styles.filterRow} aria-label="Sauce category shortcuts">
              {FILTER_ORDER.map((filter) => {
                const isActive = currentFilter === filter;
                const btnColor = filter === "all" ? "var(--orange)" : CATEGORY_CONFIG[filter].filterColor;
                return (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={isActive}
                    className={`${styles.filterBtn} ${isActive ? styles.filterBtnActive : ""}`}
                    style={buttonVars(btnColor)}
                    onClick={() => handleFilterClick(filter)}
                  >
                    <span>{getFilterLabel(filter)}</span>
                    <span className={styles.filterCount}>{getFilterCount(filter)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section id="sauce-grid-container" className={styles.sauceGridContainer} aria-live="polite">
            {groupedSections.map((section) => {
              const config = CATEGORY_CONFIG[section.category];
              return (
                <section
                  className={styles.categorySection}
                  key={`${renderKey}-${section.category}`}
                  ref={(node) => {
                    sectionRefs.current[section.category] = node;
                  }}
                >
                  <div className={styles.categoryHeader}>
                    <span
                      className={styles.categoryDot}
                      style={{ background: config.color, boxShadow: `0 0 10px ${config.glow}` }}
                      aria-hidden="true"
                    />
                    <h2 className={styles.categoryName} style={{ color: config.color }}>
                      {config.label}
                    </h2>
                    <span className={styles.categoryCount}>{`${section.items.length} flavour${section.items.length === 1 ? "" : "s"}`}</span>
                  </div>

                  <div className={styles.sauceGrid}>
                    {section.items.map((sauce) => (
                      <article
                        className={`${styles.sauceCard} ${styles.cardAnimate}`}
                        key={`${renderKey}-${sauce.id}`}
                        style={cardVars(config.color, sauce.visualAccent, `${sauce.visibleIndex * 0.03}s`)}
                      >
                        <span className={styles.sauceCardNum}>{`#${String(sauce.number).padStart(2, "0")}`}</span>

                        <div className={styles.sauceCardIcon} aria-hidden="true">
                          {sauce.icon}
                        </div>

                        <div className={styles.sauceCardName}>{sauce.name}</div>

                        <div className={styles.sauceSpiceFooter}>
                          <div className={styles.sauceCardHeat} aria-hidden="true">
                          {Array.from({ length: 5 }, (_, index) => {
                            const isActive = index < sauce.heat;
                            const pipColor = sauce.visualAccent;
                            return (
                              <span
                                key={`${sauce.id}-pip-${index}`}
                                className={styles.heatPip}
                                style={
                                  isActive
                                    ? ({
                                        background: pipColor,
                                        boxShadow: `0 0 6px ${pipColor}55`,
                                      } as CSSProperties)
                                    : undefined
                                }
                              />
                            );
                          })}
                          </div>

                          <span
                            className={styles.sauceCardBadge}
                            style={{ background: config.bg, border: `1px solid ${config.border}`, color: config.color }}
                          >
                            {config.badge}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}

            {!filteredSauces.length ? (
              <div className={styles.noResults}>
                <span className={styles.noResultsEmoji} aria-hidden="true">
                  {NO_RESULTS_ICON}
                </span>
                <div className={styles.noResultsText}>NO SAUCES FOUND</div>
                <div className={styles.noResultsSub}>Try a different search or clear the filter</div>
              </div>
            ) : null}
          </section>

          <section id="bottom-cta" className={styles.bottomCta}>
            <div className={styles.bottomCtaGlow} aria-hidden="true" />
            <h2 className={styles.bottomCtaTitle}>
              <span>FOUND YOUR </span>
              <span className={styles.gradientText}>FLAVOUR?</span>
            </h2>
            <p className={styles.bottomCtaSub}>
              Pick your heat, lock your flavour, and send it straight into the order flow.
            </p>
            <div className={styles.bottomCtaActions}>
              <Link href="/order?fulfillment_type=DELIVERY" className={styles.btnFire}>
                <span>START YOUR ORDER {"\u2192"}</span>
              </Link>
              <Link href="/" className={styles.btnGhost}>
                <span>BACK TO HOME</span>
              </Link>
            </div>
          </section>
        </main>

        <footer id="footer" className={styles.footer}>
          <div className={styles.footerInner}>
            <div className={styles.footerBrand}>
              <WingsBrandLockup
                href="/"
                ariaLabel="Back to home"
                className={styles.footerBrandLink}
                style={{ gap: 8 }}
                imageSize={42}
                wordmarkStyle={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 28,
                  letterSpacing: 1,
                  color: "#fff",
                }}
              />
            </div>
            <div className={styles.footerLinks}>
              <Link href="/">Home</Link>
              <Link href="/order?fulfillment_type=DELIVERY">Menu</Link>
              <a href="#nutrition-note">Nutrition</a>
              <a href="#allergen-note">Allergens</a>
            </div>
            <div className={styles.footerCopy}>{"\u00A9"} 2026 Wings 4 U</div>
          </div>
          <span id="nutrition-note" className={styles.visuallyHidden}>
            Nutrition details vary by flavour and serving size.
          </span>
          <span id="allergen-note" className={styles.visuallyHidden}>
            Allergen details vary by flavour and kitchen preparation.
          </span>
        </footer>
      </div>

      {showBackToTop ? (
        <button className="wk-back-to-top" onClick={scrollToTop} aria-label="Back to top" type="button">
          ^
        </button>
      ) : null}
    </>
  );
}
