/**
 * Mobile API client - ported from `apps/web/src/lib/api.ts`.
 *
 * Key differences from the web version:
 *   - Uses `getApiBase()` from the mobile env module (Expo Constants) instead
 *     of `getPublicApiBase()` which reads `NEXT_PUBLIC_*` env vars.
 *   - No CSRF cookie reading (mobile uses token-based auth, not cookies).
 *   - Auth token is read from secure storage and sent as a Bearer header.
 *   - No `credentials: "include"` (irrelevant for native fetch).
 *   - Connectivity events use a simple EventEmitter instead of DOM CustomEvent.
 */
import type { ApiEnvelope, ApiErrorBody } from "@wings4u/contracts";
import { getApiBase } from "./env";
import { getAccessToken } from "./token-store";

/* ------------------------------------------------------------------ */
/*  Connectivity                                                       */
/* ------------------------------------------------------------------ */

type ConnectivityListener = (reason: "offline" | "network" | "server") => void;
const connectivityListeners = new Set<ConnectivityListener>();

export function addConnectivityListener(fn: ConnectivityListener) {
  connectivityListeners.add(fn);
  return () => {
    connectivityListeners.delete(fn);
  };
}

function dispatchConnectivityFailure(
  reason: "offline" | "network" | "server"
): void {
  for (const fn of connectivityListeners) {
    try {
      fn(reason);
    } catch {
      // swallow listener errors
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Core fetch wrapper                                                 */
/* ------------------------------------------------------------------ */

export async function apiFetch(
  path: string,
  init: RequestInit & { locationId?: string } = {}
): Promise<Response> {
  const { locationId, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);

  // Attach Bearer token from secure storage
  const token = await getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (locationId) {
    headers.set("X-Location-Id", locationId);
  }

  const base = getApiBase();
  return fetch(`${base}${path}`, {
    ...rest,
    headers,
  });
}

/* ------------------------------------------------------------------ */
/*  JSON envelope helper                                               */
/* ------------------------------------------------------------------ */

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
    throw new Error(
      `API request failed before a response was returned. Original error: ${reason}`
    );
  }

  const raw = await res.text();
  let body: ApiEnvelope<T> | null = null;
  try {
    body = JSON.parse(raw) as ApiEnvelope<T>;
  } catch {
    // Non-JSON response
  }

  if (!body) {
    const snippet = raw.trim().slice(0, 160);
    throw new Error(
      snippet
        ? `API returned non-JSON (${res.status} ${res.statusText}): ${snippet}`
        : `API returned non-JSON (${res.status} ${res.statusText}).`
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

/* ------------------------------------------------------------------ */
/*  Error extraction                                                   */
/* ------------------------------------------------------------------ */

export function getApiErrorMessage(
  body: unknown,
  fallback = "Request failed"
): string {
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
