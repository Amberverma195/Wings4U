/**
 * Base URL for `/api/v1/*` JSON calls.
 * - Browser: empty string -> same-origin `/api/...` (Next rewrites to the Nest API in dev).
 * - If `NEXT_PUBLIC_API_ORIGIN` is set (e.g. `http://127.0.0.1:3001`), the browser calls the API
 *   directly and skips the dev proxy. Use when the proxy returns plain-text 500 while the API is up.
 * - Server (RSC): `INTERNAL_API_URL` (direct to Nest), or in development
 *   `http://127.0.0.1:${PORT}` through Next's `/api/*` rewrite when unset.
 */
function normalizeOrigin(value: string | undefined, fallbackProtocol = "https"): string {
  const trimmed = value?.trim().replace(/\/$/, "") ?? "";
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `${fallbackProtocol}:${trimmed}`;

  const host = trimmed.split("/")[0] ?? trimmed;
  const isLocalHost =
    host.startsWith("localhost") ||
    host.startsWith("127.") ||
    host.startsWith("0.0.0.0") ||
    host.startsWith("[::1]") ||
    host.startsWith("::1");
  const protocol = isLocalHost ? "http" : fallbackProtocol;
  return `${protocol}://${trimmed}`;
}

export function getPublicApiBase(): string {
  if (typeof window !== "undefined") {
    const direct = normalizeOrigin(
      process.env.NEXT_PUBLIC_API_ORIGIN,
      window.location.protocol === "http:" ? "http" : "https",
    );
    if (direct) return direct;
    return "";
  }
  const internal = normalizeOrigin(process.env.INTERNAL_API_URL);
  if (internal) return internal;
  // In `next dev`, route SSR fetches through this app's `/api/*` rewrites (see
  // `next.config.ts`) instead of hard-coding the Nest port. That keeps behavior
  // aligned with the browser and avoids extra binding quirks between hosts.
  if (process.env.NODE_ENV === "development") {
    const port = process.env.PORT ?? "3000";
    return `http://127.0.0.1:${port}`;
  }
  return "http://127.0.0.1:3001";
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
 *   3. In dev on :3000               - hard fallback to the Nest API on
 *      the same hostname at :3001. Required because Next's dev
 *      `rewrites()` cannot proxy WebSocket upgrades, and
 *      `window.location.origin` would point at the Next server which can
 *      never serve `/ws` over WS. This includes LAN testing URLs like
 *      `http://10.0.0.192:3000`, not just localhost.
 *   4. `window.location.origin`      - same-origin fallback (prod behind
 *      a reverse proxy that handles WS upgrades, e.g. nginx / Vercel).
 */
export function getRealtimeOrigin(): string {
  const fallbackProtocol =
    typeof window !== "undefined" && window.location.protocol === "http:" ? "http" : "https";

  const realtime = normalizeOrigin(process.env.NEXT_PUBLIC_REALTIME_ORIGIN, fallbackProtocol);
  if (realtime) return realtime;

  const api = normalizeOrigin(process.env.NEXT_PUBLIC_API_ORIGIN, fallbackProtocol);
  if (api) return api;

  if (typeof window !== "undefined") {
    // Dev safeguard: when the page is served by `next dev` on port 3000,
    // routing the socket through `window.location.origin` lands on the
    // Next dev server which does not terminate WebSocket upgrades for `/ws`.
    const { hostname, port, protocol, origin } = window.location;
    if (process.env.NODE_ENV === "development" && port === "3000") {
      const scheme = protocol === "https:" ? "https" : "http";
      return `${scheme}://${hostname}:3001`;
    }

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

const configuredDefaultLocationId =
  process.env.NEXT_PUBLIC_DEFAULT_LOCATION_ID?.trim();

export const DEFAULT_LOCATION_ID =
  configuredDefaultLocationId &&
  configuredDefaultLocationId !== "00000000-0000-4000-8000-000000000000"
    ? configuredDefaultLocationId
    : "LON01";
