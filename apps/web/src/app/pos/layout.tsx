import type { ReactNode } from "react";
import { requirePosNetworkAccess } from "@/lib/server-pos-gate";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import "./pos.css";

/**
 * `/pos` is now a station-gated surface (like KDS):
 *   - off the configured store IP, the page returns 404 to *everyone*
 *     (signed-out, customer, staff, and admin alike), so the URL doesn't
 *     even hint at its existence outside the store.
 *   - on the allowed network, the client renders an 8-digit station
 *     password gate that is independent of any main-site account login.
 *
 * Authentication is handled inside `pos-client.tsx` via the
 * `/api/v1/pos/auth/*` endpoints and the `w4u_pos_session` cookie.
 */
export default async function PosLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requirePosNetworkAccess(DEFAULT_LOCATION_ID);
  return <>{children}</>;
}
