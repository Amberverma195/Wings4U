import type { ReactNode } from "react";
import { AdminShell } from "./admin-shell";
import { requireSurfaceAccess } from "@/lib/server-surface-gate";
import "./admin.css";

/**
 * Authoritative, API-backed admin page gate. Delegates to the shared
 * {@link requireSurfaceAccess} helper so `/admin` and `/kds`
 * all go through the exact same check (API-backed session fetch, DB-role
 * authoritative, `forbidden()` for policy mismatch).
 *
 * See the surface-gate helper for the full reasoning — in short, middleware
 * is only a prefilter and cannot see revocation or role demotion.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireSurfaceAccess("ADMIN_ONLY", {
    notFoundOnUnauthenticated: true,
    notFoundOnForbidden: true,
  });
  return <AdminShell>{children}</AdminShell>;
}
