import { RoleSpec } from "../decorators/roles.decorator";

/**
 * Backend policy matrix wrapping `@Roles` requirements into 
 * standard policies to align with PRD §26.4
 */

// Admins only (Super user)
export const POLICIES = {
  // Admin only
  ADMIN_ONLY: { userRoles: ["ADMIN"] } as RoleSpec,

  // KDS Staff (Kitchen + Manager) and Admin
  KDS_STAFF_OR_ADMIN: {
    userRoles: ["ADMIN", "STAFF"],
    employeeRoles: ["MANAGER", "KITCHEN"],
  } as RoleSpec,

  // Cashier, Manager, Admin
  POS_STAFF_OR_ADMIN: {
    userRoles: ["ADMIN", "STAFF"],
    employeeRoles: ["MANAGER", "CASHIER"],
  } as RoleSpec,

  // Any staff member (including Driver/Kitchen)
  ANY_STAFF: {
    userRoles: ["ADMIN", "STAFF"],
  } as RoleSpec,

  // Customer only
  CUSTOMER_ONLY: {
    userRoles: ["CUSTOMER"],
  } as RoleSpec,

  // Anyone logged in
  AUTHENTICATED: {
    userRoles: ["CUSTOMER", "STAFF", "ADMIN"],
  } as RoleSpec,
} as const;
