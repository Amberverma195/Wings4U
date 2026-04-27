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

/**
 * Socket.IO connects through the Next.js dev/prod server by default so the
 * `/ws` rewrite in `next.config.ts` can proxy the upgrade to the Nest API.
 * This avoids hard-coding port 3001 (which is not exposed publicly on
 * preview/prod deployments) and keeps cookies first-party.
 *
 * Override with `NEXT_PUBLIC_REALTIME_ORIGIN` only for split-host setups
 * where the API runs on a different domain that the browser must hit
 * directly (e.g. a separate realtime cluster).
 */
export function getRealtimeOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_REALTIME_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");

  if (typeof window !== "undefined") {
    return window.location.origin;
    }

  return "http://127.0.0.1:3001";
}

export const DEFAULT_LOCATION_ID =
  process.env.NEXT_PUBLIC_DEFAULT_LOCATION_ID ??
  "00000000-0000-4000-8000-000000000000";
