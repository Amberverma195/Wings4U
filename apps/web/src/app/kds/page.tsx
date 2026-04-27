import { KdsClient } from "./kds-client";

/**
 * KDS (Kitchen Display System) surface — thin server entry.
 *
 * `/kds` is an in-store station route:
 *   - off-network visitors hit 404 (handled by the layout network gate),
 *   - on-network ADMIN/STAFF with a live session see the KDS board directly,
 *   - on-network visitors without a session see a KDS PIN unlock screen,
 *   - CUSTOMER sessions see the PIN screen (no KDS data access).
 */
export default function KdsPage() {
  return <KdsClient />;
}
