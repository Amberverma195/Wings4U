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
jest.mock('lucide-react-native', () => ({ ArrowLeft: 'Icon', ChevronDown: 'Icon', ChevronUp: 'Icon', CheckCircle2: 'Icon', CreditCard: 'Icon', MapPin: 'Icon', MessageSquareText: 'Icon', ShoppingBag: 'Icon', Wallet: 'Icon' }));
const mockInitSheet = jest.fn(), mockPresentSheet = jest.fn();
jest.mock('@stripe/stripe-react-native', () => ({ initStripe: jest.fn(), useStripe: () => ({ initPaymentSheet: mockInitSheet, presentPaymentSheet: mockPresentSheet }) }));
jest.mock('../src/components/auth-sheet', () => ({ AuthSheet: 'AuthSheet' }));
jest.mock('../src/components/checkout-entry-guard', () => ({ CheckoutEntryGuard: ({ children }) => children }));
jest.mock('../src/components/order-setup-summary', () => ({ OrderSetupSummary: 'OrderSetupSummary' }));
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
  delivery_fee_cents: 0, final_payable_cents: request.items[0].quantity * 1000 + (request.driver_tip_cents ?? 0), applied_promo_code: request.promo_code,
  lines: request.items.map(item => ({ ...item, line_total_cents: item.quantity * 1000 })) });
const rerender = async () => act(async () => { renderer.update(React.createElement(Checkout)); });
const tick = async ms => act(async () => { jest.advanceTimersByTime(ms); });
const settle = async () => { for (let i = 0; i < 4; i++) await tick(400); };
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-17T16:00:00Z')); jest.clearAllMocks();
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer-a' }, needsProfileCompletion: false };
  mockCart = { locationId: 'store', items: [{ key: 'a', menu_item_id: 'burger', name: 'Burger', quantity: 1, base_price_cents: 1000, modifier_selections: [], special_instructions: '' }],
    fulfillmentType: 'DELIVERY', scheduledFor: null, driverTipPercent: 'none', isCartHydrated: true, isCartHydrating: false, clear: jest.fn() };
  mockSetup = { ready: true, confirmed: true, deliveryAddress: { line1: '12 Main St unit 1', city: 'London', postal_code: 'n5y4j7' }, getConfirmedSetup: () => ({}), setDeliveryAddress: jest.fn(), openOrderSetup: jest.fn() };
  mockCart.setDriverTipPercent = jest.fn();
  mockPromo = { promoCode: null, applyWingsReward: false, clearAll: jest.fn(), clearPromoCode: jest.fn(), applyPromoCode: jest.fn(), redeemWingsReward: jest.fn() };
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
  expectTotalsHidden();
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
const expectTotalsHidden = () => {
  expect(renderer.root.findAll(node => node.type?.name === 'Section' && node.props.title === 'Total')).toHaveLength(0);
  expect(renderer.root.findAll(node => node.type?.name === 'SummaryRow')).toHaveLength(0);
  const output = text(renderer.toJSON());
  for (const label of ['Order total', 'Confirming total', 'Awaiting quote', 'Previous prices.', 'Wait for the order total to be confirmed before placing the order.']) expect(output).not.toContain(label);
  expect(place().props.disabled).toBe(true);
};

test('checkout footer shows only Place order before and after pricing is ready', async () => {
  expectTotalsHidden();
  expect(text(renderer.root.findByProps({ accessibilityLabel: 'Place order' }).parent)).toBe('Place order');
  await settle();
  const footer = renderer.root.findByProps({ accessibilityLabel: 'Place order' }).parent;
  expect(footer.findAllByType('Text').map(node => text(node))).toEqual(['Place order']);
  expect(text(renderer.toJSON())).not.toContain('Order total');
  expect(text(renderer.toJSON())).not.toContain('Previous total');
  expect(summary('Payable')).toBe('$10.00');
});

