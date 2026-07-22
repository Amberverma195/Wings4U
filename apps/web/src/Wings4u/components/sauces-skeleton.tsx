import { WingsBrandLockup } from "@/components/wings-brand-lockup";
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
            <SkeletonBlock className={styles.heroNumber} />
            <span className={styles.heroWord}>FLAVOURS</span>
          </h1>
          <p className={styles.heroSub}>
            Sauces. Dry rubs. From mild and mellow to absolutely unhinged. Enjoy 6 Sauces made in
            house daily.
          </p>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <SkeletonBlock className={`${styles.statValue} ${styles.statValueMild}`} />
              <div className={styles.statLabel}>Mild</div>
            </div>
            <div className={styles.stat}>
              <SkeletonBlock className={`${styles.statValue} ${styles.statValueMedium}`} />
              <div className={styles.statLabel}>Medium</div>
            </div>
            <div className={styles.stat}>
              <SkeletonBlock className={`${styles.statValue} ${styles.statValueHot}`} />
              <div className={styles.statLabel}>Hot</div>
            </div>
            <div className={styles.stat}>
              <SkeletonBlock className={`${styles.statValue} ${styles.statValueDry}`} />
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
            <SkeletonBlock className={styles.searchCount} />
          </div>

          <div className={styles.filters} aria-hidden="true">
            <span className={`${styles.filterPill} ${styles.filterPillAll}`}>ALL</span>
            <span className={styles.filterPill}>{"\u{1F7E2}"} MILD</span>
            <span className={styles.filterPill}>{"\u{1F7E1}"} MEDIUM</span>
            <span className={styles.filterPill}>{"\u{1F534}"} HOT</span>
            <span className={styles.filterPill}>{"\u2728"} DRY RUBS</span>
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
