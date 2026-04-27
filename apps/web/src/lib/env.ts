/**
 * Base URL for `/api/v1/*` JSON calls.
 * - Browser: empty string → same-origin `/api/...` (Next rewrites to the Nest API in dev).
 * - If `NEXT_PUBLIC_API_ORIGIN` is set (e.g. `http://127.0.0.1:3001`), the browser calls the API
 *   directly and skips the dev proxy. Use when the proxy returns plain-text 500 while the API is up.
 * - Server (RSC): `INTERNAL_API_URL` (direct to Nest).
 */
export function getPublicApiBase(): string {
  if (typeof window !== "undefined") {
    const direct = process.env.NEXT_PUBLIC_API_ORIGIN?.trim();
    if (direct) return direct.replace(/\/$/, "");
    return "";
  }
  return process.env.INTERNAL_API_URL ?? "http://127.0.0.1:3001";
}

/** Socket.IO connects to the API process directly (not proxied through Next). */
export function getRealtimeOrigin(): string {
  return process.env.NEXT_PUBLIC_REALTIME_ORIGIN ?? "http://127.0.0.1:3001";
}

export const DEFAULT_LOCATION_ID =
  process.env.NEXT_PUBLIC_DEFAULT_LOCATION_ID ??
  "00000000-0000-4000-8000-000000000000";
