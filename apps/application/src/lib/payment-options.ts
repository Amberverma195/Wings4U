import type { CartQuoteResponse } from "./types";

/** How the customer will pay later. None of these charges a card online. */
export type CustomerCollectionPreference =
  | "PAY_AT_STORE"
  | "CASH_ON_DELIVERY"
  | "CARD_ON_DELIVERY";

export type CustomerPaymentOption = {
  value: CustomerCollectionPreference;
  title: string;
  detail: string;
};

export function customerPaymentOptions(
  fulfillmentType: "PICKUP" | "DELIVERY",
): CustomerPaymentOption[] {
  if (fulfillmentType === "DELIVERY") {
    return [
      {
        value: "CASH_ON_DELIVERY",
        title: "Cash on Delivery",
        detail: "Pay the driver in cash when your order arrives.",
      },
      {
        value: "CARD_ON_DELIVERY",
        title: "Card on Delivery",
        detail: "Pay the driver on the handheld card terminal. This is not an online payment.",
      },
    ];
  }
  return [
    {
      value: "PAY_AT_STORE",
      title: "Pay at Store",
      detail: "Pay with cash or card when you pick up your order.",
    },
  ];
}

export function defaultCollectionPreference(
  fulfillmentType: "PICKUP" | "DELIVERY",
): CustomerCollectionPreference {
  return fulfillmentType === "DELIVERY" ? "CASH_ON_DELIVERY" : "PAY_AT_STORE";
}

/**
 * Blocks checkout until the server quote matches the cart and the selected
 * promotion. Returns the customer-facing reason, or null when it is safe.
 */
export function checkoutPricingBlock(input: {
  quoteLoading: boolean;
  quote: CartQuoteResponse | null;
  quoteError: string | null;
  promoCode: string | null;
  rewardBlockedReason: string | null;
}): string | null {
  if (input.quoteLoading || !input.quote) {
    return "Wait for the order total to be confirmed before placing the order.";
  }
  if (input.quoteError) return input.quoteError;
  if (input.rewardBlockedReason) return input.rewardBlockedReason;
  const selected = input.promoCode?.trim();
  if (
    selected &&
    input.quote.applied_promo_code?.trim().toLowerCase() !== selected.toLowerCase()
  ) {
    return "The selected coupon is not applied to this total.";
  }
  return null;
}
