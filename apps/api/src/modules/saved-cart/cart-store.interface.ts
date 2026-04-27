import type { CartIdentity, CartSnapshot } from "./saved-cart.types";

/**
 * Storage abstraction for saved carts. DbCartStore is the current source of
 * truth; a future CachedCartStore can wrap this to add Redis reads/writes
 * without changing service or controller logic. Redis should never bypass
 * this interface — it caches *snapshots* of what the DB already holds.
 */
export interface CartStore {
  /** Return the active cart snapshot for this identity+location, or null. */
  getSnapshot(
    identity: CartIdentity,
    locationId: string,
  ): Promise<CartSnapshot | null>;

  /**
   * Replace the entire active cart for identity+location with the given
   * snapshot. Creates the cart row if it does not yet exist. Always a full
   * replace — callers compute merges themselves.
   */
  saveSnapshot(
    identity: CartIdentity,
    locationId: string,
    snapshot: Omit<CartSnapshot, "expires_at" | "is_guest">,
  ): Promise<CartSnapshot>;

  /** Delete the active cart for identity+location, if any. */
  clear(identity: CartIdentity, locationId: string): Promise<void>;

  /**
   * Mark the active cart as CONVERTED (called after successful checkout).
   * A CONVERTED cart is retained for history but is no longer returned by
   * getSnapshot. The @@unique on (identity, locationId, status) still allows
   * a new ACTIVE cart to be created afterwards.
   */
  markConverted(identity: CartIdentity, locationId: string): Promise<void>;

  /**
   * Merge the guest's active cart (if any) into the user's active cart for
   * the given location. Returns the resulting user cart snapshot. Caller
   * decides what to do with the guest cart based on the return value.
   *
   * Returned `mergeOutcome`:
   *   - "merged":     same location; items combined, guest cart deleted
   *   - "kept_both":  different location or no overlap; guest cart left intact
   *   - "no_guest":   no active guest cart existed
   */
  mergeGuestIntoUser(
    guestToken: string,
    userId: string,
    locationId: string,
  ): Promise<{
    snapshot: CartSnapshot | null;
    mergeOutcome: "merged" | "kept_both" | "no_guest";
  }>;
}

export const CART_STORE = Symbol("CartStore");
