/**
 * Shared "vague denial" UI used by both the middleware rewrite target at
 * `/403` and Next's built-in `forbidden()` boundary via `app/forbidden.tsx`.
 *
 * Keeping them identical avoids leaking whether the requested route exists
 * or what role is required — non-admin users see the same page whether the
 * Edge prefilter rejected them or the authoritative server-side API-backed
 * admin layout did.
 */
export default function DenialView() {
  return (
    <main
      className="surface-shell"
      style={{
        display: "flex",
        minHeight: "60vh",
        alignItems: "center",
        justifyContent: "center",
        padding: "3rem 1.5rem",
      }}
    >
      <section
        aria-label="Page not available"
        style={{
          maxWidth: "32rem",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "0.6rem",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>
          Page not available
        </h1>
        <p className="surface-muted" style={{ margin: 0 }}>
          The page you&apos;re looking for doesn&apos;t exist or is no longer
          available.
        </p>
      </section>
    </main>
  );
}
