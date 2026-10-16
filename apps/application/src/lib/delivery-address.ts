export function normalizeCanadianPostalCode(value: string): string {
  const compact = value.normalize("NFKC").replace(/\s/g, "").toUpperCase();
  return compact.length === 6 ? `${compact.slice(0, 3)} ${compact.slice(3)}` : compact;
}
export function normalizeAddressText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}
