import { WingsBrandLockup } from "@/components/wings-brand-lockup";
import { SAUCE_COUNTS, SAUCE_TOTAL } from "../data/sauces";
import styles from "./sauces-skeleton.module.css";

const SEARCH_ICON = String.fromCodePoint(0x1f50d);

function SkeletonBlock({
  className,
}: {
  className: string;
}) {
  return <span aria-hidden="true" className={`${className} wk-skeleton-block`} />;
}

export function SaucesSkeleton() {
  return (
    <div className={styles.page} role="status" aria-live="polite" aria-busy="true">
      <nav className={styles.navbar}>
        <WingsBrandLockup href="/" ariaLabel="Back to home" priority />
        <div className={styles.navRight} aria-hidden="true">
          <SkeletonBlock className={styles.navGhost} />
          <SkeletonBlock className={styles.navPrimary} />
        </div>
      </nav>

      <main className={styles.main}>
        <section className={styles.hero}>
          <p className={styles.heroLabel}>UR TASTE BUDS WILL THANK U</p>
          <h1 className={styles.heroTitle}>
            <span className={styles.heroNumber}>{SAUCE_TOTAL}</span>
            <span className={styles.heroWord}>FLAVOURS</span>
          </h1>
          <p className={styles.heroSub}>
            Sauces. Dry rubs. From mild and mellow to absolutely unhinged. Every single one made
            in-house, fresh, daily.
          </p>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={`${styles.statValue} ${styles.statValueMild}`}>{SAUCE_COUNTS.mild}</div>
              <div className={styles.statLabel}>Mild</div>
            </div>
            <div className={styles.stat}>
              <div className={`${styles.statValue} ${styles.statValueMedium}`}>{SAUCE_COUNTS.medium}</div>
              <div className={styles.statLabel}>Medium</div>
            </div>
            <div className={styles.stat}>
              <div className={`${styles.statValue} ${styles.statValueHot}`}>{SAUCE_COUNTS.hot}</div>
              <div className={styles.statLabel}>Hot</div>
            </div>
            <div className={styles.stat}>
              <div className={`${styles.statValue} ${styles.statValueDry}`}>{SAUCE_COUNTS.dryrub}</div>
              <div className={styles.statLabel}>Dry Rubs</div>
            </div>
          </div>
        </section>

        <section className={styles.controls}>
          <div className={styles.searchLabel}>Search sauces and dry rubs {SEARCH_ICON}</div>
          <div className={styles.searchShell}>
            <span className={styles.searchIcon} aria-hidden="true">
              {SEARCH_ICON}
            </span>
            <span>Search sauces &amp; dry rubs...</span>
            <span className={styles.searchCount}>{SAUCE_TOTAL} flavours</span>
          </div>

          <div className={styles.filters} aria-hidden="true">
            <span className={`${styles.filterPill} ${styles.filterPillAll}`}>ALL {SAUCE_TOTAL}</span>
            <span className={styles.filterPill}>{"\u{1F7E2}"} MILD {SAUCE_COUNTS.mild}</span>
            <span className={styles.filterPill}>{"\u{1F7E1}"} MEDIUM {SAUCE_COUNTS.medium}</span>
            <span className={styles.filterPill}>{"\u{1F534}"} HOT {SAUCE_COUNTS.hot}</span>
            <span className={styles.filterPill}>{"\u2728"} DRY RUBS {SAUCE_COUNTS.dryrub}</span>
          </div>
        </section>

        <section className={styles.grid} aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} className={styles.card}>
              <SkeletonBlock className={styles.cardIcon} />
              <SkeletonBlock className={styles.cardTitle} />
              <SkeletonBlock className={styles.cardMeta} />
              <div className={styles.cardSpacers} />
              <div className={styles.cardDots}>
                <SkeletonBlock className={styles.cardDot} />
                <SkeletonBlock className={styles.cardDot} />
                <SkeletonBlock className={styles.cardDot} />
                <SkeletonBlock className={styles.cardDot} />
              </div>
              <SkeletonBlock className={styles.cardBadge} />
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
