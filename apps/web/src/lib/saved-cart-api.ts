import { apiFetch } from "./api";
import type { ApiEnvelope } from "@wings4u/contracts";
import type { CartItem, FulfillmentType } from "./types";
import type { DriverTipPercent } from "./cart";

/**
 * Client for /api/v1/cart/{me,merge}. All helpers catch network/server
 * errors and return null so the cart UI stays responsive when the backend
 * is unavailable (e.g. before the saved_carts migration is applied). The
 * caller decides whether to fall back to in-memory state.
 */

export type SavedCartItemSnapshot = {
  key: string;
  menu_item_id: string;
  menu_item_slug: string | null;
  name: string;
  image_url: string | null;
  base_price_cents: number;
  quantity: number;
  modifier_selections: CartItem["modifier_selections"];
  removed_ingredients: NonNullable<CartItem["removed_ingredients"]>;
  special_instructions: string;
  builder_payload: Record<string, unknown> | null;
};

export type SavedCartSnapshot = {
  items: SavedCartItemSnapshot[];
  fulfillment_type: FulfillmentType;
  location_timezone: string;
  scheduled_for: string | null;
  driver_tip_percent: "none" | "10" | "15" | "20";
  expires_at: string | null;
  is_guest: boolean;
};

export type MergeResult = {
  snapshot: SavedCartSnapshot | null;
  merge_outcome: "merged" | "kept_both" | "no_guest";
};

function driverTipToString(tip: DriverTipPercent): "none" | "10" | "15" | "20" {
  return tip === "none" ? "none" : (String(tip) as "10" | "15" | "20");
}

function itemToPayload(item: CartItem): SavedCartItemSnapshot {
  return {
    key: item.key,
    menu_item_id: item.menu_item_id,
    menu_item_slug: item.menu_item_slug ?? null,
    name: item.name,
    image_url: item.image_url ?? null,
    base_price_cents: item.base_price_cents,
    quantity: item.quantity,
    modifier_selections: item.modifier_selections ?? [],
    removed_ingredients: item.removed_ingredients ?? [],
    special_instructions: item.special_instructions ?? "",
    builder_payload: (item.builder_payload as Record<string, unknown> | undefined) ?? null,
  };
}

export async function fetchSavedCart(
  locationId: string,
): Promise<SavedCartSnapshot | null> {
  try {
    const res = await apiFetch("/api/v1/cart/me", { locationId });
    if (!res.ok) return null;
    const env = (await res.json()) as ApiEnvelope<SavedCartSnapshot>;
    return env.data ?? null;
  } catch {
    return null;
  }
}

export async function putSavedCart(
  locationId: string,
  state: {
    items: CartItem[];
    fulfillmentType: FulfillmentType;
    locationTimezone: string;
    scheduledFor: string | null;
    driverTipPercent: DriverTipPercent;
  },
): Promise<SavedCartSnapshot | null> {
  try {
    const res = await apiFetch("/api/v1/cart/me", {
      locationId,
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: state.items.map(itemToPayload),
        fulfillment_type: state.fulfillmentType,
        location_timezone: state.locationTimezone,
        scheduled_for: state.scheduledFor,
        driver_tip_percent: driverTipToString(state.driverTipPercent),
      }),
    });
    if (!res.ok) return null;
    const env = (await res.json()) as ApiEnvelope<SavedCartSnapshot>;
    return env.data ?? null;
  } catch {
    return null;
  }
}

export async function deleteSavedCart(locationId: string): Promise<void> {
  try {
    await apiFetch("/api/v1/cart/me", { method: "DELETE", locationId });
  } catch {
    // best-effort
  }
}

export async function mergeSavedCartOnLogin(
  locationId: string,
): Promise<MergeResult> {
  try {
    const res = await apiFetch("/api/v1/cart/merge", {
      method: "POST",
      locationId,
    });
    if (!res.ok) return { snapshot: null, merge_outcome: "no_guest" };
    const env = (await res.json()) as ApiEnvelope<MergeResult>;
    return env.data ?? { snapshot: null, merge_outcome: "no_guest" };
  } catch {
    return { snapshot: null, merge_outcome: "no_guest" };
  }
}
