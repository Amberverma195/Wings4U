const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, input, pricing, renderer;
jest.mock('../src/context/session', () => ({ useSession: () => mockSession }));
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }));
const { apiJson } = require('../src/lib/api');
const { useCartPricing } = require('../src/hooks/use-cart-pricing');
const clearPromo = jest.fn();
const quote = request => ({ item_subtotal_cents: 1000, tax_cents: 83, driver_tip_cents: request.driver_tip_cents,
  final_payable_cents: 1083 + request.driver_tip_cents, lines: [{ menu_item_id: 'wings', quantity: 1, line_total_cents: 1000 }] });
function Probe() { pricing = useCartPricing(input, true, clearPromo); return null; }
const render = async () => act(async () => renderer.update(React.createElement(Probe)));
const tick = async () => act(async () => jest.advanceTimersByTime(250));
beforeEach(async () => {
  jest.useFakeTimers(); jest.clearAllMocks();
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer-a' }, refresh: jest.fn(async () => true) };
  input = { locationId: 'store', fulfillmentType: 'PICKUP', scheduledFor: null, driverTipPercent: 'none', promoCode: null, applyWingsReward: false,
    items: [{ key: 'wings', menu_item_id: 'wings', name: 'Wings', quantity: 1, base_price_cents: 1000, modifier_selections: [], special_instructions: '' }] };
  apiJson.mockImplementation(async (_url, init) => ({ data: quote(JSON.parse(init.body)) }));
  await act(async () => { renderer = create(React.createElement(Probe)); });
});
afterEach(async () => { await act(async () => renderer.unmount()); jest.useRealTimers(); });

test('initial loading has no current or display quote; successful pricing supplies both', async () => {
  expect(pricing.loading).toBe(true); expect(pricing.quote).toBeNull(); expect(pricing.displayQuote).toBeNull();
  await tick(); expect(pricing.quote.tax_cents).toBe(83); expect(pricing.displayQuote).toBe(pricing.quote);
  expect(pricing.loading).toBe(false); expect(pricing.displayOnly).toBe(false);
});
test.each([['none', 10], [10, 15], [15, 20], [20, 'none']])('tip %s -> %s keeps a display-only breakdown until a matching replacement succeeds', async (before, after) => {
  input = { ...input, driverTipPercent: before }; await render(); await tick();
  const previous = pricing.quote; let release;
  apiJson.mockImplementation((_url, init) => new Promise(resolve => { release = () => resolve({ data: { ...quote(JSON.parse(init.body)), tax_cents: 91 } }); }));
  input = { ...input, driverTipPercent: after }; await render();
  expect(pricing.quote).toBeNull(); expect(pricing.displayQuote).toBe(previous); expect(pricing.displayOnly).toBe(true);
  await tick(); expect(pricing.displayQuote).toBe(previous);
  await act(async () => release()); expect(pricing.displayOnly).toBe(false); expect(pricing.quote.tax_cents).toBe(91);
  expect(pricing.quote.driver_tip_cents).toBe(after === 'none' ? 0 : after * 10);
  expect(pricing.displayQuote).toBe(pricing.quote);
});
test.each(['quantity', 'modifier', 'builder', 'ingredients', 'instructions', 'fulfillment', 'location', 'schedule', 'coupon', 'reward', 'customer', 'address'])(
  '%s changes immediately discard the old display quote', async change => {
    await tick(); const item = input.items[0];
    if (change === 'quantity') input = { ...input, items: [{ ...item, quantity: 2 }] };
    if (change === 'modifier') input = { ...input, items: [{ ...item, modifier_selections: [{ modifier_option_id: 'cheese' }] }] };
    if (change === 'builder') input = { ...input, items: [{ ...item, builder_payload: { builder_type: 'WINGS', weight_lb: 2 } }] };
    if (change === 'ingredients') input = { ...input, items: [{ ...item, removed_ingredients: [{ id: 'onion', name: 'Onion' }] }] };
    if (change === 'instructions') input = { ...input, items: [{ ...item, special_instructions: 'Ring bell' }] };
    if (change === 'fulfillment') input = { ...input, fulfillmentType: 'DELIVERY' };
    if (change === 'location') input = { ...input, locationId: 'store-b' };
    if (change === 'schedule') input = { ...input, scheduledFor: '2026-10-20T17:00:00Z' };
    if (change === 'coupon') input = { ...input, promoCode: 'SAVE' };
    if (change === 'reward') input = { ...input, applyWingsReward: true };
    if (change === 'customer') mockSession = { ...mockSession, user: { id: 'customer-b' } };
    if (change === 'address') input = { ...input, deliveryAddress: { line1: '99 New St' } };
    await render(); expect(pricing.quote).toBeNull(); expect(pricing.displayQuote).toBeNull(); expect(pricing.displayOnly).toBe(false);
  });
