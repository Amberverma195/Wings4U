import { Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import {
  GUEST_CART_COOKIE,
  clearGuestTokenCookie,
  mintGuestToken,
  readGuestToken,
  setGuestTokenCookie,
} from "./guest-cart-cookie";
import { CART_STORE, type CartStore } from "./cart-store.interface";
import type {
  CartIdentity,
  CartSnapshot,
  CartItemSnapshot,
} from "./saved-cart.types";

type SaveInput = {
  items: CartItemSnapshot[];
  fulfillment_type: "PICKUP" | "DELIVERY";
  location_timezone: string;
  scheduled_for: string | null;
  driver_tip_percent: "none" | "10" | "15" | "20";
};

type SessionResponse = {
  cookies: Array<
    | { action: "set"; name: string; token: string }
    | { action: "clear"; name: string }
  >;
};

type CartResult = SessionResponse & {
  snapshot: CartSnapshot;
};

type MergeResult = SessionResponse & {
  snapshot: CartSnapshot | null;
  mergeOutcome: "merged" | "kept_both" | "no_guest";
};

const EMPTY_SNAPSHOT: Omit<CartSnapshot, "expires_at" | "is_guest"> = {
  items: [],
  fulfillment_type: "PICKUP",
  location_timezone: "America/Toronto",
  scheduled_for: null,
  driver_tip_percent: "none",
};

@Injectable()
export class SavedCartService {
  constructor(@Inject(CART_STORE) private readonly store: CartStore) {}

  /**
   * Return a snapshot for the current requester at the given location.
   * Signed-in users always use their user cart (guest cookie is ignored for
   * reads to avoid showing stale guest state to someone who logged in in a
   * different tab). Unauthenticated callers use their guest cookie; callers
   * with no cookie get the empty snapshot (no cookie minted until save).
   */
  async getForRequest(req: Request, locationId: string): Promise<CartResult> {
    const identity = this.identityFromRequest(req, { mintIfMissing: false });
    if (!identity) {
      return {
        snapshot: emptySnapshot({ isGuest: true, expiresAt: null }),
        cookies: [],
      };
    }

    const stored = await this.store.getSnapshot(identity, locationId);
    if (stored) return { snapshot: stored, cookies: [] };

    return {
      snapshot: emptySnapshot({ isGuest: identity.kind === "guest", expiresAt: null }),
      cookies: [],
    };
  }

  /**
   * Full replace of the active cart at this location. For guest callers with
   * no cookie yet, we mint one and instruct the controller to set it so the
   * next request can find this cart.
   */
  async saveForRequest(
    req: Request,
    locationId: string,
    input: SaveInput,
  ): Promise<CartResult> {
    const { identity, mintedGuestToken } = this.identityForWrite(req);
    const snapshot = await this.store.saveSnapshot(identity, locationId, {
      items: input.items,
      fulfillment_type: input.fulfillment_type,
      location_timezone: input.location_timezone,
      scheduled_for: input.scheduled_for,
      driver_tip_percent: input.driver_tip_percent,
    });
    return {
      snapshot,
      cookies: mintedGuestToken
        ? [{ action: "set", name: GUEST_CART_COOKIE, token: mintedGuestToken }]
        : [],
    };
  }

  async clearForRequest(req: Request, locationId: string): Promise<SessionResponse> {
    const identity = this.identityFromRequest(req, { mintIfMissing: false });
    if (!identity) return { cookies: [] };
    await this.store.clear(identity, locationId);
    // A guest who clears their own cart no longer needs the cookie.
    if (identity.kind === "guest") {
      return { cookies: [{ action: "clear", name: GUEST_CART_COOKIE }] };
    }
    return { cookies: [] };
  }

  async markConvertedForUser(userId: string, locationId: string): Promise<void> {
    await this.store.markConverted({ kind: "user", userId }, locationId);
  }

  /**
   * Called after a successful login (auth cookie is present). Merges any
   * active guest cart into the user's cart for the current location, per
   * the rules in MERGE_RULES. Always clears the guest cookie afterwards so
   * the signed-in session stops carrying it around.
   */
  async mergeOnLogin(req: Request, locationId: string): Promise<MergeResult> {
    if (!req.user?.userId) {
      return { snapshot: null, mergeOutcome: "no_guest", cookies: [] };
    }
    const guestToken = readGuestToken(req);
    if (!guestToken) {
      const userSnapshot = await this.store.getSnapshot(
        { kind: "user", userId: req.user.userId },
        locationId,
      );
      return {
        snapshot: userSnapshot,
        mergeOutcome: "no_guest",
        cookies: [],
      };
    }

    const result = await this.store.mergeGuestIntoUser(
      guestToken,
      req.user.userId,
      locationId,
    );
    return {
      snapshot: result.snapshot,
      mergeOutcome: result.mergeOutcome,
      cookies: [{ action: "clear", name: GUEST_CART_COOKIE }],
    };
  }

  private identityFromRequest(
    req: Request,
    opts: { mintIfMissing: boolean },
  ): CartIdentity | null {
    if (req.user?.userId) {
      return { kind: "user", userId: req.user.userId };
    }
    const existing = readGuestToken(req);
    if (existing) return { kind: "guest", guestToken: existing };
    if (!opts.mintIfMissing) return null;
    return { kind: "guest", guestToken: mintGuestToken() };
  }

  private identityForWrite(req: Request): {
    identity: CartIdentity;
    mintedGuestToken: string | null;
  } {
    if (req.user?.userId) {
      return { identity: { kind: "user", userId: req.user.userId }, mintedGuestToken: null };
    }
    const existing = readGuestToken(req);
    if (existing) {
      return {
        identity: { kind: "guest", guestToken: existing },
        mintedGuestToken: null,
      };
    }
    const token = mintGuestToken();
    return {
      identity: { kind: "guest", guestToken: token },
      mintedGuestToken: token,
    };
  }
}

function emptySnapshot(opts: { isGuest: boolean; expiresAt: string | null }): CartSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    items: [],
    expires_at: opts.expiresAt,
    is_guest: opts.isGuest,
  };
}

export const SESSION_COOKIE_HELPERS = {
  setGuestTokenCookie,
  clearGuestTokenCookie,
};
