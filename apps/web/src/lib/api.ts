import type { ApiEnvelope, ApiErrorBody } from "@wings4u/contracts";
import { dispatchConnectivityFailure } from "./connectivity-events";
import { getPublicApiBase } from "./env";

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

export async function apiFetch(
  path: string,
  init: RequestInit & { locationId?: string } = {}
): Promise<Response> {
  const { locationId, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  const csrf = readCookie("csrf_token");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  if (locationId) headers.set("X-Location-Id", locationId);
  const base = getPublicApiBase();
  return fetch(`${base}${path}`, {
    ...rest,
    credentials: "include",
    headers
  });
}

export async function apiJson<T>(
  path: string,
  init?: RequestInit & { locationId?: string }
): Promise<ApiEnvelope<T>> {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch (cause) {
    dispatchConnectivityFailure("network");
    const reason = cause instanceof Error ? cause.message : String(cause);
    const isFetchFailed =
      /failed to fetch|networkerror|load failed|network request failed/i.test(reason);
    const connectivityHint = isFetchFailed
      ? " The browser never reached the API (TCP/network). From the repo root run `npm run dev` (starts API + web) or in two terminals `npm run dev:api` then `npm run dev:web`. Ensure something listens on port 3001 (Nest default). If the API is up but Next’s proxy fails on Windows, add `NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3001` to `apps/web/.env.local` and restart Next. After any change to `apps/web/.env.local`, restart the Next dev server."
      : " If you do get HTTP errors (not this), confirm `NEXT_PUBLIC_DEFAULT_LOCATION_ID` in `apps/web/.env.local` matches `locations.id` for LON01 in your DB.";
    throw new Error(
      `API request failed before a response was returned.${connectivityHint} Original error: ${reason}`
    );
  }

  // Avoid confusing "Unexpected token <" / "Unexpected token I" errors when the API
  // is down or returns a non-JSON error page through the dev proxy.
  const raw = await res.text();
  let body: ApiEnvelope<T> | null = null;
  try {
    body = JSON.parse(raw) as ApiEnvelope<T>;
  } catch {
    // Fall through: non-JSON response.
  }

  if (!body) {
    const snippet = raw.trim().slice(0, 160);
    const hint =
      res.status === 500 && raw.trim() === "Internal Server Error"
        ? " The Next dev server proxies `/api/*` to the Nest API (see `apps/web/next.config.ts`). Plain-text \"Internal Server Error\" usually means the proxy could not reach the API (nothing on port 3001) or a Windows/localhost proxy quirk. Fix: (1) Start the API (`npm run dev:api` or `npm run dev` from repo root). (2) Set `NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3001` in `apps/web/.env.local` so the browser talks to Nest directly and skips the proxy, then restart Next. (3) Confirm `NEXT_PUBLIC_DEFAULT_LOCATION_ID` matches `locations.id` for LON01."
        : "";
    throw new Error(
      snippet
        ? `API returned non-JSON (${res.status} ${res.statusText}): ${snippet}${hint}`
        : `API returned non-JSON (${res.status} ${res.statusText}).${hint}`
    );
  }

  if (!res.ok) {
    if (res.status >= 500) {
      dispatchConnectivityFailure("server");
    }
    throw new Error(getApiErrorMessage(body, res.statusText));
  }
  return body;
}

export function getApiErrorMessage(body: unknown, fallback = "Request failed"): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  const candidate = body as {
    errors?: Array<{ message?: string }>;
    message?: string | string[];
    error?: string;
  };

  const firstEnvelopeMessage = candidate.errors?.[0]?.message?.trim();
  if (firstEnvelopeMessage) {
    return firstEnvelopeMessage;
  }

  if (Array.isArray(candidate.message)) {
    const joined = candidate.message
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join(" ");
    if (joined) {
      return joined;
    }
  }

  if (typeof candidate.message === "string" && candidate.message.trim()) {
    return candidate.message.trim();
  }

  if (typeof candidate.error === "string" && candidate.error.trim()) {
    return candidate.error.trim();
  }

  return fallback;
}

export type { ApiEnvelope, ApiErrorBody };
