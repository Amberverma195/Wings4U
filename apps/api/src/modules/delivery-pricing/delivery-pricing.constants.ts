export const RESTAURANT_ORIGIN = {
  latitude: 42.9998852,
  longitude: -81.1943749,
} as const;

export const DELIVERY_INCLUDED_DISTANCE_METRES = 5_000;
export const DELIVERY_MAXIMUM_DISTANCE_METRES = 20_000;
export const DELIVERY_BASE_FEE_CENTS = 500;
export const DELIVERY_INCREMENT_CENTS = 100;
export const DELIVERY_PRICING_RULE_VERSION = 1 as const;
export const DELIVERY_QUOTE_LIFETIME_MS = 60 * 60 * 1_000;
export const DELIVERY_ROUTE_CACHE_TTL_SECONDS = 60 * 60;
export const DELIVERY_ROUTE_LOCAL_CACHE_MAX_ENTRIES = 1_000;
export const DELIVERY_QUOTE_RATE_LIMIT = 12;
export const DELIVERY_QUOTE_GLOBAL_RATE_LIMIT = 300;
export const DELIVERY_QUOTE_RATE_WINDOW_MS = 15 * 60 * 1_000;
/** Short-window budget so bursts stay under Google's ~30 QPM ceiling. */
export const DELIVERY_QUOTE_GLOBAL_BURST_LIMIT = 25;
export const DELIVERY_QUOTE_GLOBAL_BURST_WINDOW_MS = 60 * 1_000;

export const GOOGLE_ROUTES_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
export const GOOGLE_ROUTES_TIMEOUT_MS = 5_000;

export const DELIVERY_QUOTE_SIGNING_CONTEXT =
  "wings4u.delivery-quote.distance-pricing.v1";
export const FIXED_DELIVERY_QUOTE_SIGNING_CONTEXT =
  "wings4u.delivery-quote.fixed-pricing.v1";

export function isDeliveryDistancePricingEnabled(): boolean {
  return process.env.DELIVERY_DISTANCE_PRICING_ENABLED?.trim().toLowerCase() === "true";
}

export function calculateDeliveryFeeCents(distanceMetres: number): number | null {
  if (!Number.isFinite(distanceMetres) || distanceMetres < 0) {
    throw new Error("distanceMetres must be a non-negative finite number");
  }
  if (distanceMetres > DELIVERY_MAXIMUM_DISTANCE_METRES) {
    return null;
  }

  const additionalKilometres = Math.ceil(
    Math.max(0, distanceMetres - DELIVERY_INCLUDED_DISTANCE_METRES) / 1_000,
  );
  return DELIVERY_BASE_FEE_CENTS + additionalKilometres * DELIVERY_INCREMENT_CENTS;
}
