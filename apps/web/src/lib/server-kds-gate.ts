import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicApiBase } from "./env";

interface ApiEnvelope<T> {
  data?: T;
}

interface KdsNetworkStatus {
  allowed?: boolean;
}

const ATTEMPT_DELAYS_MS = [0, 150, 400];

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = null;

  for (const delay of ATTEMPT_DELAYS_MS) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(4000),
      });
    } catch (error) {
      lastError = error;
    }
  }

  const cause =
    lastError instanceof Error ? lastError.message : "unknown error";
  throw new Error(
    `Failed to reach KDS network gate endpoint at ${url} after retries: ${cause}`,
  );
}

/**
 * Server-side network gate for the KDS surface.
 *
 * Calls `GET /api/v1/auth/kds/network-status?location_id=...` forwarding
 * the caller's IP headers. If the client IP is not in the store's trusted
 * range, the page renders as 404 (same behaviour as POS).
 *
 * This endpoint is public (no auth cookie required) so that unsigned-out
 * visitors on the store network still reach the KDS PIN screen instead of
 * being redirected to `/auth/login`.
 */
export async function requireKdsNetworkAccess(
  locationId: string,
): Promise<void> {
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get("cookie") ?? "";
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const realIp = requestHeaders.get("x-real-ip");

  const res = await fetchWithRetry(
    `${getPublicApiBase()}/api/v1/auth/kds/network-status?location_id=${encodeURIComponent(locationId)}`,
    {
      method: "GET",
      headers: {
        cookie: cookieHeader,
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
        ...(realIp ? { "x-real-ip": realIp } : {}),
      },
      cache: "no-store",
      credentials: "include",
    },
  );

  if (res.status === 401 || res.status === 403) {
    notFound();
  }

  if (!res.ok) {
    throw new Error(
      `KDS network gate failed while protecting /kds (${res.status} ${res.statusText})`,
    );
  }

  const body = (await res.json()) as ApiEnvelope<KdsNetworkStatus>;
  if (body?.data?.allowed !== true) {
    notFound();
  }
}
