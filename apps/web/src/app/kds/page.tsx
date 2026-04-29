import { KdsClient } from "./kds-client";

/**
 * KDS (Kitchen Display System) surface - thin server entry.
 *
 * `/kds` is an in-store station route:
 *   - off-network visitors hit 404 (handled by the layout network gate),
 *   - on-network visitors see the station password screen,
 *   - valid KDS station cookies unlock the board.
 */
export default function KdsPage() {
  return <KdsClient />;
}