test('checkout omits coupons, tip controls and notes while retaining selections made in Cart', async () => {
  mockCart = { ...mockCart, driverTipPercent: 10 };
  mockPromo = { ...mockPromo, promoCode: 'SAVE' };
  await rerender(); await settle();
  const output = text(renderer.toJSON());
  for (const label of ['See coupons & rewards', 'Add a tip', 'Order notes (optional)', 'Notes']) expect(output).not.toContain(label);
  expect(renderer.root.findAll(node => node.type?.name === 'CartCoupons')).toHaveLength(0);
  expect(renderer.root.findAllByProps({ accessibilityLabel: 'Tip 10%' })).toHaveLength(0);
  expect(renderer.root.findAllByType('TextInput')).toHaveLength(0);
  expect(JSON.parse(quoteRequests().at(-1)[1].body)).toMatchObject({ promo_code: 'SAVE', driver_tip_cents: 100 });
  expect(summary('Tip')).toBe('$1.00');
});

test.each(['PICKUP', 'DELIVERY'])('entering %s checkout keeps items visible and hides totals until complete pricing arrives', async type => {
  mockCart = { ...mockCart, fulfillmentType: type }; await rerender();
  expect(text(renderer.root.findByProps({ accessibilityLabel: 'Estimated item price for Burger' }))).toBe('$10.00');
  expectTotalsHidden();
  expect(text(renderer.toJSON())).not.toContain('Awaiting quote'); expect(text(renderer.toJSON())).not.toContain('$0.00');
  expect(place().props.disabled).toBe(true);
  await act(async () => place().props.onPress()); noSubmission(); expectTotalsHidden();
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation(async (url, init) => url === '/api/v1/cart/quote' ? { data: {
    ...confirmedQuote(JSON.parse(init.body)), item_subtotal_cents: 1200, lines: [{ menu_item_id: 'burger', quantity: 1, line_total_cents: 1200 }],
  } } : original(url, init));
  await settle();
  expect(text(renderer.root.findByProps({ accessibilityLabel: 'Item price for Burger' }))).toBe('$12.00');
  expect(summary('Estimated subtotal')).toBeUndefined(); expect(summary('Subtotal')).toBe('$12.00');
  expect(summary('Payable')).toBe('$16.92'); expect(summary('Tax')).toBe('$1.17');
  expect(text(renderer.toJSON())).not.toContain('Wait for the order total to be confirmed before placing the order.');
  expect(text(renderer.root.findByProps({ accessibilityLabel: 'Place order' }).parent)).toBe('Place order');
  expect(place().props.disabled).toBe(false);
});

test.each([
  ['modifiers', { modifier_selections: [{ option_name: 'Cheese', price_delta_cents: 150 }] }, '$23.00'],
  ['wings', { builder_payload: { builder_type: 'WINGS', wing_type: 'BONELESS', extra_flavour: { flavour_name: 'Hot' } } }, '$24.00'],
  ['wing combo', { modifier_selections: [{ option_name: 'Poutine', price_delta_cents: 200 }, { option_name: 'Cola', price_delta_cents: 100 }],
    builder_payload: { builder_type: 'WING_COMBO', wing_type: 'BONELESS', extra_flavour: { flavour_name: 'Hot' } } }, '$30.00'],
  ['lunch special', { removed_ingredients: [{ name: 'Onion' }], builder_payload: { builder_type: 'LUNCH_SPECIAL', child_name: 'Wrap', child_addons: [{ name: 'Cheese', price_delta_cents: 150 }] } }, '$23.00'],
  ['side and pop', { builder_payload: { builder_type: 'ITEM_CUSTOMIZATION', side_pop_bundle: { price_cents: 499, side_label: 'Fries', pop_label: 'Cola' } } }, '$29.98'],
])('initial %s prices match the Cart helper before checkout quoting', async (_kind, changes, expected) => {
  mockCart = { ...mockCart, items: [{ ...mockCart.items[0], ...changes, quantity: 2 }] }; await rerender();
  expect(text(renderer.root.findByProps({ accessibilityLabel: 'Estimated item price for Burger' }))).toBe(expected);
  expectTotalsHidden();
  expect(place().props.disabled).toBe(true); expect(quoteRequests()).toHaveLength(0);
  await act(async () => place().props.onPress()); noSubmission();
});

