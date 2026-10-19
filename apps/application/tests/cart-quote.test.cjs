jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }));
const { apiJson } = require('../src/lib/api');
const { requestCartQuote } = require('../src/lib/cart-quote');
const { checkoutPricingBlock, paymentIntentPricingBlock } = require('../src/lib/payment-options');
const { hasAppliedPromo } = require('../src/lib/promo-selection');
const item = { menu_item_id: 'sku', quantity: 2, base_price_cents: 1000, modifier_selections: [{ modifier_option_id: 'extra', price_delta_cents: 0 }],
  removed_ingredients: [{ id: 'onion', name: 'Onion' }], special_instructions: '  Please ring  ', builder_payload: { builder_type: 'WINGS', weight_lb: 1 } };
const input = { locationId: 'selected-store', items: [item], fulfillmentType: 'PICKUP', scheduledFor: '2026-10-20T17:00:00Z',
  driverTipPercent: 10, promoCode: 'SAVE', applyWingsReward: false };
beforeEach(() => {
  apiJson.mockReset();
  apiJson.mockImplementation(async (url, init) => ({ data: { item_subtotal_cents: 2000, final_payable_cents: 2100,
    driver_tip_cents: JSON.parse(init.body).driver_tip_cents, applied_promo_code: 'SAVE, AUTO' } }));
});
test.each(['PICKUP', 'DELIVERY'].flatMap(fulfillmentType => ['none', 10, 15, 20].map(tip => [fulfillmentType, tip])))('server quote receives %s tip %s and the exact cart', async (fulfillmentType, tip) => {
  await requestCartQuote({ ...input, fulfillmentType, driverTipPercent: tip });
  expect(apiJson).toHaveBeenCalledTimes(1);
  const [url, init] = apiJson.mock.calls[0];
  expect(url).toBe('/api/v1/cart/quote'); expect(init.locationId).toBe('selected-store');
  expect(JSON.parse(init.body)).toMatchObject({ location_id: 'selected-store', fulfillment_type: fulfillmentType,
    scheduled_for: input.scheduledFor, promo_code: 'SAVE', driver_tip_cents: tip === 'none' ? 0 : 2000 * tip / 100,
    items: [{ menu_item_id: item.menu_item_id, quantity: 2, modifier_selections: [{ modifier_option_id: 'extra' }],
      removed_ingredients: item.removed_ingredients, builder_payload: item.builder_payload, special_instructions: 'Please ring' }],
  });
});
test('reconciles the percentage against the server subtotal, never tax or discounts', async () => {
  apiJson.mockImplementation(async (url, init) => ({ data: { item_subtotal_cents: 2500, discounted_subtotal_cents: 1000,
    tax_cents: 130, final_payable_cents: 1380, driver_tip_cents: JSON.parse(init.body).driver_tip_cents } }));
  await requestCartQuote(input);
  expect(apiJson.mock.calls.map(call => JSON.parse(call[1].body).driver_tip_cents)).toEqual([200, 250]);
});
test('changing menu prices cannot start an uncontrolled quote loop', async () => {
  apiJson.mockResolvedValueOnce({ data: { item_subtotal_cents: 2500, final_payable_cents: 2500 } })
    .mockResolvedValueOnce({ data: { item_subtotal_cents: 3000, final_payable_cents: 3000 } });
  await expect(requestCartQuote(input)).rejects.toThrow('Menu prices changed'); expect(apiJson).toHaveBeenCalledTimes(2);
});
test('automatic codes coexist with an explicitly confirmed coupon in checkout', () => {
  const quote = { applied_promo_code: 'AUTO, save, FIRST' };
  expect(hasAppliedPromo(quote, 'SAVE')).toBe(true); expect(hasAppliedPromo(quote, 'SAV')).toBe(false);
  expect(checkoutPricingBlock({ quote, quoteLoading: false, quoteError: null, promoCode: 'SAVE', rewardBlockedReason: null })).toBeNull();
  expect(checkoutPricingBlock({ quote, quoteLoading: false, quoteError: null, promoCode: 'BAD', rewardBlockedReason: null })).toContain('not applied');
});

test('Stripe must agree on coupon/reward, final payable and pickup/delivery tip before payment', () => {
  const quote = { final_payable_cents: 2380, driver_tip_cents: 250, applied_promo_code: 'SAVE, AUTO' };
  const selection = { promoCode: 'SAVE', applyWingsReward: false };
  expect(paymentIntentPricingBlock(2380, quote, quote, selection)).toBeNull();
  expect(paymentIntentPricingBlock(2400, quote, quote, selection)).toContain('total changed');
  expect(paymentIntentPricingBlock(2380, { ...quote, driver_tip_cents: 0 }, quote, selection)).toContain('total changed');
  expect(paymentIntentPricingBlock(2380, { ...quote, applied_promo_code: 'AUTO' }, quote, selection)).toContain('not applied');
  expect(paymentIntentPricingBlock(2380, { ...quote, wings_reward: { applied: false, not_eligible_reason: 'NOT_ENOUGH_STAMPS' } }, quote,
    { promoCode: null, applyWingsReward: true })).toContain('enough stamps');
});
