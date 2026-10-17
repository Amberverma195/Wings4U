import { apiJson } from './api';
import { orderTimeAvailable, validDeliveryAddress, type OrderSetupSelection } from './order-setup';
import { checkoutPricingBlock } from './payment-options';
import { quotePromoParams, wingsRewardBlockedReason } from './promo-selection';
import type { CartItem, CartQuoteResponse, MenuResponse } from './types';

export type CheckoutSnapshot = {
  locationId: string;
  items: CartItem[];
  setup: OrderSetupSelection;
  driverTipPercent: 'none' | 10 | 15 | 20;
  promoCode: string | null;
  applyWingsReward: boolean;
  customerId: string | null;
};

export function checkoutFingerprint(snapshot: CheckoutSnapshot) {
  return JSON.stringify(snapshot);
}

/** Read-only ordering APIs only. This never places an order or starts payment. */
export async function validateCheckout(snapshot: CheckoutSnapshot): Promise<CartQuoteResponse> {
  const { setup, locationId, items } = snapshot;
  if (!items.length) throw new Error('Your cart is empty. Add an item before checkout.');
  if (setup.fulfillmentType === 'DELIVERY' && !validDeliveryAddress(setup.deliveryAddress)) {
    throw new Error('Enter a valid delivery address before checkout.');
  }
  const query = new URLSearchParams({ location_id: locationId, fulfillment_type: setup.fulfillmentType });
  if (setup.scheduledFor) query.set('scheduled_for', setup.scheduledFor);
  const menu = (await apiJson<MenuResponse>(`/api/v1/menu?${query}`, { locationId })).data;
  if (!menu?.location || !Array.isArray(menu.categories)) throw new Error('Ordering details could not be loaded. Please try again.');
  const validTime = orderTimeAvailable(menu.location, setup.fulfillmentType, setup.scheduledFor);
  if (!validTime) throw new Error('Your selected order time is unavailable. Change your order details to choose an available time.');

  const menuItems = menu.categories.flatMap(category => category.items);
  for (const line of items) {
    const item = menuItems.find(item => item.id === line.menu_item_id ||
      [...(item.weight_options ?? []), ...(item.combo_options ?? [])].some(option => option.menu_item_id === line.menu_item_id));
    if (!item || !item.is_available || item.stock_status === 'UNAVAILABLE' ||
      (item.allowed_fulfillment_type !== 'BOTH' && item.allowed_fulfillment_type !== setup.fulfillmentType)) {
      throw new Error(`${line.name} is unavailable for this order type or time. Change your order details or remove it from your cart.`);
    }
  }

  let deliveryToken: string | undefined;
  if (setup.fulfillmentType === 'DELIVERY') {
    const delivery = (await apiJson<{ delivery_quote_token: string; expires_at: string }>('/api/v1/delivery/quote', {
      method: 'POST', locationId, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: locationId, address_snapshot_json: setup.deliveryAddress, scheduled_for: setup.scheduledFor ?? undefined }),
    })).data;
    if (!delivery?.delivery_quote_token || !Number.isFinite(Date.parse(delivery.expires_at)) || Date.parse(delivery.expires_at) <= Date.now()) {
      throw new Error('Delivery eligibility could not be confirmed. Please check your address and try again.');
    }
    deliveryToken = delivery.delivery_quote_token;
  }
  const subtotal = items.reduce((sum, item) => sum + item.quantity * (item.base_price_cents +
    item.modifier_selections.reduce((total, modifier) => total + modifier.price_delta_cents, 0)), 0);
  const quote = (await apiJson<CartQuoteResponse>('/api/v1/cart/quote', {
    method: 'POST', locationId, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location_id: locationId, fulfillment_type: setup.fulfillmentType,
      scheduled_for: setup.scheduledFor ?? undefined,
      items: items.map(item => ({ menu_item_id: item.menu_item_id, quantity: item.quantity,
        modifier_selections: item.modifier_selections.filter(selection => selection.modifier_option_id)
          .map(selection => ({ modifier_option_id: selection.modifier_option_id })),
        removed_ingredients: item.removed_ingredients ?? [], special_instructions: item.special_instructions.trim() || undefined,
        builder_payload: item.builder_payload })),
      driver_tip_cents: setup.fulfillmentType === 'DELIVERY' && snapshot.driverTipPercent !== 'none' ? Math.round(subtotal * snapshot.driverTipPercent / 100) : 0,
      delivery_quote_token: deliveryToken, address_snapshot_json: setup.fulfillmentType === 'DELIVERY' ? setup.deliveryAddress : undefined,
      ...quotePromoParams(snapshot),
    }),
  })).data;
  if (!quote || !Number.isFinite(quote.final_payable_cents) || quote.final_payable_cents < 0 || !Array.isArray(quote.lines)) {
    throw new Error('The order total could not be confirmed. Please try again.');
  }
  const quantities = (lines: { menu_item_id: string; quantity: number }[]) => {
    const totals = new Map<string, number>();
    for (const line of lines) totals.set(line.menu_item_id, (totals.get(line.menu_item_id) ?? 0) + line.quantity);
    return totals;
  };
  const requested = quantities(items), priced = quantities(quote.lines);
  if (requested.size !== priced.size || [...requested].some(([id, quantity]) => priced.get(id) !== quantity)) {
    throw new Error('Some cart items could not be priced. Review your cart and try again.');
  }
  const block = checkoutPricingBlock({ quoteLoading: false, quote, quoteError: null, promoCode: snapshot.promoCode,
    rewardBlockedReason: wingsRewardBlockedReason(snapshot.applyWingsReward, quote) });
  if (block) throw new Error(block);
  if (!orderTimeAvailable(menu.location, setup.fulfillmentType, setup.scheduledFor)) {
    throw new Error('Your selected order time has expired. Please choose an available time.');
  }
  return quote;
}
