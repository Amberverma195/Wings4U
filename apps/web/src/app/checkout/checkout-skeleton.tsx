/**
 * Checkout page skeleton — shown instantly while the heavy CheckoutClient
 * chunk loads. Mirrors the real checkout layout with pulsing placeholders.
 */
export function CheckoutSkeleton() {
  return (
    <section className="surface-card checkout-page-panel">
      <style>{`
        .ck-skel-pulse {
          background: linear-gradient(90deg, #e8e0d5 25%, #f0e8dd 50%, #e8e0d5 75%);
          background-size: 200% 100%;
          animation: ckSkelShimmer 1.6s ease-in-out infinite;
          border-radius: 8px;
        }
        @keyframes ckSkelShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .ck-skel-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }
      `}</style>

      {/* Back link */}
      <div style={{ marginBottom: "1.25rem" }}>
        <div className="ck-skel-pulse" style={{ width: 110, height: 16 }} />
      </div>

      {/* Title */}
      <div className="ck-skel-pulse" style={{ width: 200, height: 32, marginBottom: "0.5rem" }} />

      {/* Subtitle */}
      <div className="ck-skel-pulse" style={{ width: 240, height: 16, marginBottom: "1.75rem" }} />

      {/* Schedule summary */}
      <div style={{
        background: "#f5ede3",
        borderRadius: 14,
        padding: "1rem 1.25rem",
        marginBottom: "1.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}>
        <div className="ck-skel-pulse" style={{ width: 180, height: 16 }} />
        <div className="ck-skel-pulse" style={{ width: 140, height: 14 }} />
      </div>

      {/* Order summary header */}
      <div className="ck-skel-pulse" style={{ width: 150, height: 20, marginBottom: "0.75rem" }} />
      <div className="ck-skel-pulse" style={{ width: "100%", height: 1, marginBottom: "1rem" }} />

      {/* Item rows */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="ck-skel-row" style={{ marginBottom: "1rem", padding: "0.5rem 0" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", flex: 1 }}>
            <div className="ck-skel-pulse" style={{ width: `${50 + i * 15}%`, height: 18 }} />
            <div className="ck-skel-pulse" style={{ width: `${30 + i * 10}%`, height: 13 }} />
          </div>
          <div className="ck-skel-pulse" style={{ width: 60, height: 18, flexShrink: 0 }} />
        </div>
      ))}

      {/* Quote summary */}
      <div style={{
        borderTop: "1px solid #e8e0d5",
        paddingTop: "1rem",
        marginTop: "0.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.65rem",
      }}>
        {["Subtotal", "Tax", "Total"].map((label) => (
          <div key={label} className="ck-skel-row">
            <div className="ck-skel-pulse" style={{ width: 80, height: 15 }} />
            <div className="ck-skel-pulse" style={{ width: 55, height: 15 }} />
          </div>
        ))}
      </div>

      {/* Order notes */}
      <div style={{ marginTop: "1.5rem" }}>
        <div className="ck-skel-pulse" style={{ width: 100, height: 14, marginBottom: "0.5rem" }} />
        <div className="ck-skel-pulse" style={{ width: "100%", height: 56, borderRadius: 10 }} />
      </div>

      {/* Place order button */}
      <div className="ck-skel-pulse" style={{
        width: "100%",
        height: 52,
        marginTop: "1.5rem",
        borderRadius: 12,
        background: "linear-gradient(90deg, #e8d5b8 25%, #f0dcc5 50%, #e8d5b8 75%)",
        backgroundSize: "200% 100%",
        animation: "ckSkelShimmer 1.6s ease-in-out infinite",
      }} />
    </section>
  );
}