test('rapid tips preserve the debounce and obsolete responses cannot overwrite the latest amounts', async () => {
  await tick(); const releases = new Map();
  apiJson.mockImplementation((_url, init) => { const request = JSON.parse(init.body); return new Promise(resolve => releases.set(request.driver_tip_cents, () => resolve({ data: quote(request) }))); });
  input = { ...input, driverTipPercent: 10 }; await render(); await tick();
  input = { ...input, driverTipPercent: 15 }; await render();
  input = { ...input, driverTipPercent: 20 }; await render(); await tick();
  expect(releases.has(150)).toBe(false);
  await act(async () => releases.get(200)()); expect(pricing.quote.final_payable_cents).toBe(1283);
  await act(async () => releases.get(100)()); expect(pricing.quote.final_payable_cents).toBe(1283);
  expect(apiJson).toHaveBeenCalledTimes(3);
});
test('a failed tip refresh clears old prices and remains retryable without silently confirming them', async () => {
  await tick(); apiJson.mockRejectedValueOnce(new Error('Network unavailable'));
  input = { ...input, driverTipPercent: 10 }; await render(); await tick();
  expect(pricing.quote).toBeNull(); expect(pricing.displayQuote).toBeNull(); expect(pricing.error).toBe('Network unavailable');
  expect(pricing.recovery).toBe('retry');
  await act(async () => pricing.refresh()); await tick(); expect(pricing.quote.driver_tip_cents).toBe(100);
});
test('authenticated background pricing still refreshes the session once after a 401', async () => {
  apiJson.mockRejectedValueOnce(Object.assign(new Error('Expired token'), { status: 401 }));
  await tick(); expect(mockSession.refresh).toHaveBeenCalledTimes(1); expect(apiJson).toHaveBeenCalledTimes(2);
  expect(pricing.quote.final_payable_cents).toBe(1083);
});
test('an obsolete response cannot trigger a second subtotal reconciliation request', async () => {
  await tick(); let release;
  apiJson.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  input = { ...input, driverTipPercent: 10 }; await render(); await tick();
  input = { ...input, locationId: 'new-store' }; await render();
  await act(async () => release({ data: { item_subtotal_cents: 2500, final_payable_cents: 2500 } }));
  expect(apiJson).toHaveBeenCalledTimes(2); expect(pricing.quote).toBeNull(); expect(pricing.displayQuote).toBeNull();
  await tick(); expect(pricing.quote).not.toBeNull();
});

test('coupon validation requests fresh pricing and cannot return a retained display quote', async () => {
  await tick(); const previous = pricing.quote;
  input = { ...input, driverTipPercent: 10 }; await render();
  apiJson.mockRejectedValueOnce(new Error('Invalid or expired promo code'));
  await act(async () => {
    await expect(pricing.requestSelection({ promoCode: 'SAVE', applyWingsReward: false })).rejects.toThrow('Invalid or expired promo code');
  });
  expect(pricing.quote).toBeNull(); expect(pricing.displayQuote).toBe(previous);
  expect(JSON.parse(apiJson.mock.calls.at(-1)[1].body)).toMatchObject({ promo_code: 'SAVE', driver_tip_cents: 100 });
});

test('returning to a previous tip still requires a fresh quote, without restoring old authority', async () => {
  await tick(); const previous = pricing.quote;
  input = { ...input, driverTipPercent: 10 }; await render();
  input = { ...input, driverTipPercent: 'none' }; await render();
  expect(pricing.quote).toBeNull(); expect(pricing.displayQuote).toBe(previous); expect(pricing.displayOnly).toBe(true);
  await tick(); expect(apiJson).toHaveBeenCalledTimes(2);
  expect(pricing.quote).not.toBeNull(); expect(pricing.displayOnly).toBe(false);
});
