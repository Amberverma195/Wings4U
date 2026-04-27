import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveSession } from "./src/lib/auth-session";
import { isAuthorizedForSurface, policyForPath } from "./src/lib/surface-policy";

/**
 * Edge-runtime prefilter for protected Next surfaces.
 *
 * Scope is intentionally narrow:
 *   - Signed-out / invalid / expired JWT -> redirect to `/auth/login`.
 *   - Valid JWT whose role/employeeRole claim fails the surface policy ->
 *     rewrite to `/403` with a real HTTP 403 status so the browser, curl,
 *     and any consumer sees a proper Forbidden response. Rewriting (not
 *     redirecting) keeps the URL bar on the requested path and avoids a
 *     302 -> 200 pattern that some clients cache oddly.
 *   - Valid JWT satisfying the surface policy -> allow through.
 *
 * This is a prefilter only. It never hits the database and it never reaches
 * the API. JWT signature alone is not enough to trust the role (role
 * demotion and session revocation won't be visible until the JWT expires),
 * so the admin/KDS/POS server layouts each perform an authoritative
 * server-side check against `GET /api/v1/auth/session` before rendering.
 *
 * For KDS specifically, the surface uses a station-access model (network
 * gate + employee PIN) so it is NOT edge-gated — unsigned-out users on the
 * store network see the PIN screen instead of being redirected to login.
 * The KDS layout handles its own auth flow.
 */
export async function middleware(req: NextRequest) {
  const policyId = policyForPath(req.nextUrl.pathname);
  if (!policyId) {
    return NextResponse.next();
  }

  const accessToken = req.cookies.get("access_token")?.value;
  const session = await resolveSession(accessToken);

  if (!session) {
    // KDS handles its own auth (network gate + PIN screen), so we don't
    // redirect to /auth/login. For /admin, we still do.
    const loginUrl = new URL("/auth/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (!isAuthorizedForSurface(session, policyId)) {
    const deniedUrl = new URL("/403", req.url);
    return NextResponse.rewrite(deniedUrl, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
