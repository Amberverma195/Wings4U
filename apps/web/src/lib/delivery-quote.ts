"use client";

import type { DeliveryAddressDraft } from "./delivery-address";

export type DeliveryQuote = {
  delivery_quote_token: string;
  delivery_fee_cents: number;
  expires_at: string;
  attribution: "Google Maps" | null;
};

const DELIVERY_QUOTES_STORAGE_KEY = "wings4u.delivery-quotes.v2";
const LEGACY_DELIVERY_QUOTES_STORAGE_KEY = "wings4u.delivery-quotes.v1";
const expiryTimers = new Map<string, number>();

function normalizePart(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

async function quoteKey(
  locationId: string,
  address: DeliveryAddressDraft,
): Promise<string> {
  const canonical = JSON.stringify({
    location_id: locationId.trim(),
    line1: normalizePart(address.line1),
    city: normalizePart(address.city),
    postal_code: normalizePart(address.postalCode).replace(/\s/g, ""),
  });
  const digest = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return `${locationId.trim()}:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function isDeliveryQuote(value: unknown): value is DeliveryQuote {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.delivery_quote_token === "string" &&
    candidate.delivery_quote_token.length > 0 &&
    Number.isInteger(candidate.delivery_fee_cents) &&
    typeof candidate.expires_at === "string" &&
    !Number.isNaN(new Date(candidate.expires_at).getTime()) &&
    (candidate.attribution === "Google Maps" || candidate.attribution === null)
  );
}

function loadQuoteMap(): Record<string, DeliveryQuote> {
  if (typeof window === "undefined") return {};

  try {
    window.sessionStorage.removeItem(LEGACY_DELIVERY_QUOTES_STORAGE_KEY);
    const raw = window.sessionStorage.getItem(DELIVERY_QUOTES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const now = Date.now();
    const valid = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, DeliveryQuote] =>
        isDeliveryQuote(entry[1]) &&
        new Date(entry[1].expires_at).getTime() > now,
    );
    const result = Object.fromEntries(valid);
    if (valid.length !== Object.keys(parsed).length) {
      window.sessionStorage.setItem(
        DELIVERY_QUOTES_STORAGE_KEY,
        JSON.stringify(result),
      );
    }
    return result;
  } catch {
    try {
      window.sessionStorage.removeItem(DELIVERY_QUOTES_STORAGE_KEY);
      window.sessionStorage.removeItem(LEGACY_DELIVERY_QUOTES_STORAGE_KEY);
    } catch {
      // Storage may be disabled; quotes still work without client-side reuse.
    }
    return {};
  }
}

function saveQuoteMap(quotes: Record<string, DeliveryQuote>): void {
  try {
    window.sessionStorage.setItem(
      DELIVERY_QUOTES_STORAGE_KEY,
      JSON.stringify(quotes),
    );
  } catch {
    // A successful provider quote must not fail because storage is unavailable.
  }
}

export async function getStoredDeliveryQuote(
  locationId: string,
  address: DeliveryAddressDraft,
): Promise<DeliveryQuote | null> {
  if (typeof window === "undefined") return null;
  try {
    return loadQuoteMap()[await quoteKey(locationId, address)] ?? null;
  } catch {
    return null;
  }
}

export async function storeDeliveryQuote(
  locationId: string,
  address: DeliveryAddressDraft,
  quote: DeliveryQuote,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const key = await quoteKey(locationId, address);
    const quotes = loadQuoteMap();
    quotes[key] = quote;
    saveQuoteMap(quotes);

    const existingTimer = expiryTimers.get(key);
    if (existingTimer) window.clearTimeout(existingTimer);
    const delay = Math.max(0, new Date(quote.expires_at).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      expiryTimers.delete(key);
      void removeStoredDeliveryQuote(locationId, address);
    }, Math.min(delay, 2_147_483_647));
    expiryTimers.set(key, timer);
  } catch {
    // Hashing/storage failure only disables reuse; the quote remains usable.
  }
}

export async function removeStoredDeliveryQuote(
  locationId: string,
  address: DeliveryAddressDraft,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const key = await quoteKey(locationId, address);
    const timer = expiryTimers.get(key);
    if (timer) window.clearTimeout(timer);
    expiryTimers.delete(key);
    const quotes = loadQuoteMap();
    delete quotes[key];
    saveQuoteMap(quotes);
  } catch {
    // Best-effort cache cleanup.
  }
}

export function pruneStoredDeliveryQuotes(): void {
  if (typeof window === "undefined") return;
  loadQuoteMap();
}

export function clearStoredDeliveryQuotes(): void {
  if (typeof window === "undefined") return;
  for (const timer of expiryTimers.values()) window.clearTimeout(timer);
  expiryTimers.clear();
  try {
    window.sessionStorage.removeItem(DELIVERY_QUOTES_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_DELIVERY_QUOTES_STORAGE_KEY);
  } catch {
    // Best-effort cleanup when browser storage is unavailable.
  }
}