test.each([false, true])('coupon %s application/removal hides totals until the fresh selection is confirmed', async removing => {
  mockPromo = { ...mockPromo, promoCode: removing ? 'SAVE' : null };
  const original = apiJson.getMockImplementation();
  const priced = request => ({ ...confirmedQuote(request), applied_promo_code: request.promo_code,
    promo_discount_cents: request.promo_code ? 100 : 0, final_payable_cents: request.promo_code ? 1592 : 1692 });
  apiJson.mockImplementation(async (url, init) => url === '/api/v1/cart/quote' ? { data: priced(JSON.parse(init.body)) } : original(url, init));
  await rerender(); await settle();
  let release;
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? new Promise(resolve => { release = () => resolve({ data: priced(JSON.parse(init.body)) }); }) : original(url, init));
  mockPromo = { ...mockPromo, promoCode: removing ? null : 'SAVE' }; await rerender();
  expectTotalsHidden();
  expect(summary('Promo code (SAVE)')).toBeUndefined();
  expect(place().props.disabled).toBe(true); await act(async () => place().props.onPress()); noSubmission();
  await tick(250); await act(async () => release());
  expect(summary('Payable')).toBe(removing ? '$16.92' : '$15.92');
  expect(text(renderer.toJSON())).not.toContain('Previous prices.');
  expect(summary('Promo code (SAVE)')).toBe(removing ? undefined : '-$1.00');
  expect(place().props.disabled).toBe(false);
});

test('failed refreshing prices keep totals hidden and expose a working retry', async () => {
  await settle();
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? Promise.reject(new Error('Network unavailable')) : original(url, init));
  mockCart = { ...mockCart, driverTipPercent: 10 }; await rerender();
  expectTotalsHidden(); await settle();
  expect(text(renderer.toJSON())).toContain('Network unavailable');
  expectTotalsHidden();
  expect(renderer.root.findAllByType('ActivityIndicator')).toHaveLength(0);
  expect(place().props.disabled).toBe(true); noSubmission();
  apiJson.mockImplementation(original); await act(async () => button('Retry pricing').props.onPress()); await settle();
  expect(summary('Payable')).toBe('$11.00'); expect(place().props.disabled).toBe(false);
});

test('invalidated order details hide totals and prevent submission', async () => {
  await settle(); mockSetup.confirmed = false; mockSetup.getConfirmedSetup = () => null; await rerender();
  expectTotalsHidden();
  expect(renderer.root.findAllByType('ActivityIndicator')).toHaveLength(0);
  expect(place().props.disabled).toBe(true); await act(async () => place().props.onPress()); noSubmission();
});

test.each(['quantity', 'modifier', 'builder', 'removed ingredient', 'fulfillment', 'address', 'location', 'schedule', 'coupon', 'reward', 'tip', 'customer'])(
  '%s changes hide old totals and block submission until fresh pricing is confirmed', async change => {
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
    expectTotalsHidden();
    expect(text(renderer.toJSON())).not.toContain('$16.92');
    expect(renderer.root.findAll(node => node.type?.name === 'SummaryRow' && node.props.discount)).toHaveLength(0);
    if (change === 'tip') expect(summary('Tip')).toBeUndefined(); // Previous server quote had no tip.
    expect(place().props.disabled).toBe(true);
    await act(async () => place().props.onPress()); noSubmission();
    await settle(); expect(quoteRequests()).toHaveLength(previousCount + 1);
    expect(place().props.disabled).toBe(true);
    await act(async () => release());
    expect(summary('Payable')).toBe('$23.45'); expect(place().props.disabled).toBe(false);
  });

test('returning to a previous tip can reuse its display prices but never its old authorization', async () => {
  await settle();
  const original = apiJson.getMockImplementation(), releases = new Map();
  apiJson.mockImplementation((url, init) => {
    if (url !== '/api/v1/cart/quote') return original(url, init);
    const request = JSON.parse(init.body);
    return new Promise(resolve => releases.set(request.driver_tip_cents, () => resolve({ data: { ...quote(request), final_payable_cents: 1200 } })));
  });
  mockCart = { ...mockCart, driverTipPercent: 10 }; await rerender(); await tick(250);
  mockCart = { ...mockCart, driverTipPercent: 'none' }; await rerender(); await tick(250);
  expectTotalsHidden(); expect(place().props.disabled).toBe(true);
  await act(async () => place().props.onPress()); noSubmission();
  await act(async () => releases.get(100)());
  expectTotalsHidden(); expect(place().props.disabled).toBe(true);
  await act(async () => releases.get(0)());
  expect(summary('Payable')).toBe('$12.00'); expect(text(renderer.toJSON())).not.toContain('Previous prices.'); expect(place().props.disabled).toBe(false);
});

