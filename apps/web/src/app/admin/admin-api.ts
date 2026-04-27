import { apiFetch } from "@/lib/api";
import { notifyAuthSessionCleared } from "@/lib/auth-events";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import type { ApiEnvelope } from "@wings4u/contracts";

/**
 * Drop-in `apiFetch` for admin surfaces. Always injects the
 * `X-Location-Id` header (LocationScopeGuard rejects requests without a valid
 * UUID), and lets callers still override per-call by passing `locationId`.
 */
export function adminApiFetch(
  path: string,
  init: RequestInit & { locationId?: string } = {},
): Promise<Response> {
  return apiFetch(path, {
    ...init,
    locationId: init.locationId ?? DEFAULT_LOCATION_ID,
  });
}

/**
 * Lightweight wrapper used by the admin client surfaces. Returns the unwrapped
 * `data` field on success and throws a readable Error on failure so callers
 * can render the message directly.
 */
export async function adminFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await adminApiFetch(path, { ...init, headers });
  const raw = await res.text();
  let body: ApiEnvelope<T> | null = null;
  try {
    body = raw ? (JSON.parse(raw) as ApiEnvelope<T>) : null;
  } catch {
    /* fall through to error path */
  }
  if (!res.ok) {
    const message =
      (body as { errors?: Array<{ message?: string }>; message?: string } | null)
        ?.errors?.[0]?.message ??
      (typeof (body as { message?: string } | null)?.message === "string"
        ? (body as { message?: string }).message
        : undefined) ??
      `Request failed (${res.status})`;
    const isAuthFailure =
      res.status === 401 ||
      /auth(?:entication)? token|unauthorized/i.test(message);
    if (isAuthFailure) {
      notifyAuthSessionCleared();
    }
    throw new Error(message);
  }
  return (body?.data ?? body) as T;
}

export function formatCents(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}
