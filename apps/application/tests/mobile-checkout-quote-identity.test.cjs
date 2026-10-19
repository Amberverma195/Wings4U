const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockCart, mockSetup, mockPromo, mockSession, renderer;
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-linking', () => ({ createURL: () => 'wings4u://stripe' }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('react-native', () => ({ Image: 'Image', Pressable: 'Pressable', Modal: ({ visible, children }) => visible ? require('react').createElement('Modal', {}, children) : null, ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView', ScrollView: 'ScrollView',
  Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', View: 'View', Platform: { OS: 'ios' }, StyleSheet: { create: x => x } }));
jest.mock('lucide-react-native', () => ({ CheckCircle2: 'Icon', CreditCard: 'Icon', MapPin: 'Icon', MessageSquareText: 'Icon', ShoppingBag: 'Icon', Wallet: 'Icon' }));
jest.mock('@stripe/stripe-react-native', () => ({ initStripe: jest.fn(), useStripe: () => ({ initPaymentSheet: jest.fn(), presentPaymentSheet: jest.fn() }) }));
jest.mock('../src/components/auth-sheet', () => ({ AuthSheet: () => null }));
jest.mock('../src/components/checkout-entry-guard', () => ({ CheckoutEntryGuard: ({ children }) => children }));
jest.mock('../src/components/order-setup-summary', () => ({ OrderSetupSummary: () => null }));
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/context/order-setup', () => ({ useOrderSetup: () => mockSetup }));
jest.mock('../src/context/promo', () => ({ usePromo: () => mockPromo }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession, withSilentRefresh: callback => callback() }));
jest.mock('../src/hooks/use-account-data', () => ({ useAccountData: () => ({ data: { wingsRewards: null, promos: [] }, refresh: jest.fn() }) }));
jest.mock('../src/lib/api', () => ({ apiFetch: jest.fn(), apiJson: jest.fn(), getApiErrorMessage: body => body?.errors?.[0]?.message ?? 'Request failed' }));
const { apiFetch, apiJson } = require('../src/lib/api');
const Checkout = require('../app/checkout').default;
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children ? node.children.map(text).join('') : '';
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => text(node) === label);
const place = () => button('Place order');
const response = (data, ok = true) => ({ ok, status: ok ? 200 : 422, json: async () => ok ? { data } : { errors: [{ message: 'Mock checkout stopped' }] } });
const quote = request => ({ item_subtotal_cents: request.items[0].quantity * 1000, tax_cents: 0, driver_tip_cents: request.driver_tip_cents,
  final_payable_cents: request.items[0].quantity * 1000 + (request.driver_tip_cents ?? 0), applied_promo_code: request.promo_code, lines: request.items });
const rerender = async () => act(async () => { renderer.update(React.createElement(Checkout)); });
const tick = async ms => act(async () => { jest.advanceTimersByTime(ms); });
const settle = async () => { for (let i = 0; i < 4; i++) await tick(400); };
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-17T16:00:00Z')); jest.clearAllMocks();
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer-a' }, needsProfileCompletion: false };
  mockCart = { locationId: 'store', items: [{ key: 'a', menu_item_id: 'burger', name: 'Burger', quantity: 1, base_price_cents: 1000, modifier_selections: [], special_instructions: '' }],
    fulfillmentType: 'DELIVERY', scheduledFor: null, driverTipPercent: 'none', isCartHydrated: true, isCartHydrating: false, clear: jest.fn() };
  mockSetup = { deliveryAddress: { line1: '12 Main St unit 1', city: 'London', postal_code: 'n5y4j7' }, getConfirmedSetup: () => ({}), setDeliveryAddress: jest.fn(), openOrderSetup: jest.fn() };
  mockPromo = { promoCode: null, applyWingsReward: false, clearPromoCode: jest.fn(), applyPromoCode: jest.fn(), redeemWingsReward: jest.fn() };
  apiFetch.mockImplementation(async (url, init) => url === '/api/v1/delivery/quote'
    ? response({ delivery_quote_token: JSON.stringify(JSON.parse(init.body).address_snapshot_json), delivery_fee_cents: 0, expires_at: new Date(Date.now() + 600000).toISOString() })
    : response(null, false));
  apiJson.mockImplementation(async (url, init) => ({ data: url.includes('/stripe/config') ? { configured: false } : quote(JSON.parse(init.body)) }));
  await act(async () => { renderer = create(React.createElement(Checkout)); });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.useRealTimers(); });

