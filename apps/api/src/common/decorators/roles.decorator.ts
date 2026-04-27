import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = "roles";

export type UserRole = "CUSTOMER" | "STAFF" | "ADMIN";
export type EmployeeRole = "MANAGER" | "CASHIER" | "KITCHEN" | "DRIVER";

export interface RoleSpec {
  userRoles: UserRole[];
  employeeRoles?: EmployeeRole[];
}

/**
 * Gate a route by user role and optionally by employee role.
 *
 * Usage:
 *   @Roles("STAFF", "ADMIN")                          — any STAFF or ADMIN
 *   @Roles({ userRoles: ["STAFF"], employeeRoles: ["MANAGER"] }) — STAFF with MANAGER employee role
 */
export function Roles(
  ...args: (UserRole | RoleSpec)[]
): MethodDecorator & ClassDecorator {
  const spec: RoleSpec = { userRoles: [], employeeRoles: [] };

  for (const arg of args) {
    if (typeof arg === "string") {
      spec.userRoles.push(arg);
    } else {
      spec.userRoles.push(...arg.userRoles);
      if (arg.employeeRoles) spec.employeeRoles!.push(...arg.employeeRoles);
    }
  }

  return SetMetadata(ROLES_KEY, spec);
}

/**
 * KDS endpoints: any active STAFF user can operate the kitchen display.
 * The original PRD restricted KDS to KITCHEN/MANAGER, but the in-store
 * station model now allows any staff role (MANAGER, KITCHEN, CASHIER,
 * DRIVER) so all crew members can use the shared station. Admin-only
 * actions (PIN bypass/regenerate) still use `@Roles("ADMIN")` directly.
 *   @Roles(KDS_STAFF, "ADMIN")
 */
export const KDS_STAFF: RoleSpec = {
  userRoles: ["STAFF"],
};
