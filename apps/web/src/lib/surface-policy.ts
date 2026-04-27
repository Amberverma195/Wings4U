import type { SessionRole, EmployeeRole, WebSession } from "./auth-session";

/**
 * Web-surface access policies.
 *
 * These mirror the backend `POLICIES` matrix (see
 * `apps/api/src/common/policies/permission-matrix.ts`) for the protected
 * Next.js surfaces that share the common gate helpers.
 *
 * Middleware (Edge) and server layouts (Node) MUST share this file so the
 * two layers agree on who can reach a surface. Middleware is still only a
 * prefilter — the authoritative check lives in the admin/KDS/POS server
 * layouts and goes through `GET /api/v1/auth/session`, which in turn is
 * backed by `SessionValidator` + current DB role.
 */
export type SurfacePolicyId =
  | "ADMIN_ONLY"
  | "KDS_STAFF_OR_ADMIN"
  | "POS_STAFF_OR_ADMIN";

export interface AuthorizedSessionLike {
  role: SessionRole;
  employeeRole?: EmployeeRole;
}

export const SURFACE_POLICIES: Record<
  SurfacePolicyId,
  {
    userRoles: readonly SessionRole[];
    employeeRoles?: readonly EmployeeRole[];
  }
> = {
  ADMIN_ONLY: {
    userRoles: ["ADMIN"],
  },
  KDS_STAFF_OR_ADMIN: {
    userRoles: ["ADMIN", "STAFF"],
    employeeRoles: ["KITCHEN", "MANAGER"],
  },
  POS_STAFF_OR_ADMIN: {
    userRoles: ["ADMIN", "STAFF"],
  },
};

/**
 * Return true if the session satisfies `policyId`.
 *
 * Callers must first match the policy's `userRoles`. For STAFF policies with
 * extra employee-role gates, STAFF users must also match `employeeRoles`.
 * CUSTOMER is rejected unless the policy explicitly includes CUSTOMER (none
 * of the surface policies do).
 */
export function isAuthorizedForSurface(
  session: AuthorizedSessionLike | null | undefined,
  policyId: SurfacePolicyId,
): boolean {
  if (!session) return false;
  const policy = SURFACE_POLICIES[policyId];
  if (!policy.userRoles.includes(session.role)) return false;
  if (session.role === "ADMIN") return true;
  if (policy.employeeRoles && policy.employeeRoles.length > 0) {
    if (!session.employeeRole) return false;
    if (!policy.employeeRoles.includes(session.employeeRole)) return false;
  }
  return true;
}

/**
 * Map a request pathname to the shared-middleware surface policy that
 * protects it, or null if the path isn't edge-gated.
 */
export function policyForPath(pathname: string): SurfacePolicyId | null {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return "ADMIN_ONLY";
  }
  if (pathname === "/kds" || pathname.startsWith("/kds/")) {
    return "KDS_STAFF_OR_ADMIN";
  }
  return null;
}

export function deniedRedirectForPath(pathname: string): string | null {
  void pathname;
  return null;
}

export type MiddlewareSession = Pick<WebSession, "role" | "employeeRole">;