test('removing a tip hides the previous breakdown until the new total is confirmed', async () => {
  mockCart = { ...mockCart, driverTipPercent: 10 }; await rerender(); await settle();
  expect(summary('Tip')).toBe('$1.00');
  const original = apiJson.getMockImplementation(); let release;
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote'
    ? new Promise(resolve => { release = () => resolve({ data: quote(JSON.parse(init.body)) }); }) : original(url, init));
  mockCart = { ...mockCart, driverTipPercent: 'none' }; await rerender();
  expectTotalsHidden();
  expect(place().props.disabled).toBe(true); await act(async () => place().props.onPress()); noSubmission();
  await tick(250); await act(async () => release());
  expect(summary('Tip')).toBeUndefined(); expect(summary('Payable')).toBe('$10.00'); expect(text(renderer.toJSON())).not.toContain('Previous prices.');
  expect(place().props.disabled).toBe(false);
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
  expectTotalsHidden();
  expectTotalsHidden(); expect(place().props.disabled).toBe(true);
  await act(async () => place().props.onPress()); noSubmission();
  await act(async () => release(response({ delivery_quote_token: 'renewed', expires_at: new Date(Date.now() + 600000).toISOString() })));
  await settle(); expect(place().props.disabled).toBe(false);
  expect(JSON.parse(quoteRequests().at(-1)[1].body).delivery_quote_token).toBe('renewed');
});

test.each(['expired', 'invalid expiry', 'missing token'])('a delivery response with %s stays blocked without a retry loop', async mode => {
  apiFetch.mockResolvedValue(response({ delivery_quote_token: mode === 'missing token' ? '' : 'invalid',
    expires_at: mode === 'invalid expiry' ? 'invalid' : new Date(Date.now() + (mode === 'expired' ? -1 : 600000)).toISOString() }));
  await settle(); await tick(10000);
  expect(place().props.disabled).toBe(true); expect(summary('Payable')).toBeUndefined();
  expect(summary('Delivery')).toBeUndefined(); expect(text(renderer.toJSON())).toContain('invalid or expired');
  expect(apiFetch.mock.calls.filter(call => call[0] === '/api/v1/delivery/quote')).toHaveLength(1);
  expect(quoteRequests()).toHaveLength(0); await act(async () => place().props.onPress()); noSubmission();
});

test('an estimated cart fee cannot confirm checkout even with a delivery token', async () => {
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation(async (url, init) => url === '/api/v1/cart/quote'
    ? { data: { ...confirmedQuote(JSON.parse(init.body)), delivery_fee_is_estimate: true } } : original(url, init));
  await settle(); expect(place().props.disabled).toBe(true);
  expect(summary('Payable')).toBeUndefined(); expect(summary('Delivery')).not.toBe('$6.75');
  await act(async () => place().props.onPress()); noSubmission();
});

