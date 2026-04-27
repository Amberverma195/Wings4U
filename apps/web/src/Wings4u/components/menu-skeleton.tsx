import type { CSSProperties } from "react";
import { styles } from "../styles";

const screenReaderOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

function SkeletonBlock({
  width,
  height,
  borderRadius = 12,
  style,
}: {
  width: CSSProperties["width"];
  height: CSSProperties["height"];
  borderRadius?: CSSProperties["borderRadius"];
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className="wk-skeleton-block"
      style={{ display: "block", width, height, borderRadius, ...style }}
    />
  );
}

function SkeletonCard({ index }: { index: number }) {
  const titleWidths = ["84%", "76%", "88%", "72%", "81%", "69%"];
  const descWidths = ["58%", "66%", "54%", "62%", "48%", "60%"];

  return (
    <div style={styles.menuCard}>
      <div style={{ ...styles.menuCardEmoji, padding: "18px 0" }}>
        <SkeletonBlock width="38%" height={76} borderRadius={24} />
      </div>
      <div style={{ ...styles.menuCardBody, gap: 10 }}>
        <SkeletonBlock width={titleWidths[index % titleWidths.length]} height={25} />
        <SkeletonBlock
          width={descWidths[index % descWidths.length]}
          height={15}
          borderRadius={8}
          style={{ opacity: 0.8 }}
        />
        <div style={{ flex: 1 }} />
        <div style={styles.menuCardFooter}>
          <SkeletonBlock width={52} height={28} borderRadius={8} />
          <SkeletonBlock width={96} height={34} borderRadius={4} />
        </div>
      </div>
    </div>
  );
}

function SkeletonSection({
  headingWidth,
  cardCount,
}: {
  headingWidth: CSSProperties["width"];
  cardCount: number;
}) {
  return (
    <section className="wk-menu-section" aria-hidden="true">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}>
        <SkeletonBlock width={headingWidth} height={34} borderRadius={10} />
      </div>
      <div style={styles.menuGrid}>
        {Array.from({ length: cardCount }, (_, index) => (
          <SkeletonCard key={index} index={index} />
        ))}
      </div>
    </section>
  );
}

export function MenuSkeleton({
  statusLabel = "Loading menu",
}: {
  statusLabel?: string;
}) {
  const categoryPillWidths = [124, 78, 96, 82, 86, 132, 110, 92, 74];

  return (
    <div style={styles.menuPage}>
      <div style={styles.menuSurface} role="status" aria-live="polite" aria-busy="true">
        <span style={screenReaderOnly}>{statusLabel}</span>

        <div className="wk-order-sticky-stack" aria-hidden="true">
          <div className="wk-order-settings-shell">
            <div className="wk-order-settings-bar">
              <div className="wk-order-fulfillment-display">
                <SkeletonBlock width={84} height={38} borderRadius={10} />
                <SkeletonBlock width={92} height={38} borderRadius={10} style={{ opacity: 0.8 }} />
              </div>

              <div className="wk-order-settings-meta">
                <div className="wk-order-settings-chip">
                  <SkeletonBlock width={108} height={16} borderRadius={8} />
                </div>
                <div className="wk-order-settings-time-row">
                  <div className="wk-order-settings-chip">
                    <SkeletonBlock width={118} height={16} borderRadius={8} />
                  </div>
                  <SkeletonBlock width={96} height={40} borderRadius={12} />
                </div>
              </div>
            </div>
          </div>

          <div className="wk-menu-sticky-cats">
            <div className="wk-cat-fade-edge">
              <div className="wk-cat-row">
                {categoryPillWidths.map((width, index) => (
                  <SkeletonBlock
                    key={index}
                    width={width}
                    height={40}
                    borderRadius={50}
                    style={{ flex: "0 0 auto", opacity: index === 0 ? 1 : 0.8 }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <SkeletonSection headingWidth="clamp(220px, 26vw, 320px)" cardCount={6} />
        <SkeletonSection headingWidth="clamp(160px, 18vw, 220px)" cardCount={4} />
      </div>
    </div>
  );
}
