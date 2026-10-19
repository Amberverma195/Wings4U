import { apiJson } from './api';
import { quotePromoParams, type PromoSelection } from './promo-selection';
import { calculateCartSubtotal, calculateDeliveryTipCents } from './wing-builder-logic';
import type { CartItem, CartQuoteResponse, FulfillmentType } from './types';

export type CartQuoteInput = PromoSelection & {
  locationId: string;
  items: CartItem[];
  fulfillmentType: FulfillmentType;
  scheduledFor: string | null;
  driverTipPercent: 'none' | 10 | 15 | 20;
  deliveryQuoteToken?: string;
  deliveryAddress?: unknown;
};

export function quoteItems(items: CartItem[]) {
  return items.map(item => ({ menu_item_id: item.menu_item_id, quantity: item.quantity,
    modifier_selections: item.modifier_selections.filter(selection => selection.modifier_option_id)
      .map(selection => ({ modifier_option_id: selection.modifier_option_id })),
    removed_ingredients: item.removed_ingredients ?? [],
    special_instructions: item.special_instructions.trim() || undefined, builder_payload: item.builder_payload,
  }));
}

export function cartQuoteKey(input: CartQuoteInput, customerKey: string) {
  return JSON.stringify({ ...input, items: quoteItems(input.items), customerKey });
}

/** At most two read-only quotes: use the server item subtotal for the selected percentage. */
export async function requestCartQuote(input: CartQuoteInput, request: typeof apiJson = apiJson): Promise<CartQuoteResponse> {
  const body = { location_id: input.locationId, fulfillment_type: input.fulfillmentType,
    items: quoteItems(input.items), scheduled_for: input.scheduledFor ?? undefined,
    delivery_quote_token: input.deliveryQuoteToken, address_snapshot_json: input.deliveryAddress,
    ...quotePromoParams(input),
  };
  const fetchQuote = async (tip: number) => {
    const quote = (await request<CartQuoteResponse>('/api/v1/cart/quote', {
      method: 'POST', locationId: input.locationId, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, driver_tip_cents: tip }),
    })).data;
    if (!quote || !Number.isFinite(quote.item_subtotal_cents) || !Number.isFinite(quote.final_payable_cents) ||
      quote.final_payable_cents < 0) throw new Error('The order total could not be confirmed. Please try again.');
    return quote;
  };
  const initialTip = calculateDeliveryTipCents(calculateCartSubtotal(input.items), input.driverTipPercent);
  let quote = await fetchQuote(initialTip);
  const serverTip = calculateDeliveryTipCents(quote.item_subtotal_cents, input.driverTipPercent);
  if (serverTip !== initialTip) quote = await fetchQuote(serverTip);
  if (calculateDeliveryTipCents(quote.item_subtotal_cents, input.driverTipPercent) !== serverTip) {
    throw new Error('Menu prices changed. Please refresh your total before checkout.');
  }
  return quote;
}
