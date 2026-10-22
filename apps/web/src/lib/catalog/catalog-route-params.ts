import { DEFAULT_LOCATION_ID } from "@/lib/env";

// Mirrors the API's accepted location refs (UUID or short location code).
const LOCATION_REF_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9][a-z0-9_-]{1,31})$/i;
const SCHEDULE_PAST_LIMIT_MS = 7 * 24 * 60 * 60_000;
const SCHEDULE_FUTURE_LIMIT_MS = 30 * 24 * 60 * 60_000;

/**
 * Every distinct query string is a separate Next.js data-cache entry and a
 * separate upstream API call, so these handlers only accept values that can
 * produce a distinct menu.
 */
export function parseCatalogLocationId(raw: string | null): string | null {
  const value = raw?.trim() || DEFAULT_LOCATION_ID;
  return LOCATION_REF_RE.test(value) ? value : null;
}

/**
 * Menu availability is evaluated per minute, so equivalent timestamps are
 * collapsed onto one canonical minute instead of one cache entry each.
 * Times outside the ordering horizon (for example a stale schedule kept in
 * a signed-in customer's saved cart) fall back to the current menu.
 */
export function normalizeCatalogScheduledFor(
  raw: string | null,
  now = Date.now(),
): { ok: true; value: string | undefined } | { ok: false } {
  const value = raw?.trim();
  if (!value) return { ok: true, value: undefined };
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return { ok: false };
  if (ms < now - SCHEDULE_PAST_LIMIT_MS || ms > now + SCHEDULE_FUTURE_LIMIT_MS) {
    return { ok: true, value: undefined };
  }
  return { ok: true, value: new Date(Math.floor(ms / 60_000) * 60_000).toISOString() };
}
