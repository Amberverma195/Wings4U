import type { ReactNode } from "react";
import { requireSurfaceAccess } from "@/lib/server-surface-gate";
import { requirePosNetworkAccess } from "@/lib/server-pos-gate";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import "./pos.css";

export default async function PosLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireSurfaceAccess("POS_STAFF_OR_ADMIN", {
    notFoundOnUnauthenticated: true,
    notFoundOnForbidden: true,
  });
  await requirePosNetworkAccess(DEFAULT_LOCATION_ID);
  return <>{children}</>;
}
