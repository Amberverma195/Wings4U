import type { NextFunction, Request, Response } from "express";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Pre-authentication endpoints that legitimately run before a csrf_token
 * cookie has been issued to the browser.
 *
 * This list also includes the one intentionally public cart mutation that
 * should stay callable before any auth interaction: `POST /cart/quote`.
 *
 * Important: keep this narrower than the set of `@Public()` routes.
 * `PUT/DELETE /cart/me` and `POST /cart/merge` are public for guests, but the
 * same handlers also mutate the signed-in user's cart when `req.user` exists.
 * Those routes therefore MUST still require CSRF once an auth cookie is
 * present; anonymous callers reach them through rule #3 below instead.
 *
 * If we later want CSRF on guest flows, we need an anonymous
 * csrf-bootstrap endpoint that issues a csrf_token cookie before these
 * are called. Until then, "public anonymous route -> no CSRF" is the
 * safest rule.
 */
function skipCsrf(path: string): boolean {
  if (path.startsWith("/api/v1/auth/otp")) return true;
  if (path.startsWith("/api/v1/auth/pos/login")) return true;
  if (path.startsWith("/api/v1/auth/kds/login")) return true;
  if (path.startsWith("/api/v1/kds/auth/login")) return true;
  if (path.startsWith("/api/v1/kds/auth/logout")) return true;
  if (path.startsWith("/api/v1/pos/auth/login")) return true;
  if (path.startsWith("/api/v1/pos/auth/logout")) return true;
  if (path.startsWith("/api/v1/auth/check-signup")) return true;
  // Public quote endpoint. Saved-cart mutations are intentionally NOT
  // allowlisted here because they become authenticated user-cart writes once
  // `req.user` is present.
  if (path === "/api/v1/cart/quote") return true;
  return false;
}

function reject(res: Response, requestId: string): void {
  res.status(403).json({
    data: null,
    meta: { request_id: requestId },
    errors: [{ code: "FORBIDDEN", message: "CSRF validation failed" }],
  });
}

/**
 * Strict double-submit cookie CSRF for **authenticated browser
 * mutations**. Layered rule (applied in order):
 *
 *   1. Non-mutating request -> allow.
 *   2. Request path is on the public-guest allowlist -> allow.
 *   3. Request has no session cookie (`access_token` / `refresh_token`)
 *      -> allow. This is the key fix for 401 semantics: protected
 *      endpoints must be able to return 401 from `AuthGuard` rather
 *      than 403 from this middleware when a signed-out client hits
 *      them. Without this, "signed out POST to admin-only route"
 *      always returns 403, which contradicts the plan and breaks
 *      API contracts.
 *   4. Otherwise -> both `csrf_token` cookie AND `X-CSRF-Token`
 *      header must exist and match.
 */
export function csrfMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }

  const path = req.path ?? "";
  if (skipCsrf(path)) {
    next();
    return;
  }

  const hasSessionCookie =
    Boolean(req.cookies?.access_token) || Boolean(req.cookies?.refresh_token);
  if (!hasSessionCookie) {
    // No auth cookies at all -> treat as an anonymous request. Let the
    // downstream guards decide (401 on protected routes, public
    // controllers handle it themselves). CSRF only defends authenticated
    // browser sessions; an unauthenticated attacker has nothing to forge.
    next();
    return;
  }

  const cookieToken = req.cookies?.csrf_token as string | undefined;
  const headerToken = req.headers["x-csrf-token"];
  const requestId = req.requestId ?? "unknown";

  if (!cookieToken) {
    reject(res, requestId);
    return;
  }
  if (typeof headerToken !== "string" || !headerToken) {
    reject(res, requestId);
    return;
  }
  if (cookieToken !== headerToken) {
    reject(res, requestId);
    return;
  }
  next();
}
