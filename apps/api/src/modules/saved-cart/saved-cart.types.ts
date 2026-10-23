/**
 * Internal types used by the saved-cart module. The snapshot shape intentionally
 * mirrors the web app's in-memory cart state (snake_case) so GET/PUT can round-trip
 * without client-side mapping.
 */

export type CartIdentity =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestToken: string };

export type ModifierSelectionSnapshot = {
  modifier_option_id: string;
  group_name: string;
  option_name: string;
  price_delta_cents: number;
};

export type RemovedIngredientSnapshot = {
  id: string;
  name: string;
};

export type CartItemSnapshot = {
  key: string;
  menu_item_id: string;
  menu_item_slug: string | null;
  name: string;
  image_url: string | null;
  base_price_cents: number;
  quantity: number;
  modifier_selections: ModifierSelectionSnapshot[];
  removed_ingredients: RemovedIngredientSnapshot[];
  special_instructions: string;
  builder_payload: Record<string, unknown> | null;
};

export type DriverTipPercentSnapshot = "none" | "10" | "15" | "20";

export type CartSnapshot = {
  items: CartItemSnapshot[];
  fulfillment_type: "PICKUP" | "DELIVERY";
  location_timezone: string;
  scheduled_for: string | null;
  driver_tip_percent: DriverTipPercentSnapshot;
  /** Effective inactivity deadline for both guest and customer carts. */
  expires_at: string | null;
  is_guest: boolean;
  /** Expired ACTIVE row exists; clients must discard recovery drafts. */
  expired?: boolean;
};

export const CUSTOMER_CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const GUEST_CART_TTL_MS = 7 * 24 * 60 * 60 * 1000;