test.each(['DELIVERY_QUOTE_EXPIRED', 'INVALID_DELIVERY_QUOTE'])('server rejection %s invalidates delivery pricing and permits an explicit retry', async code => {
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote'
    ? Promise.reject(Object.assign(new Error('Delivery token rejected'), { body: { errors: [{ code, message: 'Delivery token rejected' }] } })) : original(url, init));
  await settle();
  expect(summary('Payable')).toBeUndefined(); expect(summary('Delivery')).toBeUndefined();
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

test('customized line details expand without truncation and use the server line price', async () => {
  const original = apiJson.getMockImplementation();
  const instructions = 'Please pack the hot sauce separately and label every container for our group.';
  mockCart = { ...mockCart, items: [{ ...mockCart.items[0], name: 'Wing combo', special_instructions: instructions,
    modifier_selections: [{ group_name: 'Side', option_name: 'Fries', modifier_option_id: 'fries' }, { group_name: 'Drink', option_name: 'Cola', modifier_option_id: 'cola' }],
    removed_ingredients: [{ name: 'Onion' }], builder_payload: { builder_type: 'WING_COMBO', weight_lb: 2, wing_type: 'BONELESS', preparation: 'NON_BREADED',
      flavour_slots: [{ flavour_name: 'Honey garlic', placement: 'ON_SIDE' }], extra_flavour: { flavour_name: 'Hot', placement: 'ON_WINGS' },
      salad_customization: { salad_name: 'Caesar', removed_ingredients: [{ name: 'Croutons' }], modifier_selections: [{ name: 'Extra dressing' }] } } }] };
  apiJson.mockImplementation(async (url, init) => url === '/api/v1/cart/quote' ? { data: confirmedQuote(JSON.parse(init.body)) } : original(url, init));
  await rerender(); await settle();
  expect(text(renderer.toJSON())).not.toContain(instructions);
  const expand = renderer.root.findByProps({ accessibilityLabel: 'Show details for Wing combo' });
  expect(expand.props.accessibilityState.expanded).toBe(false);
  await act(async () => expand.props.onPress());
  for (const detail of [instructions, 'Fries', 'Cola', 'No Onion', 'Honey garlic (on the side)', 'Extra: Hot', '2 lb', 'Non-breaded', 'Caesar', 'Croutons', 'Extra dressing']) {
    expect(text(renderer.toJSON())).toContain(detail);
  }
  expect(renderer.root.findAllByType('Text').filter(node => text(node).includes(instructions)).every(node => node.props.numberOfLines === undefined)).toBe(true);
  expect(renderer.root.findAllByType('Text').some(node => text(node) === '$10.00')).toBe(true);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Hide details for Wing combo' }).props.onPress());
  expect(text(renderer.toJSON())).not.toContain(instructions);
});

test.each(['', 'HAND_TO_ME', 'LEAVE_AT_DOOR', 'CALL_ON_ARRIVAL', 'TEXT_ON_ARRIVAL'])('delivery handoff %s is optional and correctly serialized', async preference => {
  await settle();
  const labels = { '': 'None', HAND_TO_ME: 'Hand to me', LEAVE_AT_DOOR: 'Leave at door', CALL_ON_ARRIVAL: 'Call on arrival', TEXT_ON_ARRIVAL: 'Text on arrival' };
  await act(async () => renderer.root.findByProps({ accessibilityLabel: `Delivery handoff: ${labels[preference]}` }).props.onPress());
  expect(renderer.root.findByProps({ accessibilityLabel: `Delivery handoff: ${labels[preference]}` }).props.accessibilityState.selected).toBe(true);
  await act(async () => place().props.onPress());
  const payload = JSON.parse(apiFetch.mock.calls.find(call => call[0] === '/api/v1/checkout')[1].body);
  if (preference) expect(payload.contactless_pref).toBe(preference);
  else expect(payload).not.toHaveProperty('contactless_pref');
});

test('None clears a previously selected handoff, and address changes use order setup', async () => {
  await settle(); await act(async () => button('Leave at door').props.onPress());
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Delivery handoff: None' }).props.onPress());
  await act(async () => button('Change Address').props.onPress()); expect(mockSetup.openOrderSetup).toHaveBeenCalledWith('DELIVERY');
  expect(button('Change Order Details')).toBeUndefined();
  expect(renderer.root.findByType('OrderSetupSummary').props).toMatchObject({ singleLine: true, readOnly: true });
  await act(async () => button('Back to Cart').props.onPress()); expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/cart');
  await act(async () => place().props.onPress());
  expect(JSON.parse(apiFetch.mock.calls.find(call => call[0] === '/api/v1/checkout')[1].body)).not.toHaveProperty('contactless_pref');
});

test.each(['PICKUP', 'DELIVERY'])('%s offers the correct collection methods and keeps online payments hidden', async type => {
  mockCart = { ...mockCart, fulfillmentType: type }; await rerender(); await settle();
  const options = renderer.root.findAllByProps({ accessibilityRole: 'radio' });
  expect(options.map(node => node.props.accessibilityLabel)).toEqual(type === 'PICKUP' ? ['Pay at Store'] : ['Cash on Delivery', 'Card on Delivery']);
  if (type === 'DELIVERY') await act(async () => options[1].props.onPress());
  await act(async () => place().props.onPress());
  expect(JSON.parse(apiFetch.mock.calls.find(call => call[0] === '/api/v1/checkout')[1].body)).toMatchObject({ payment_method: 'PAY_AT_STORE', collection_preference: type === 'PICKUP' ? 'PAY_AT_STORE' : 'CARD_ON_DELIVERY' });
  expect(mockPresentSheet).not.toHaveBeenCalled();
});

const successOrder = { id: 'confirmed-order', order_number: 42, status: 'PLACED', fulfillment_type: 'PICKUP', final_payable_cents: 1000, estimated_ready_at: '2026-10-17T17:00:00Z' };
test('successful order confirms once, clears cart and offers tracking even after setup invalidates', async () => {
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP' }; await rerender(); await settle();
  apiFetch.mockResolvedValue(response(successOrder));
  let request;
  await act(async () => { request = place().props.onPress(); place().props.onPress(); await request; });
  expect(apiFetch.mock.calls.filter(call => call[0] === '/api/v1/checkout')).toHaveLength(1);
  expect(mockCart.clear).toHaveBeenCalledTimes(1); expect(mockPromo.clearAll).toHaveBeenCalledTimes(1);
  mockCart = { ...mockCart, items: [] }; mockSetup.confirmed = false; await rerender();
  expect(text(renderer.toJSON())).toContain('Order #42'); expect(text(renderer.toJSON())).toContain('Order placed');
  expect(place()).toBeUndefined();
  await act(async () => button('Track Order').props.onPress()); expect(mockRouter.replace).toHaveBeenCalledWith('/orders/confirmed-order');
});

test('failed order retains cart and rewards and reuses the idempotency key on retry', async () => {
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP' }; await rerender(); await settle();
  await act(async () => place().props.onPress()); await act(async () => place().props.onPress());
  const requests = apiFetch.mock.calls.filter(call => call[0] === '/api/v1/checkout');
  expect(requests).toHaveLength(2);
  expect(requests[0][1].headers['Idempotency-Key']).toBe(requests[1][1].headers['Idempotency-Key']);
  expect(mockCart.clear).not.toHaveBeenCalled(); expect(mockPromo.clearAll).not.toHaveBeenCalled();
  expect(text(renderer.toJSON())).toContain('Mock checkout stopped'); expect(button('Track Order')).toBeUndefined();
});

test.each([false, true])('authentication resumes only with a fresh matching total (price changes: %s)', async priceChanges => {
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP' }; mockSession = { ...mockSession, authenticated: false };
  await rerender(); await settle(); await act(async () => place().props.onPress());
  expect(renderer.root.findByType('AuthSheet').props.visible).toBe(true); noSubmission();
  expect(renderer.root.findByType('AuthSheet').props.initialStep).toBe('login');
  mockSession = { ...mockSession, authenticated: true, user: { id: 'signed-in' } };
  const original = apiJson.getMockImplementation();
  let release;
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? new Promise(resolve => { release = () => resolve({ data: { ...quote(JSON.parse(init.body)), final_payable_cents: priceChanges ? 1200 : 1000 } }); }) : original(url, init));
  await rerender();
  await act(async () => { const sheet = renderer.root.findByType('AuthSheet'); sheet.props.onComplete(); sheet.props.onClose(); });
  await tick(250); noSubmission();
  await act(async () => release());
  if (priceChanges) { noSubmission(); expect(text(renderer.toJSON())).toContain('Your order changed after sign-in'); }
  else {
    // Resuming still performs the immediate pre-submit quote.
    await act(async () => release());
    expect(apiFetch.mock.calls.filter(call => call[0] === '/api/v1/checkout')).toHaveLength(1);
  }
});

