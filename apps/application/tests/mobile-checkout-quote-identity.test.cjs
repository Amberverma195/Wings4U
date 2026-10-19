const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockCart, mockSetup, mockPromo, renderer;
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
jest.mock('../src/context/session', () => ({ useSession: () => ({ authenticated: true, needsProfileCompletion: false }), withSilentRefresh: callback => callback() }));
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
  mockCart = { ...mockCart, items: [{ ...mockCart.items[0], quantity: 2 }], driverTipPercent: 10 };
  mockPromo = { ...mockPromo, promoCode: 'NEW' }; await rerender();
  expect(place().props.disabled).toBe(true); await settle();
  await act(async () => release({ data: { ...quote({ items: [{ quantity: 1 }], driver_tip_cents: 0 }), final_payable_cents: 1 } }));
  await settle(); expect(place().props.disabled).toBe(false);
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
