/** Customer-facing USD string from integer cents (aligned with web `cents()` in apps/web). */
export function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
