import { NextRequest, NextResponse } from "next/server";
import { getPublicApiBase } from "./env";
import { buildStationGateHeaders } from "./server-station-gate-headers";

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

export async function proxyStationLogin(
  request: NextRequest,
  upstreamPath: "/api/v1/kds/auth/login" | "/api/v1/pos/auth/login",
): Promise<NextResponse> {
  const body = await request.text();
  const upstream = await fetch(`${getPublicApiBase()}${upstreamPath}`, {
    method: "POST",
    headers: {
      ...buildStationGateHeaders(
        request.headers,
        request.headers.get("cookie") ?? "",
      ),
      "content-type": request.headers.get("content-type") ?? "application/json",
      accept: "application/json",
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
