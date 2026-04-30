import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveSession } from "./src/lib/auth-session";
import { isAuthorizedForSurface, policyForPath } from "./src/lib/surface-policy";

/**
 * Edge-runtime prefilter for protected Next surfaces.
 *
 * Scope is intentionally narrow:
 *   - Signed-out / invalid / expired JWT -> allow the request through to
 *     the server layout, which hides `/admin` as a 404.
 *   - Valid JWT whose role/employeeRole claim fails the surface policy ->
 *     allow the request through to the authoritative server layout, which
 *     can fail closed as a 404 using the current DB-backed session.
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
    return NextResponse.next();
  }

  if (!isAuthorizedForSurface(session, policyId)) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
