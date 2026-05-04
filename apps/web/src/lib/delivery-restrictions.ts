import type { MenuResponse } from "./types";

/** Must match apps/api `no-show-policy.ts` so quote/checkout errors match UI copy. */
export const DELIVERY_BLOCKED_NO_SHOWS_MESSAGE =
  "Delivery is unavailable due to your recent order history. Pickup is still available.";

export const DELIVERY_UNAVAILABLE_MESSAGE =
  "Delivery is currently unavailable. Pickup is still available.";

export function isDeliveryBlockedDueToNoShows(menu: MenuResponse | null): boolean {
  return menu?.location.delivery_blocked_due_to_no_shows === true;
}

export function getDeliveryUnavailableMessage(menu: MenuResponse | null): string | null {
  if (isDeliveryBlockedDueToNoShows(menu)) return DELIVERY_BLOCKED_NO_SHOWS_MESSAGE;
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
