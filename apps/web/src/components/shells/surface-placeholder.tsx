type SurfacePlaceholderProps = {
  title: string;
  summary: string;
  bullets?: string[];
};

export function SurfacePlaceholder({
  title,
  summary,
  bullets = []
}: SurfacePlaceholderProps) {
  return (
    <main className="surface-shell">
      <section className="surface-card">
        <p className="surface-eyebrow">Scaffold Placeholder</p>
        <h1>{title}</h1>
        <p>{summary}</p>
        {bullets.length > 0 ? (
          <ul>
            {bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
