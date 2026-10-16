import { normalizeCanadianPostalCode } from "../delivery-pricing/delivery-address";

export function normalizeAddressText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Unit information stays in line1; no abbreviation, punctuation or fuzzy matching. */
export function customerAddressIdentity(address: { line1: string; city: string; postalCode: string }): string {
  return JSON.stringify([
    normalizeAddressText(address.line1).toLowerCase(), normalizeAddressText(address.city).toLowerCase(),
    normalizeCanadianPostalCode(address.postalCode).replace(/\s/g, "").toLowerCase(),
  ]);
}
