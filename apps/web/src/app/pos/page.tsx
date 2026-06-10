import { PosClient } from "./pos-client";

/**
 * POS (Point of Sale) surface - thin server entry.
 *
 * `/pos` is a store-network-gated station route:
 *   - off-IP traffic hits 404 before the client renders,
 *   - signed-out users on the store network reach the station password gate,
 *   - unlocking mints a POS station session independent of main-site login.
 */
export default function PosPage() {
  return <PosClient />;
}
