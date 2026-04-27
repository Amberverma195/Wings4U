import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicApiBase } from "./env";

interface ApiEnvelope<T> {
  data?: T;
}

interface PosNetworkStatus {
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
    `Failed to reach POS network gate endpoint at ${url} after retries: ${cause}`,
  );
}

export async function requirePosNetworkAccess(
  locationId: string,
): Promise<void> {
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get("cookie") ?? "";
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const realIp = requestHeaders.get("x-real-ip");

  const res = await fetchWithRetry(
    `${getPublicApiBase()}/api/v1/auth/pos/network-status?location_id=${encodeURIComponent(locationId)}`,
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
      `POS network gate failed while protecting /pos (${res.status} ${res.statusText})`,
    );
  }

  const body = (await res.json()) as ApiEnvelope<PosNetworkStatus>;
  if (body?.data?.allowed !== true) {
    notFound();
  }
}
