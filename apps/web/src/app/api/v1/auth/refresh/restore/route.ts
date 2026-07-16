import { NextRequest, NextResponse } from "next/server";
import { getPublicApiBase } from "@/lib/env";

const ADMIN_ROOT = "/admin";
const REFRESH_PATH = "/api/v1/auth/refresh";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function getRefreshUrl(): string {
  const internalApi = process.env.INTERNAL_API_URL?.trim();
  if (internalApi) {
    return `${trimTrailingSlash(internalApi)}${REFRESH_PATH}`;
  }

  if (process.env.NODE_ENV === "development") {
    return `http://127.0.0.1:3001${REFRESH_PATH}`;
  }

  const proxyTarget = process.env.API_PROXY_TARGET?.trim();
  if (proxyTarget) {
    return `${trimTrailingSlash(proxyTarget)}${REFRESH_PATH}`;
  }

  return `${trimTrailingSlash(getPublicApiBase())}${REFRESH_PATH}`;
}

function getSetCookieHeaders(headers: Headers): string[] {
  const headersWithCookies = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headersWithCookies.getSetCookie === "function") {
    return headersWithCookies.getSetCookie();
  }

  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function getSafeReturnPath(request: NextRequest): string {
  const candidate = request.nextUrl.searchParams.get("returnTo") ?? ADMIN_ROOT;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return ADMIN_ROOT;
  }

  const parsed = new URL(candidate, "https://wings4u.invalid");
  const isAdminPath =
    parsed.pathname === ADMIN_ROOT || parsed.pathname.startsWith(`${ADMIN_ROOT}/`);
  if (parsed.origin !== "https://wings4u.invalid" || !isAdminPath || parsed.hash) {
    return ADMIN_ROOT;
  }

  return `${parsed.pathname}${parsed.search}`;
}

function buildReturnUrl(request: NextRequest, returnPath: string): URL {
  const parsed = new URL(returnPath, "https://wings4u.invalid");
  const target = request.nextUrl.clone();
  target.pathname = parsed.pathname;
  target.search = parsed.search;
  target.hash = "";
  return target;
}

/**
 * Browser navigation target used only when an /admin request has an expired
 * access JWT. Its path deliberately sits beneath the narrowly scoped refresh
 * cookie, allowing token rotation without exposing that cookie to all routes.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const csrfToken = request.cookies.get("csrf_token")?.value;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const returnUrl = buildReturnUrl(request, getSafeReturnPath(request));

  let upstream: Response;
  try {
    upstream = await fetch(getRefreshUrl(), {
      method: "POST",
      headers: {
        accept: "application/json",
        cookie: cookieHeader,
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      },
      cache: "no-store",
      credentials: "include",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return NextResponse.json(
      { error: "Session restoration is temporarily unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "Session restoration failed." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  const response = NextResponse.redirect(returnUrl, 303);
  response.headers.set("cache-control", "no-store");
  for (const cookie of getSetCookieHeaders(upstream.headers)) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