test.each([
  { line1: '99 Other St' }, { line1: '12 Main St unit 2' }, { postal_code: 'N6A1A1' },
])('address update %j immediately blocks old quotes and sends the exact new snapshot', async changed => {
  await settle(); await act(async () => button('Hand to me').props.onPress());
  expect(place().props.disabled).toBe(false);
  mockSetup.deliveryAddress = { ...mockSetup.deliveryAddress, ...changed }; await rerender();
  expect(place().props.disabled).toBe(true);
  await act(async () => place().props.onPress());
  expect(apiFetch.mock.calls.filter(call => call[0] === '/api/v1/checkout')).toHaveLength(0);
  await settle(); expect(place().props.disabled).toBe(false);
  await act(async () => place().props.onPress());
  const payload = JSON.parse(apiFetch.mock.calls.find(call => call[0] === '/api/v1/checkout')[1].body);
  expect(JSON.parse(payload.delivery_quote_token)).toEqual(payload.address_snapshot_json);
  expect(payload.address_snapshot_json).toMatchObject({ line1: changed.line1 ?? '12 Main St unit 1', postal_code: changed.postal_code ? 'N6A 1A1' : 'N5Y 4J7' });
});
test('an old in-flight delivery response cannot authorize a changed address', async () => {
  const original = apiFetch.getMockImplementation(); let release;
  apiFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await tick(350);
  mockSetup.deliveryAddress = { ...mockSetup.deliveryAddress, line1: '99 New St' }; await rerender();
  await settle();
  await act(async () => release(response({ delivery_quote_token: 'old-A', expires_at: new Date(Date.now() + 600000).toISOString() })));
  await settle();
  const requests = apiJson.mock.calls.filter(call => call[0] === '/api/v1/cart/quote').map(call => JSON.parse(call[1].body));
  expect(requests.every(request => request.delivery_quote_token !== 'old-A')).toBe(true);
  expect(requests.at(-1).address_snapshot_json.line1).toBe('99 New St');
  expect(place().props.disabled).toBe(false);
});
test('ignores an obsolete cart quote after quantity, tip and promotion change', async () => {
  const original = apiJson.getMockImplementation(); let release;
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' && !release ? new Promise(resolve => { release = resolve; }) : original(url, init));
  await tick(350); await tick(250);
  expect(summary('Payable')).toBe('Awaiting quote');
  mockCart = { ...mockCart, items: [{ ...mockCart.items[0], quantity: 2 }], driverTipPercent: 10 };
  mockPromo = { ...mockPromo, promoCode: 'NEW' }; await rerender();
  expect(place().props.disabled).toBe(true); await settle();
  expect(summary('Payable')).toBe('$22.00');
  await act(async () => release({ data: { ...quote({ items: [{ quantity: 1 }], driver_tip_cents: 0 }), final_payable_cents: 1 } }));
  await settle(); expect(place().props.disabled).toBe(false);
  expect(summary('Payable')).toBe('$22.00');
  const latest = JSON.parse(apiJson.mock.calls.filter(call => call[0] === '/api/v1/cart/quote').at(-1)[1].body);
  expect(latest).toMatchObject({ items: [{ quantity: 2 }], driver_tip_cents: 200, promo_code: 'NEW' });
});
test('delivery failure stays blocked until retry; pickup never needs an address', async () => {
  apiFetch.mockRejectedValueOnce(new Error('Route unavailable')); await settle();
  expect(place().props.disabled).toBe(true);
  const retry = renderer.root.findAllByType('TouchableOpacity').find(node => /retry/i.test(text(node)));
  expect(retry).toBeDefined(); await act(async () => retry.props.onPress()); await settle();
  expect(place().props.disabled).toBe(false);
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP' }; mockSetup.deliveryAddress = null;
  await rerender(); await settle(); expect(place().props.disabled).toBe(false);
  const latest = JSON.parse(apiJson.mock.calls.filter(call => call[0] === '/api/v1/cart/quote').at(-1)[1].body);
  expect(latest.address_snapshot_json).toBeUndefined(); expect(latest.delivery_quote_token).toBeUndefined();
  mockCart = { ...mockCart, fulfillmentType: 'DELIVERY' }; mockSetup.deliveryAddress = { line1: '99 New St', postal_code: 'N6A1A1' };
  await rerender(); expect(place().props.disabled).toBe(true); await settle(); expect(place().props.disabled).toBe(false);
});

