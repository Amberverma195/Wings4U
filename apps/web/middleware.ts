import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveSession } from "./src/lib/auth-session";
import { isAuthorizedForSurface, policyForPath } from "./src/lib/surface-policy";

const AUTH_REFRESH_RESTORE_PATH = "/api/v1/auth/refresh/restore";

/**
 * Edge-runtime prefilter for protected Next surfaces.
 *
 * Scope is intentionally narrow:
 *   - Expired JWT with a long-lived session hint -> redirect through the
 *     refresh-cookie-scoped restore route, then return to the requested URL.
 *   - Fully signed-out / invalid JWT -> allow the request through to the
 *     server layout, which hides `/admin` as a 404.
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
    // The access cookie lasts 15 minutes, while csrf_token and the httpOnly
    // refresh cookie last 30 days. csrf_token is visible at /admin and acts
    // only as a hint; the restore route still requires and validates the real
    // refresh token before issuing a new access token.
    if (req.cookies.has("csrf_token")) {
      const restoreUrl = req.nextUrl.clone();
      const returnTo = `${req.nextUrl.pathname}${req.nextUrl.search}`;
      restoreUrl.pathname = AUTH_REFRESH_RESTORE_PATH;
      restoreUrl.search = "";
      restoreUrl.searchParams.set("returnTo", returnTo);
      return NextResponse.redirect(restoreUrl);
    }

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