test('dismissing login cancels pending submission', async () => {
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP' }; mockSession = { ...mockSession, authenticated: false };
  await rerender(); await settle(); await act(async () => place().props.onPress());
  await act(async () => renderer.root.findByType('AuthSheet').props.onClose());
  mockSession = { ...mockSession, authenticated: true }; await rerender(); await settle(); noSubmission();
});

test('a stale authenticated session opens login for 401 recovery and reprices without auto-submitting', async () => {
  mockSession.refresh = jest.fn(async () => false);
  mockSession.clear = jest.fn();
  mockPromo.promoCode = 'SAVE';
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote'
    ? Promise.reject(Object.assign(new Error('Authentication failed'), { status: 401 })) : original(url, init));
  const items = mockCart.items, address = mockSetup.deliveryAddress;
  await rerender(); await settle();
  expect(mockSession.authenticated).toBe(true);
  expect(mockSession.refresh).toHaveBeenCalledTimes(1);
  await act(async () => button('Sign in').props.onPress());
  expect(renderer.root.findByType('AuthSheet').props).toMatchObject({ visible: true, initialStep: 'login' });
  // The entry point stays login even if profile flags change during recovery.
  mockSession = { ...mockSession, needsProfileCompletion: true }; await rerender();
  expect(renderer.root.findByType('AuthSheet').props.initialStep).toBe('login');
  mockSession = { ...mockSession, needsProfileCompletion: false };
  const requestsBeforeAuth = quoteRequests().length;
  apiJson.mockImplementation(original);
  await act(async () => { const sheet = renderer.root.findByType('AuthSheet'); sheet.props.onComplete(); sheet.props.onClose(); });
  expect(quoteRequests()).toHaveLength(requestsBeforeAuth);
  expect(place().props.disabled).toBe(true);
  await settle();
  expect(quoteRequests()).toHaveLength(requestsBeforeAuth + 1);
  expect(summary('Payable')).toBe('$10.00'); expect(place().props.disabled).toBe(false);
  expect(mockCart.items).toBe(items); expect(mockSetup.deliveryAddress).toBe(address);
  expect(mockPromo.promoCode).toBe('SAVE'); expect(mockPromo.applyWingsReward).toBe(false);
  expect(mockCart.clear).not.toHaveBeenCalled(); expect(mockPromo.clearAll).not.toHaveBeenCalled();
  expect(mockPromo.clearPromoCode).not.toHaveBeenCalled(); expect(mockSetup.setDeliveryAddress).not.toHaveBeenCalled();
  expect(mockSession.clear).not.toHaveBeenCalled(); noSubmission();
});