test('pickup coupon and tip selections reach final revalidation and checkout without losing automatic codes', async () => {
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP', driverTipPercent: 15 };
  mockPromo = { ...mockPromo, promoCode: 'SAVE' };
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation(async (url, init) => url === '/api/v1/cart/quote'
    ? { data: { ...quote(JSON.parse(init.body)), applied_promo_code: 'AUTO, SAVE' } } : original(url, init));
  await rerender(); await settle(); expect(place().props.disabled).toBe(false);
  await act(async () => place().props.onPress());
  const submit = apiFetch.mock.calls.find(call => call[0] === '/api/v1/checkout');
  expect(JSON.parse(submit[1].body)).toMatchObject({ fulfillment_type: 'PICKUP', driver_tip_cents: 150, promo_code: 'SAVE' });
  const pricing = apiJson.mock.calls.filter(call => call[0] === '/api/v1/cart/quote');
  expect(pricing.length).toBeGreaterThanOrEqual(2); // Preview plus immediate pre-submission revalidation.
  expect(JSON.parse(pricing.at(-1)[1].body).driver_tip_cents).toBe(150);
});

test('expired coupon rejection at submission prevents checkout/payment and invalidates the selection', async () => {
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP' }; mockPromo = { ...mockPromo, promoCode: 'SAVE' };
  await rerender(); await settle(); expect(place().props.disabled).toBe(false);
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? Promise.reject(new Error('Invalid or expired promo code')) : original(url, init));
  await act(async () => place().props.onPress());
  expect(mockPromo.clearPromoCode).toHaveBeenCalled();
  expect(apiFetch.mock.calls.some(call => /\/checkout$|payment-intent/.test(call[0]))).toBe(false);
  expect(text(renderer.toJSON())).toContain('Invalid or expired promo code');
});

test('changed total is shown for review before any order or payment request', async () => {
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP' }; await rerender(); await settle();
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation(async (url, init) => url === '/api/v1/cart/quote'
    ? { data: { ...quote(JSON.parse(init.body)), final_payable_cents: 1200 } } : original(url, init));
  await act(async () => place().props.onPress());
  expect(apiFetch.mock.calls.some(call => /\/checkout$|payment-intent/.test(call[0]))).toBe(false);
  expect(text(renderer.toJSON())).toContain('Your order total changed');
  expect(summary('Payable')).toBe('$12.00');
});

test('cart changes during final validation cannot submit a stale order', async () => {
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP' }; await rerender(); await settle();
  let release; const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? new Promise(resolve => { release ??= resolve; }) : original(url, init));
  let request; await act(async () => { request = place().props.onPress(); });
  mockCart = { ...mockCart, items: [{ ...mockCart.items[0], quantity: 2 }] }; await rerender();
  await act(async () => { release({ data: quote({ items: [{ quantity: 1 }], driver_tip_cents: 0 }) }); await request; });
  expect(apiFetch.mock.calls.some(call => /\/checkout$|payment-intent/.test(call[0]))).toBe(false);
});

const summary = label => renderer.root.findAll(node => node.type?.name === 'SummaryRow').find(node => node.props.label === label)?.props.value;
const confirmedQuote = request => ({ ...quote(request), tax_cents: 117, delivery_fee_cents: 675,
  delivery_fee_stated_cents: 675, delivery_fee_is_estimate: false, item_discount_total_cents: 100,
  final_payable_cents: 1692 + (request.driver_tip_cents ?? 0),
  lines: request.items.map(item => ({ ...item, line_total_cents: 1000 * item.quantity })) });
const quoteRequests = () => apiJson.mock.calls.filter(call => call[0] === '/api/v1/cart/quote');
const noSubmission = () => expect(apiFetch.mock.calls.some(call => /\/checkout$|payment-intent/.test(call[0]))).toBe(false);

