/**
 * Base URL for `/api/v1/*` JSON calls.
 * - Browser: empty string -> same-origin `/api/...` (Next rewrites to the Nest API in dev).
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
 * Socket.IO origin for the `/ws` gateway.
 *
 * Next.js `rewrites()` proxies regular HTTP requests but does **not**
 * proxy WebSocket upgrade requests. When the client connects through the
 * Next.js server (`window.location.origin`), Socket.IO falls back to HTTP
 * long-polling which is unreliable; events can be delayed or silently
 * dropped, causing the customer UI to not reflect KDS changes until a
 * manual page reload.
 *
 * The fix: in development the client connects directly to the Nest API
 * server (via `NEXT_PUBLIC_API_ORIGIN`, typically `http://localhost:3001`)
 * so the WebSocket upgrade succeeds. In production, set
 * `NEXT_PUBLIC_REALTIME_ORIGIN` to the API's public URL.
 *
 * Priority:
 *   1. `NEXT_PUBLIC_REALTIME_ORIGIN` - explicit override for any env.
 *   2. `NEXT_PUBLIC_API_ORIGIN`      - direct API origin (dev default).
 *   3. In dev on localhost:3000      - hard fallback to the Nest API on
 *      localhost:3001. Required because Next's dev `rewrites()` cannot
 *      proxy WebSocket upgrades, and `window.location.origin` would
 *      point at the Next server which can never serve `/ws` over WS.
 *      Without this, a missing `.env.local` silently breaks realtime.
 *   4. `window.location.origin`      - same-origin fallback (prod behind
 *      a reverse proxy that handles WS upgrades, e.g. nginx / Vercel).
 */
export function getRealtimeOrigin(): string {
  const realtime = process.env.NEXT_PUBLIC_REALTIME_ORIGIN?.trim();
  if (realtime) return realtime.replace(/\/$/, "");

  const api = process.env.NEXT_PUBLIC_API_ORIGIN?.trim();
  if (api) return api.replace(/\/$/, "");

  if (typeof window !== "undefined") {
    // Dev safeguard: when the page is served by `next dev` on localhost,
    // routing the socket through `window.location.origin` lands on the
    // Next dev server which does not terminate WebSocket upgrades for `/ws`.
    const { hostname, protocol, origin } = window.location;
    const isLocalDev =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    if (isLocalDev) {
      const scheme = protocol === "https:" ? "https" : "http";
      return `${scheme}://${hostname}:3001`;
    }
    return origin;
  }

  return "http://127.0.0.1:3001";
}

export const DEFAULT_LOCATION_ID =
  process.env.NEXT_PUBLIC_DEFAULT_LOCATION_ID ??
  "00000000-0000-4000-8000-000000000000";