test('closing 401 recovery neither clears the session/reward nor submits or starts a retry loop', async () => {
  mockSession.refresh = jest.fn(async () => true); mockSession.clear = jest.fn();
  mockPromo.applyWingsReward = true;
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote'
    ? Promise.reject(Object.assign(new Error('Authentication failed'), { status: 401 })) : original(url, init));
  await rerender(); await settle();
  expect(mockSession.refresh).toHaveBeenCalledTimes(1); expect(quoteRequests()).toHaveLength(2);
  await act(async () => button('Sign in').props.onPress());
  expect(renderer.root.findByType('AuthSheet').props.initialStep).toBe('login');
  await act(async () => renderer.root.findByType('AuthSheet').props.onClose()); await tick(10000);
  expect(renderer.root.findByType('AuthSheet').props.visible).toBe(false);
  expect(quoteRequests()).toHaveLength(2); expect(mockSession.clear).not.toHaveBeenCalled();
  expect(mockPromo.applyWingsReward).toBe(true); expect(mockPromo.clearAll).not.toHaveBeenCalled(); noSubmission();
});

test('legitimate incomplete profiles still enter profile completion and resume through fresh validation', async () => {
  mockSession = { ...mockSession, needsProfileCompletion: true };
  await rerender(); await settle(); await act(async () => place().props.onPress());
  expect(renderer.root.findByType('AuthSheet').props).toMatchObject({ visible: true, initialStep: 'profile' }); noSubmission();
  const requestsBeforeAuth = quoteRequests().length;
  mockSession = { ...mockSession, needsProfileCompletion: false };
  await act(async () => { const sheet = renderer.root.findByType('AuthSheet'); sheet.props.onComplete(); sheet.props.onClose(); });
  await settle();
  expect(quoteRequests().length).toBeGreaterThanOrEqual(requestsBeforeAuth + 2);
  expect(apiFetch.mock.calls.filter(call => call[0] === '/api/v1/checkout')).toHaveLength(1);
});

test('lunch availability rejection and network pricing failure block orders and allow retry', async () => {
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP' };
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? Promise.reject(new Error('Lunch specials are available 11 AM - 3 PM. Change your scheduled time.')) : original(url, init));
  await rerender(); await settle(); expect(place().props.disabled).toBe(true); noSubmission();
  expect(text(renderer.toJSON())).toContain('Lunch specials are available');
  apiJson.mockImplementation(original); await act(async () => button('Retry pricing').props.onPress());
  await settle(); expect(place().props.disabled).toBe(false);
});

