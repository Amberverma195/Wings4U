import { buildSignedClientIpHeaders } from "@/lib/server-station-gate-headers";

export const dynamic = "force-dynamic";

async function proxy(request: Request) {
  const incoming = new URL(request.url);
  const base = (process.env.API_PROXY_TARGET || process.env.INTERNAL_API_URL || "http://localhost:3001").replace(/\/$/, "");
  const upstreamHeaders = new Headers(buildSignedClientIpHeaders(request.headers));
  // Never copy caller-supplied proxy signatures or the privileged catalog-server header.
  for (const name of ["accept", "content-type", "cookie", "authorization", "x-csrf-token", "x-location-id", "x-w4u-signup-device", "idempotency-key", "x-idempotency-key", "x-request-id"]) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }
  const upstream = await fetch(base + incoming.pathname + incoming.search, {
    method: request.method, headers: upstreamHeaders,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    cache: "no-store", redirect: "manual",
  });
  const headers = new Headers({ "cache-control": "private, no-store" });
  for (const name of ["content-type", "retry-after", "location", "x-request-id"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(upstream.body, { status: upstream.status, headers });
}
export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS };
