import type { ReactNode } from "react";
import { requireSurfaceAccess } from "@/lib/server-surface-gate";
import "./kds.css";

/**
 * Server-side authorization gate for the KDS surface.
 *
 * Allow: ADMIN, STAFF with `employeeRole in { KITCHEN, MANAGER }`.
 * Everyone else:
 *   - signed-out -> redirect to `/auth/login`
 *   - authenticated wrong-role -> `forbidden()` (shared `app/forbidden.tsx`,
 *     real HTTP 403)
 *
 * The server-side gate is mandatory here (not merely a nicety) because
 * `kds-client.tsx` starts fetching orders and opening the realtime socket
 * on mount. A client-only deny gate still renders the shell first and
 * kicks off those calls; a server gate ensures nothing client-side runs
 * for denied users.
 */
export default async function KdsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireSurfaceAccess("KDS_STAFF_OR_ADMIN");
  return children;
}
