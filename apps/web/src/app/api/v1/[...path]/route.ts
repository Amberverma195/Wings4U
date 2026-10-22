import { buildSignedClientIpHeaders } from "@/lib/server-station-gate-headers";

import { boundedProxyBody, isProxyPayloadTooLarge, MAX_API_PROXY_BODY_BYTES } from "@/lib/api-proxy-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(request: Request) {
  const tooLarge = () => Response.json({ data: null, errors: [{ code: "PAYLOAD_TOO_LARGE",
    message: "Request is too large. Menu images must be 4 MiB or smaller." }] }, { status: 413 });
  const declaredSize = Number(request.headers.get("content-length"));
  if (declaredSize > MAX_API_PROXY_BODY_BYTES) return tooLarge();
  const incoming = new URL(request.url);
  const base = (process.env.API_PROXY_TARGET || process.env.INTERNAL_API_URL || "http://localhost:3001").replace(/\/$/, "");
  if (new URL(base).origin === incoming.origin) {
    return Response.json({ data: null, errors: [{ code: "PROXY_CONFIGURATION_ERROR", message: "API proxy target must use a separate API origin." }] }, { status: 502 });
  }
  const upstreamHeaders = new Headers(buildSignedClientIpHeaders(request.headers));
  // Never copy caller-supplied proxy signatures or the privileged catalog-server header.
  for (const name of ["accept", "content-type", "cookie", "authorization", "x-csrf-token", "x-location-id", "x-w4u-signup-device", "idempotency-key", "x-idempotency-key", "x-request-id"]) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }
  try {
    const upstream = await fetch(base + incoming.pathname + incoming.search, {
      method: request.method, headers: upstreamHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : boundedProxyBody(request.body),
      cache: "no-store", redirect: "manual",
      ...(!["GET", "HEAD"].includes(request.method) ? { duplex: "half" } : {}),
    });
    const headers = new Headers({ "cache-control": "private, no-store" });
    for (const name of ["content-type", "retry-after", "location", "x-request-id"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) headers.append("set-cookie", cookie);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (isProxyPayloadTooLarge(error)) return tooLarge();
    throw error;
  }
}
export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS };
