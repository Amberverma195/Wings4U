import { PosClient } from "./pos-client";

/**
 * POS (Point of Sale) surface - thin server entry.
 *
 * `/pos` is a protected staff-only station route:
 *   - signed-out visitors, customers, admins, and off-IP traffic hit 404,
 *   - only on-store STAFF users reach the POS client,
 *   - once there, staff still need the 5-digit employee PIN to unlock a
 *     POS session.
 */
export default function PosPage() {
  return <PosClient />;
}