test.each(['quantity', 'modifier', 'builder', 'removed ingredient', 'fulfillment', 'address', 'location', 'schedule', 'coupon', 'reward', 'tip', 'customer'])(
  '%s changes immediately hide every old confirmed amount and block submission during repricing', async change => {
    const original = apiJson.getMockImplementation();
    apiJson.mockImplementation(async (url, init) => url === '/api/v1/cart/quote' ? { data: confirmedQuote(JSON.parse(init.body)) } : original(url, init));
    await settle();
    expect(summary('Subtotal')).toBe('$10.00'); expect(summary('Tax')).toBe('$1.17');
    expect(summary('Delivery')).toBe('$6.75'); expect(summary('Payable')).toBe('$16.92');
    const previousCount = quoteRequests().length;
    let release;
    apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote'
      ? new Promise(resolve => { release = () => resolve({ data: { ...confirmedQuote(JSON.parse(init.body)), final_payable_cents: 2345 } }); }) : original(url, init));
    const item = mockCart.items[0];
    if (change === 'quantity') mockCart = { ...mockCart, items: [{ ...item, quantity: 2 }] };
    if (change === 'modifier') mockCart = { ...mockCart, items: [{ ...item, modifier_selections: [{ modifier_option_id: 'cheese', option_name: 'Cheese' }] }] };
    if (change === 'builder') mockCart = { ...mockCart, items: [{ ...item, builder_payload: { builder_type: 'WINGS', weight_lb: 1, flavour_slots: [] } }] };
    if (change === 'removed ingredient') mockCart = { ...mockCart, items: [{ ...item, removed_ingredients: [{ id: 'onion', name: 'Onion' }] }] };
    if (change === 'fulfillment') mockCart = { ...mockCart, fulfillmentType: 'PICKUP' };
    if (change === 'address') mockSetup.deliveryAddress = { ...mockSetup.deliveryAddress, line1: '99 Other St' };
    if (change === 'location') mockCart = { ...mockCart, locationId: 'store-b' };
    if (change === 'schedule') mockCart = { ...mockCart, scheduledFor: '2026-10-18T17:00:00Z' };
    if (change === 'coupon') mockPromo = { ...mockPromo, promoCode: 'SAVE' };
    if (change === 'reward') mockPromo = { ...mockPromo, applyWingsReward: true };
    if (change === 'tip') mockCart = { ...mockCart, driverTipPercent: 10 };
    if (change === 'customer') mockSession = { ...mockSession, user: { id: 'customer-b' } };
    await rerender();
    for (const label of ['Subtotal', 'Tax', 'Payable']) expect(summary(label)).toBe('Awaiting quote');
    expect(text(renderer.toJSON())).not.toContain('$16.92');
    expect(summary('Delivery')).not.toBe('$6.75');
    expect(renderer.root.findAll(node => node.type?.name === 'SummaryRow' && node.props.discount)).toHaveLength(0);
    if (change === 'tip') expect(summary('Tip')).toBe('Awaiting quote');
    expect(place().props.disabled).toBe(true);
    await act(async () => place().props.onPress()); noSubmission();
    await settle(); expect(quoteRequests()).toHaveLength(previousCount + 1);
    expect(place().props.disabled).toBe(true);
    await act(async () => release());
    expect(summary('Payable')).toBe('$23.45'); expect(place().props.disabled).toBe(false);
  });

test.each(['exact', 'coupon', 'threshold'])('checkout displays the current backend delivery fee: %s', async mode => {
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation(async (url, init) => url === '/api/v1/cart/quote' ? { data: {
    ...confirmedQuote(JSON.parse(init.body)), delivery_fee_waived: mode !== 'exact', delivery_fee_cents: mode === 'exact' ? 675 : 0,
    applied_promo_code: mode === 'coupon' ? 'FREEDEL' : undefined,
  } } : original(url, init));
  await settle();
  if (mode === 'exact') expect(summary('Delivery')).toBe('$6.75');
  else {
    expect(text(renderer.toJSON())).toContain('$6.75 Free');
    expect(renderer.root.findAllByType('Text').some(node => node.props.style?.textDecorationLine === 'line-through' && text(node).includes('$6.75'))).toBe(true);
  }
  expect(quoteRequests().map(call => JSON.parse(call[1].body)).every(body => body.delivery_quote_token)).toBe(true);
});

test('pickup omits delivery, including while pricing is pending', async () => {
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP' }; await rerender(); await settle();
  expect(summary('Delivery')).toBeUndefined(); expect(place().props.disabled).toBe(false);
});

