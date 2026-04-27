import type { CSSProperties } from "react";
import styles from "./orders.module.css";

function SkeletonBlock({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={`${styles.routeSkeletonBlock} ${className}`.trim()}
      style={style}
    />
  );
}

export default function AccountOrdersLoading() {
  return (
    <div className={styles.pageShell} role="status" aria-busy="true" aria-live="polite">
      <main className={styles.hub}>
        <div className={styles.mainContainer}>
          <aside className={styles.sidebar}>
            <div className={styles.identityCard}>
              <SkeletonBlock style={{ width: "62%", height: "34px", borderRadius: "10px" }} />
              <SkeletonBlock
                style={{
                  width: "78%",
                  height: "18px",
                  borderRadius: "8px",
                  marginTop: "0.8rem",
                  marginBottom: "2rem",
                }}
              />

              <div className={styles.navLinks}>
                {[0, 1, 2, 3, 4].map((index) => (
                  <SkeletonBlock
                    key={index}
                    style={{ width: "100%", height: "44px", borderRadius: "12px" }}
                  />
                ))}
              </div>
            </div>
          </aside>

          <div className={styles.contentStack}>
            <header className={styles.hero}>
              <div className={styles.titleArea}>
                <SkeletonBlock style={{ width: "112px", height: "12px", borderRadius: "6px" }} />
                <SkeletonBlock
                  style={{
                    width: "240px",
                    height: "42px",
                    borderRadius: "12px",
                    marginTop: "0.35rem",
                  }}
                />
                <SkeletonBlock
                  style={{
                    width: "min(100%, 460px)",
                    height: "18px",
                    borderRadius: "8px",
                    marginTop: "0.7rem",
                  }}
                />
              </div>
            </header>

            <div className={styles.controls}>
              <div className={styles.tabs} aria-hidden="true" data-tab="active">
                <div className={styles.tabIndicator} />
                <div className={styles.tab}>
                  <SkeletonBlock style={{ width: "52px", height: "14px", borderRadius: "7px" }} />
                </div>
                <div className={styles.tab}>
                  <SkeletonBlock style={{ width: "40px", height: "14px", borderRadius: "7px" }} />
                </div>
              </div>

              <SkeletonBlock
                className={styles.routeSkeletonCta}
                style={{ width: "208px", height: "46px", borderRadius: "999px" }}
              />
            </div>

            <div className={styles.grid} aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <div key={index} className={styles.skeletonCard}>
                  <div className={`${styles.skeletonRow} ${styles.skeletonRowShort}`} />
                  <div className={styles.skeletonRow} />
                  <div className={`${styles.skeletonRow} ${styles.skeletonRowMid}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
