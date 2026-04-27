import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { resolveSession } from "@/lib/auth-session";
import { requireKdsNetworkAccess } from "@/lib/server-kds-gate";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import "./kds.css";

/**
 * Server-side gate for the KDS surface — in-store station model.
 *
 * 1. Network gate first: the device must be on the store's trusted IP
 *    range. If not → 404 (page doesn't exist for off-site visitors).
 *
 * 2. The client handles session state after the network gate: ADMIN/STAFF
 *    sessions open the board, signed-out visitors see the KDS PIN unlock
 *    screen, and CUSTOMER sessions are denied.
 */
export default async function KdsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireKdsNetworkAccess(DEFAULT_LOCATION_ID);

  const cookieStore = await cookies();
  const session = await resolveSession(cookieStore.get("access_token")?.value);
  if (session?.role === "CUSTOMER") {
    notFound();
  }

  return children;
}