test('place order stays outside the scroll view and never shows an unconfirmed total', async () => {
  const dockButton = renderer.root.findByProps({ accessibilityLabel: 'Place order' });
  let parent = dockButton.parent;
  while (parent) { expect(parent.type).not.toBe('ScrollView'); parent = parent.parent; }
  expect(dockButton.props.disabled).toBe(true);
  await settle(); expect(place().props.disabled).toBe(false);
});

test.each([
  [401, 'Authentication failed', 'Sign in'],
  [422, 'Minimum subtotal for delivery is $20.00', 'Add more items'],
])('checkout quote status %s offers the appropriate recovery', async (status, message, label) => {
  mockSession = { ...mockSession, authenticated: false };
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? Promise.reject(Object.assign(new Error(message), { status })) : original(url, init));
  await rerender(); await settle();
  await act(async () => button(label).props.onPress());
  if (label === 'Sign in') expect(renderer.root.findByType('AuthSheet').props.visible).toBe(true);
  else expect(mockRouter.push).toHaveBeenCalledWith('/(tabs)/menu');
  noSubmission();
});

test('failed delivery quote supports retry, attribution, and changing to pickup', async () => {
  apiFetch.mockResolvedValue(response(null, false));
  await settle(); expect(place().props.disabled).toBe(true);
  await act(async () => button('Choose pickup').props.onPress()); expect(mockSetup.openOrderSetup).toHaveBeenCalledWith('PICKUP');
  apiFetch.mockResolvedValue(response({ delivery_quote_token: 'retry', expires_at: new Date(Date.now() + 600000).toISOString(), attribution: 'Google Maps' }));
  await act(async () => button('Retry').props.onPress()); await settle();
  expect(text(renderer.toJSON())).toContain('Calculated using Google Maps'); expect(place().props.disabled).toBe(false);
});

test('a malformed success response never clears the cart or shows confirmation', async () => {
  mockCart = { ...mockCart, fulfillmentType: 'PICKUP' }; await rerender(); await settle();
  apiFetch.mockResolvedValue(response({})); await act(async () => place().props.onPress());
  expect(mockCart.clear).not.toHaveBeenCalled(); expect(mockPromo.clearAll).not.toHaveBeenCalled();
  expect(button('Track Order')).toBeUndefined();
});

test('dormant Stripe never initializes or requests payment configuration even if backend flags are enabled', async () => {
  const { initStripe } = require('@stripe/stripe-react-native');
  await act(async () => renderer.unmount()); renderer = null;
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation(async (url, init) => url.includes('/stripe/config') ? { data: { configured: true, online_payments_enabled: true, publishable_key: 'pk_test_mock' } } : original(url, init));
  await act(async () => { renderer = create(React.createElement(Checkout)); }); await settle();
  expect(initStripe).not.toHaveBeenCalled();
  expect(apiJson.mock.calls.some(([url]) => url.includes('/stripe/'))).toBe(false);
  expect(text(renderer.toJSON())).not.toContain('Pay and place order');
  expect(mockInitSheet).not.toHaveBeenCalled(); expect(mockPresentSheet).not.toHaveBeenCalled();
});

test.each(['missing lines', 'missing price', 'wrong item', 'invalid tax'])('an invalid backend quote (%s) cannot render or authorize a payable total', async problem => {
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation(async (url, init) => {
    if (url !== '/api/v1/cart/quote') return original(url, init);
    const invalid = quote(JSON.parse(init.body));
    if (problem === 'missing lines') delete invalid.lines;
    if (problem === 'missing price') delete invalid.lines[0].line_total_cents;
    if (problem === 'wrong item') invalid.lines[0].menu_item_id = 'other-item';
    if (problem === 'invalid tax') invalid.tax_cents = NaN;
    return { data: invalid };
  });
  await settle(); expect(place().props.disabled).toBe(true); expect(summary('Payable')).toBeUndefined();
  expect(text(renderer.toJSON())).toContain('could not be confirmed'); noSubmission();
});
