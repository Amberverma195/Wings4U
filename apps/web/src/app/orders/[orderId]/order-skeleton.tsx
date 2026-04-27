import styles from "./order-detail.module.css";

/**
 * Skeleton loader for the live order tracking page.
 * Mirrors the exact layout of order-detail-client.tsx.
 */
export function OrderSkeleton() {
  return (
    <div className={styles.pageShell} style={{ pointerEvents: 'none' }}>
      <style>{`
        .oskel-pulse {
          background: linear-gradient(90deg, #e8e0d5 25%, #f0e8dd 50%, #e8e0d5 75%);
          background-size: 200% 100%;
          animation: oskelShimmer 1.6s ease-in-out infinite;
          border-radius: 8px;
        }
        @keyframes oskelShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      <main className={styles.hub}>
        {/* Top bar */}
        <div className={styles.topBar}>
          <div className="oskel-pulse" style={{ width: 140, height: 36, borderRadius: 14 }} />
          <div className="oskel-pulse" style={{ width: 200, height: 42, borderRadius: 14 }} />
        </div>

        {/* Two-column grid */}
        <div className={styles.mainGrid}>
          {/* LEFT — Order details */}
          <div className={styles.leftColumn}>
            <div className={styles.orderCard}>
              {/* Status row */}
              <div className={styles.statusRow}>
                <div className="oskel-pulse" style={{ width: 100, height: 28, borderRadius: 100 }} />
              </div>
              
              {/* Meta chips */}
              <div className={styles.metaRow}>
                <div className="oskel-pulse" style={{ width: 80, height: 24, borderRadius: 100 }} />
                <div className="oskel-pulse" style={{ width: 140, height: 24, borderRadius: 100 }} />
              </div>

              {/* Items Section */}
              <div className={styles.section}>
                <div className="oskel-pulse" style={{ width: 60, height: 20, marginBottom: "1rem" }} />
                {/* Items */}
                {[1, 2].map((i) => (
                  <div key={i} className={styles.itemRow} style={{ borderBottom: 'none' }}>
                    <div style={{ flex: 1 }}>
                       <div className="oskel-pulse" style={{ width: "60%", height: 16, marginBottom: "0.5rem" }} />
                       <div className="oskel-pulse" style={{ width: "40%", height: 12 }} />
                    </div>
                    <div className="oskel-pulse" style={{ width: 40, height: 16 }} />
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className={styles.summary}>
                {[1, 2, 3].map((i) => (
                  <div key={i} className={styles.summaryRow}>
                    <div className="oskel-pulse" style={{ width: 80, height: 16 }} />
                    <div className="oskel-pulse" style={{ width: 60, height: 16 }} />
                  </div>
                ))}
                <div className={styles.summaryTotal}>
                  <div className="oskel-pulse" style={{ width: 60, height: 20 }} />
                  <div className="oskel-pulse" style={{ width: 80, height: 20 }} />
                </div>
              </div>

            </div>
          </div>
          
          {/* RIGHT — Map/Tracking section */}
          <div className={styles.rightColumn} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
             <div className="oskel-pulse" style={{ width: "100%", height: 400, borderRadius: 24 }} />
          </div>
        </div>
      </main>
    </div>
  );
}