test('expired delivery token hides confirmed prices until a fresh token and cart quote arrive', async () => {
  await settle(); expect(summary('Payable')).toBe('$10.00');
  let release;
  apiFetch.mockImplementation((url) => url === '/api/v1/delivery/quote' ? new Promise(resolve => { release = resolve; }) : response(null, false));
  await tick(600000); await tick(350);
  expect(summary('Subtotal')).toBe('Awaiting quote'); expect(summary('Payable')).toBe('Awaiting quote');
  expect(text(renderer.toJSON())).toContain('Updating delivery fee'); expect(place().props.disabled).toBe(true);
  await act(async () => place().props.onPress()); noSubmission();
  await act(async () => release(response({ delivery_quote_token: 'renewed', expires_at: new Date(Date.now() + 600000).toISOString() })));
  await settle(); expect(place().props.disabled).toBe(false);
  expect(JSON.parse(quoteRequests().at(-1)[1].body).delivery_quote_token).toBe('renewed');
});

test.each(['expired', 'invalid expiry', 'missing token'])('a delivery response with %s stays blocked without a retry loop', async mode => {
  apiFetch.mockResolvedValue(response({ delivery_quote_token: mode === 'missing token' ? '' : 'invalid',
    expires_at: mode === 'invalid expiry' ? 'invalid' : new Date(Date.now() + (mode === 'expired' ? -1 : 600000)).toISOString() }));
  await settle(); await tick(10000);
  expect(place().props.disabled).toBe(true); expect(summary('Payable')).toBe('Awaiting quote');
  expect(summary('Delivery')).toBe('Unavailable'); expect(text(renderer.toJSON())).toContain('invalid or expired');
  expect(apiFetch.mock.calls.filter(call => call[0] === '/api/v1/delivery/quote')).toHaveLength(1);
  expect(quoteRequests()).toHaveLength(0); await act(async () => place().props.onPress()); noSubmission();
});

test('an estimated cart fee cannot confirm checkout even with a delivery token', async () => {
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation(async (url, init) => url === '/api/v1/cart/quote'
    ? { data: { ...confirmedQuote(JSON.parse(init.body)), delivery_fee_is_estimate: true } } : original(url, init));
  await settle(); expect(place().props.disabled).toBe(true);
  expect(summary('Payable')).toBe('Awaiting quote'); expect(summary('Delivery')).not.toBe('$6.75');
  await act(async () => place().props.onPress()); noSubmission();
});

test.each(['DELIVERY_QUOTE_EXPIRED', 'INVALID_DELIVERY_QUOTE'])('server rejection %s invalidates delivery pricing and permits an explicit retry', async code => {
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote'
    ? Promise.reject(Object.assign(new Error('Delivery token rejected'), { body: { errors: [{ code, message: 'Delivery token rejected' }] } })) : original(url, init));
  await settle();
  expect(summary('Payable')).toBe('Awaiting quote'); expect(summary('Delivery')).toBe('Unavailable');
  expect(place().props.disabled).toBe(true); await act(async () => place().props.onPress()); noSubmission();
  expect(quoteRequests()).toHaveLength(1);
  apiJson.mockImplementation(original);
  await act(async () => renderer.root.findAllByType('TouchableOpacity').find(node => /retry/i.test(text(node))).props.onPress());
  await settle(); expect(place().props.disabled).toBe(false);
  expect(apiFetch.mock.calls.filter(call => call[0] === '/api/v1/delivery/quote')).toHaveLength(2);
});

test('percentage tips reconcile the server subtotal once without response-driven quote loops', async () => {
  mockCart = { ...mockCart, driverTipPercent: 10 };
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation(async (url, init) => url === '/api/v1/cart/quote' ? { data: {
    ...confirmedQuote(JSON.parse(init.body)), item_subtotal_cents: 2000,
  } } : original(url, init));
  await rerender(); await settle(); await tick(10000);
  expect(quoteRequests()).toHaveLength(2);
  expect(quoteRequests().map(call => JSON.parse(call[1].body).driver_tip_cents)).toEqual([100, 200]);
  expect(summary('Subtotal')).toBe('$20.00'); expect(summary('Tip')).toBe('$2.00');
});
