import type { MenuResponse } from "./types";
import { buildScheduleTimeOptions, normalizeSchedulingConfig } from "./order-scheduling";

/** Must match apps/api `no-show-policy.ts` so quote/checkout errors match UI copy. */
export const DELIVERY_BLOCKED_NO_SHOWS_MESSAGE =
  "Delivery is unavailable due to your recent order history. Pickup is still available.";

export const DELIVERY_UNAVAILABLE_MESSAGE =
  "Delivery is currently unavailable. Pickup is still available.";
export const DELIVERY_DISABLED_MESSAGE =
  "Delivery has been disabled by the restaurant. Pickup is still available.";
export const DELIVERY_CLOSED_NOW_MESSAGE =
  "Delivery is closed right now. Choose an available scheduled delivery time.";

export function isDeliveryBlockedDueToNoShows(menu: MenuResponse | null): boolean {
  return menu?.location.delivery_blocked_due_to_no_shows === true;
}

/** Only these restrictions disable the method selector. Closure must allow discovery of future slots. */
export function getDeliveryRestrictionMessage(menu: MenuResponse | null): string | null {
  if (isDeliveryBlockedDueToNoShows(menu)) return DELIVERY_BLOCKED_NO_SHOWS_MESSAGE;
  if (menu?.location.delivery_disabled) return DELIVERY_DISABLED_MESSAGE;
  return null;
}

export function getDeliveryScheduleMessage(menu: MenuResponse | null, dateKey: string, timeValue: string, now = new Date()): string | null {
  const restriction = getDeliveryRestrictionMessage(menu);
  if (restriction) return restriction;
  if (!menu) return "Delivery availability could not be verified. Please try again.";
  const location = menu.location;
  const options = buildScheduleTimeOptions({ fulfillmentType: "DELIVERY", selectedDateKey: dateKey,
    config: normalizeSchedulingConfig({ delivery: { minMinutes: location.delivery_min_minutes, maxMinutes: location.delivery_max_minutes } }),
    pickupLeadMinutes: location.estimated_prep_minutes, timezone: location.timezone, now,
    hours: { pickup: location.pickup_hours, delivery: location.delivery_hours, store: location.store_hours ?? [],
      deliveryAvailableFromMinutes: location.delivery_available_from_minutes,
      deliveryAvailableUntilMinutes: location.delivery_available_until_minutes } });
  if (options.some(option => option.value === timeValue)) return null;
  return timeValue === "ASAP" ? DELIVERY_CLOSED_NOW_MESSAGE :
    "That delivery time is unavailable or too soon. Choose an available delivery time.";
}

export function getDeliveryUnavailableMessage(menu: MenuResponse | null): string | null {
  const restriction = getDeliveryRestrictionMessage(menu);
  if (restriction) return restriction;
  if (menu?.location.delivery_currently_available === false) {
    return menu.location.delivery_unavailable_reason || DELIVERY_UNAVAILABLE_MESSAGE;
  }
  return null;
}

/**
 * Prefix of cart quote / checkout validation errors when item subtotal is below the
 * location minimum for delivery (see `cart.service.ts` / `checkout.service.ts`).
 */
export const MINIMUM_DELIVERY_SUBTOTAL_ERROR_PREFIX = "Minimum subtotal for delivery";

export function isMinimumDeliverySubtotalError(message: string | null | undefined): boolean {
  return Boolean(message?.includes(MINIMUM_DELIVERY_SUBTOTAL_ERROR_PREFIX));
}
