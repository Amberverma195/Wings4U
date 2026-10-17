jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }));
const { apiJson } = require('../src/lib/api');
const { validateCheckout } = require('../src/lib/checkout-preparation');
const now = Date.parse('2026-10-17T16:00:00Z');
const hours = Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, time_from: '11:00', time_to: '23:00', is_closed: false }));
let menu, quote, delivery, snapshot;
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(now); jest.clearAllMocks();
  menu = { location: { timezone: 'America/Toronto', is_open: true, pickup_hours: hours, delivery_hours: hours, store_hours: hours,
    pickup_min_minutes: 15, delivery_min_minutes: 40, estimated_prep_minutes: 15 },
    categories: [{ items: [{ id: 'synthetic', is_available: true, stock_status: 'NORMAL', allowed_fulfillment_type: 'BOTH',
      weight_options: [{ menu_item_id: 'real-wings-sku' }] }] }] };
  quote = { final_payable_cents: 1130, lines: [{ menu_item_id: 'real-wings-sku', quantity: 1 }] };
  delivery = { delivery_quote_token: 'delivery-token', expires_at: new Date(now + 10 * 60_000).toISOString() };
  snapshot = { locationId: 'store', items: [{ menu_item_id: 'real-wings-sku', name: 'Wings', quantity: 1, base_price_cents: 1000,
    modifier_selections: [], special_instructions: '', builder_payload: { builder_type: 'WINGS', weight_lb: 1 } }],
    setup: { fulfillmentType: 'PICKUP', scheduledFor: null, deliveryAddress: null }, driverTipPercent: 'none', promoCode: null,
    applyWingsReward: false, customerId: null };
  apiJson.mockImplementation(async url => ({ data: url.startsWith('/api/v1/menu?') ? menu : url === '/api/v1/delivery/quote' ? delivery : quote }));
});
afterEach(() => jest.useRealTimers());

test('pickup validates the live menu and exact real SKU before obtaining a fresh server total', async () => {
  expect(await validateCheckout(snapshot)).toBe(quote);
  expect(apiJson.mock.calls.map(call => call[0])).toEqual([expect.stringContaining('fulfillment_type=PICKUP'), '/api/v1/cart/quote']);
  expect(JSON.parse(apiJson.mock.calls[1][1].body)).toMatchObject({ items: [{ menu_item_id: 'real-wings-sku', quantity: 1, builder_payload: snapshot.items[0].builder_payload }] });
  expect(apiJson.mock.calls.some(call => /checkout|payments/.test(call[0]))).toBe(false);
});

test('delivery validates address/eligibility and passes its fresh delivery token into server pricing', async () => {
  snapshot.setup = { fulfillmentType: 'DELIVERY', scheduledFor: '2026-10-18T17:00:00.000Z',
    deliveryAddress: { line1: '12 Main St', city: 'London', postal_code: 'N5Y 4J7' } };
  snapshot.driverTipPercent = 15;
  snapshot.promoCode = 'WINGS5'; quote.applied_promo_code = 'WINGS5';
  await validateCheckout(snapshot);
  const calls = apiJson.mock.calls;
  expect(calls.map(call => call[0])).toEqual([expect.stringContaining('scheduled_for='), '/api/v1/delivery/quote', '/api/v1/cart/quote']);
  expect(JSON.parse(calls[2][1].body)).toMatchObject({ delivery_quote_token: 'delivery-token', address_snapshot_json: snapshot.setup.deliveryAddress,
    scheduled_for: snapshot.setup.scheduledFor, promo_code: 'WINGS5', driver_tip_cents: 150 });
});

test.each(['closed', 'past', 'no-slots', 'missing-item', 'unavailable', 'incompatible'])('blocks invalid order context or items: %s', async reason => {
  if (reason === 'closed') menu.location.is_open = false;
  if (reason === 'past') snapshot.setup.scheduledFor = new Date(now - 60_000).toISOString();
  if (reason === 'no-slots') { menu.location.pickup_hours = []; menu.location.store_hours = []; }
  if (reason === 'missing-item') menu.categories = [];
  if (reason === 'unavailable') menu.categories[0].items[0].stock_status = 'UNAVAILABLE';
  if (reason === 'incompatible') menu.categories[0].items[0].allowed_fulfillment_type = 'DELIVERY';
  await expect(validateCheckout(snapshot)).rejects.toThrow(/unavailable/);
  expect(apiJson.mock.calls).toHaveLength(1);
});

test('a closed restaurant still permits an available future scheduled slot', async () => {
  menu.location.is_open = false;
  snapshot.setup.scheduledFor = '2026-10-18T17:00:00.000Z';
  await expect(validateCheckout(snapshot)).resolves.toBe(quote);
});

test('delivery with an incomplete address is blocked before requests', async () => {
  snapshot.setup.fulfillmentType = 'DELIVERY';
  await expect(validateCheckout(snapshot)).rejects.toThrow('valid delivery address');
  expect(apiJson).not.toHaveBeenCalled();
});

test('a server inventory rejection blocks checkout and preserves its useful error', async () => {
  apiJson.mockImplementation(async url => { if (url === '/api/v1/cart/quote') throw new Error('Wings are out of stock.'); return { data: menu }; });
  await expect(validateCheckout(snapshot)).rejects.toThrow('Wings are out of stock.');
});

test.each(['network', 'missing-total', 'missing-line', 'coupon', 'reward'])('pricing/API failures cannot pass validation: %s', async reason => {
  if (reason === 'network') apiJson.mockRejectedValue(new Error('Network unavailable'));
  if (reason === 'missing-total') quote.final_payable_cents = undefined;
  if (reason === 'missing-line') quote.lines = [];
  if (reason === 'coupon') snapshot.promoCode = 'NOT-APPLIED';
  if (reason === 'reward') { snapshot.applyWingsReward = true; quote.wings_reward = { applied: false, not_eligible_reason: 'NOT_ENOUGH_STAMPS' }; }
  await expect(validateCheckout(snapshot)).rejects.toThrow();
});

test('delivery service errors and expired delivery tokens prevent pricing or navigation', async () => {
  snapshot.setup.fulfillmentType = 'DELIVERY';
  snapshot.setup.deliveryAddress = { line1: '12 Main St', city: 'London', postal_code: 'N5Y 4J7' };
  delivery.expires_at = new Date(now - 1).toISOString();
  await expect(validateCheckout(snapshot)).rejects.toThrow('Delivery eligibility');
  expect(apiJson.mock.calls).toHaveLength(2);
});
