import { NextRequest, NextResponse } from "next/server";
import { getPublicApiBase } from "./env";
import { buildStationGateHeaders } from "./server-station-gate-headers";

const STORE_NETWORK_PREFIXES = ["/api/v1/kds", "/api/v1/pos", "/api/v1/timeclock"];
const STORE_NETWORK_EXACT_PATHS = ["/api/v1/drivers/available"];
const STATION_PROXY_VALIDATION_ORIGIN = "https://station-proxy.invalid";

function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie();
  }

  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

async function proxyStationUpstream(
  request: NextRequest,
  upstreamPath: string,
): Promise<NextResponse> {
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.text();
  const contentType = request.headers.get("content-type");
  const locationId = request.headers.get("x-location-id");
  const csrfToken = request.headers.get("x-csrf-token");
  const authorization = request.headers.get("authorization");
  const upstream = await fetch(`${getPublicApiBase()}${upstreamPath}`, {
    method,
    headers: {
      ...buildStationGateHeaders(
        request.headers,
        request.headers.get("cookie") ?? "",
      ),
      ...(contentType ? { "content-type": contentType } : {}),
      accept: request.headers.get("accept") ?? "application/json",
      ...(locationId ? { "x-location-id": locationId } : {}),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...(authorization ? { authorization } : {}),
    },
    body,
    cache: "no-store",
    credentials: "include",
  });

  const responseBody = await upstream.text();
  const response = new NextResponse(responseBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });

  for (const cookie of getSetCookieHeaders(upstream.headers)) {
    response.headers.append("set-cookie", cookie);
  }

  return response;
}

function getAllowedStoreNetworkPath(upstreamPath: string): string | null {
  const candidate = upstreamPath.trim();
  if (
    !candidate.startsWith("/api/v1/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return null;
  }

  const rawPathname = candidate.split("?")[0] ?? candidate;
  let url: URL;
  try {
    url = new URL(candidate, STATION_PROXY_VALIDATION_ORIGIN);
  } catch {
    return null;
  }

  if (
    url.origin !== STATION_PROXY_VALIDATION_ORIGIN ||
    url.hash ||
    url.pathname !== rawPathname
  ) {
    return null;
  }

  const pathname = url.pathname;
  if (STORE_NETWORK_EXACT_PATHS.includes(pathname)) {
    return `${pathname}${url.search}`;
  }

  const allowed = STORE_NETWORK_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return allowed ? `${pathname}${url.search}` : null;
}

export async function proxyStationLogin(
  request: NextRequest,
  upstreamPath: "/api/v1/kds/auth/login" | "/api/v1/pos/auth/login",
): Promise<NextResponse> {
  return proxyStationUpstream(request, upstreamPath);
}

export async function proxyStoreNetworkApi(
  request: NextRequest,
): Promise<NextResponse> {
  const upstreamPath = getAllowedStoreNetworkPath(
    request.nextUrl.searchParams.get("path") ?? "",
  );
  if (!upstreamPath) {
    return NextResponse.json(
      {
        data: null,
        errors: [{ code: "INVALID_STATION_PROXY_PATH", message: "Invalid station proxy path" }],
      },
      { status: 400 },
    );
  }

  return proxyStationUpstream(request, upstreamPath);
}
