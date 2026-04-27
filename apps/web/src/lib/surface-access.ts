import {
  isAuthorizedForSurface,
  type AuthorizedSessionLike,
  type SurfacePolicyId,
} from "./surface-policy";

const SESSION_ROLES = ["CUSTOMER", "STAFF", "ADMIN"] as const;
const EMPLOYEE_ROLES = ["MANAGER", "CASHIER", "KITCHEN", "DRIVER"] as const;

type SurfaceSessionRole = AuthorizedSessionLike["role"];
type SurfaceEmployeeRole = NonNullable<AuthorizedSessionLike["employeeRole"]>;

export type SurfaceAccessUser = {
  role?: string | null;
  employeeRole?: string | null;
};

function isSurfaceSessionRole(role: string): role is SurfaceSessionRole {
  return (SESSION_ROLES as readonly string[]).includes(role);
}

function isSurfaceEmployeeRole(
  employeeRole: string,
): employeeRole is SurfaceEmployeeRole {
  return (EMPLOYEE_ROLES as readonly string[]).includes(employeeRole);
}

export function toAuthorizedSurfaceSession(
  user: SurfaceAccessUser | null | undefined,
): AuthorizedSessionLike | null {
  if (!user?.role || !isSurfaceSessionRole(user.role)) {
    return null;
  }

  const session: AuthorizedSessionLike = {
    role: user.role,
  };

  if (user.employeeRole && isSurfaceEmployeeRole(user.employeeRole)) {
    session.employeeRole = user.employeeRole;
  }

  return session;
}

export function canAccessSurface(
  user: SurfaceAccessUser | null | undefined,
  policyId: SurfacePolicyId,
): boolean {
  return isAuthorizedForSurface(toAuthorizedSurfaceSession(user), policyId);
}
