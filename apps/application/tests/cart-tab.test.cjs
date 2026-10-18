const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockCart, mockSession, mockFocused, mockSetup;
const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useIsFocused: () => mockFocused }));
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView', Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View',
  StyleSheet: { create: value => value },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('lucide-react-native', () => ({ Minus: 'Minus', Plus: 'Plus', ShoppingBag: 'ShoppingBag', Trash2: 'Trash2' }));
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession }));
jest.mock('../src/context/order-setup', () => ({ useOrderSetup: () => mockSetup }));
jest.mock('../src/components/order-setup-summary', () => ({ OrderSetupSummary: 'OrderSetupSummary' }));
const mockPromo = { promoCode: null, applyWingsReward: false };
jest.mock('../src/context/promo', () => ({ usePromo: () => mockPromo }));
jest.mock('../src/hooks/use-account-data', () => ({ useAccountData: () => ({ data: { promos: [], wingsRewards: null } }) }));
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }));
const { apiJson } = require('../src/lib/api');
const CartTab = require('../app/(tabs)/cart').default;
let renderer;
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => node.findAllByType('Text').some(text => text.children.join('') === label));
const rerender = async () => act(async () => renderer.update(React.createElement(CartTab)));
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockFocused = true;
  jest.setSystemTime(Date.parse('2026-10-17T16:00:00Z'));
  mockSession = { loaded: true, authenticated: false };
  mockCart = { items: [{ key: 'wings', menu_item_id: 'wings', name: 'Wings', base_price_cents: 1000, quantity: 1,
    modifier_selections: [], special_instructions: '' }], locationId: 'store', fulfillmentType: 'PICKUP',
    scheduledFor: null, driverTipPercent: 'none', isCartHydrating: false, isCartHydrated: true, updateQuantity: jest.fn(), removeItem: jest.fn() };
  mockSetup = { ready: true, confirmed: true, openOrderSetup: jest.fn(),
    getConfirmedSetup: () => mockSetup.confirmed ? { fulfillmentType: mockCart.fulfillmentType, scheduledFor: mockCart.scheduledFor, deliveryAddress: null } : null,
    ensureOrderSetup: jest.fn(async () => mockSetup.getConfirmedSetup()), hasCheckoutValidation: () => false, markCheckoutValidated: jest.fn() };
  apiJson.mockImplementation(async url => ({ data: url.startsWith('/api/v1/menu?') ? {
    location: { timezone: 'America/Toronto', is_open: true, pickup_min_minutes: 15, estimated_prep_minutes: 15,
      pickup_hours: Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, time_from: '00:00', time_to: '00:00', is_closed: false })), store_hours: [] },
    categories: [{ items: [{ id: 'wings', is_available: true, stock_status: 'NORMAL', allowed_fulfillment_type: 'BOTH' }] }],
  } : { item_subtotal_cents: 1000, tax_cents: 130, final_payable_cents: 1130, lines: [{ menu_item_id: 'wings', quantity: 1 }] } }));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.useRealTimers(); });
const mount = async () => act(async () => { renderer = create(React.createElement(CartTab)); });

test.each([false, true])('guest/authenticated Cart still prices its items and opens the stack checkout (authenticated: %s)', async authenticated => {
  mockSession.authenticated = authenticated;
  mockCart.scheduledFor = '2026-10-18T17:00:00.000Z';
  await mount();
  expect(button('Checkout').props.disabled).toBe(false); // Setup must remain reachable even before a browsing quote.
  await act(async () => jest.advanceTimersByTime(250));
  expect(button('Checkout').props.disabled).toBe(false);
  expect(JSON.parse(apiJson.mock.calls[0][1].body)).toMatchObject({
    fulfillment_type: 'PICKUP', scheduled_for: mockCart.scheduledFor,
    items: [{ menu_item_id: 'wings', quantity: 1 }],
  });
  await act(async () => button('Checkout').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith('/checkout');
  expect(mockCart.items).toHaveLength(1);
});

test('empty Cart keeps Browse menu available, and pricing errors still block checkout', async () => {
  mockCart.items = []; await mount();
  expect(button('Checkout')).toBeUndefined();
  expect(button('Browse menu')).toBeDefined();
  await act(async () => renderer.unmount()); renderer = null;
  mockCart.items = [{ key: 'wings', menu_item_id: 'wings', name: 'Wings', base_price_cents: 1000, quantity: 1,
    modifier_selections: [], special_instructions: '' }];
  apiJson.mockRejectedValue(new Error('Unavailable item')); await mount();
  await act(async () => jest.advanceTimersByTime(250));
  await act(async () => button('Checkout').props.onPress());
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(button('Checkout').props.disabled).toBe(false); // Allow a deliberate retry.
});

test('saved out-of-stock lines show recovery and can be removed without deleting companion items', async () => {
  const untouched = { ...mockCart.items[0], key: 'burger', menu_item_id: 'burger', name: 'Burger', quantity: 3 };
  mockCart.items = [mockCart.items[0], untouched];
  const original = apiJson.getMockImplementation();
  const message = 'Wings is currently out of stock. Please remove it or choose another item.';
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? Promise.reject(Object.assign(new Error(message), {
    body: { errors: [{ code: 'CART_ITEM_UNAVAILABLE', message, detail: { affected_item_ids: ['wings'], affected_item_indices: [0] } }] },
  })) : original(url, init));
  await mount(); await act(async () => jest.advanceTimersByTime(250));
  expect(renderer.root.findAllByType('Text').some(node => node.children.join('') === message)).toBe(true);
  await act(async () => button('Checkout').props.onPress()); expect(mockRouter.push).not.toHaveBeenCalled();
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Remove Wings' }).props.onPress());
  expect(mockCart.removeItem).toHaveBeenCalledWith('wings'); expect(mockCart.removeItem).toHaveBeenCalledTimes(1);
  expect(mockCart.items[1]).toBe(untouched); expect(untouched.quantity).toBe(3);
});

test.each([false, true].flatMap(authenticated => ['old 75-wing weight / missing fields', 'old 100-wing weight', 'inactive modifier', 'invalid flavour'].map(problem => ({ authenticated, problem }))))('saved $problem recovers individually without losing other lines (authenticated=$authenticated)', async ({ authenticated, problem }) => {
  mockSession.authenticated = authenticated;
  const untouched = { ...mockCart.items[0], key: 'burger', menu_item_id: 'burger', name: 'Burger', quantity: 3 };
  const outdated = { ...mockCart.items[0], key: 'party', menu_item_id: 'party-75', name: '75 Wings', quantity: 2,
    builder_payload: { builder_type: 'WINGS', weight_lb: 5 } }; // Missing flavour fields must remain renderable.
  if (problem === 'old 100-wing weight') Object.assign(outdated, { menu_item_id: 'party-100', name: '100 Wings', builder_payload: { builder_type: 'WINGS', weight_lb: 6.67 } });
  if (problem === 'inactive modifier') outdated.modifier_selections = [{ modifier_option_id: 'removed-paid', group_name: 'Extras', option_name: 'Extra cheese', price_delta_cents: 150 }];
  if (problem === 'invalid flavour') outdated.builder_payload.flavour_slots = [{ slot_no: 1, wing_flavour_id: 'removed-flavour', flavour_name: 'Old sauce' }];
  mockCart.items = [outdated, untouched];
  const message = `Your ${outdated.name} selection needs updating because our menu options have changed. Please review this item before checkout.`;
  let rejected = true;
  apiJson.mockImplementation(async (url, init) => {
    const request = init?.body ? JSON.parse(init.body) : null;
    if (request?.items && rejected) {
      throw Object.assign(new Error(message), { body: { errors: [{ code: 'CART_ITEM_CONFIGURATION_INVALID', message,
        detail: { affected_item_ids: ['party-75'], affected_item_indices: [0] } }] } });
    }
    return { data: { item_subtotal_cents: 20998, final_payable_cents: 20998, lines: request?.items ?? [] } };
  });
  await mount(); await act(async () => jest.advanceTimersByTime(250));
  const name = renderer.root.findAllByType('Text').find(node => node.children.join('') === outdated.name);
  expect(name.parent.parent.parent.findAllByType('Text').map(node => node.children.join('')).join(' ')).toContain(message);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: `Edit ${outdated.name}` }).props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/menu', params: { editKey: 'party', ts: expect.any(String) } });
  expect(mockCart.items[1]).toBe(untouched); expect(mockCart.removeItem).not.toHaveBeenCalled();
  rejected = false;
  mockCart = { ...mockCart, items: [{ ...outdated, modifier_selections: [], builder_payload: { builder_type: 'WINGS', weight_lb: problem === 'old 100-wing weight' ? 11 : 8, flavour_slots: [] } }, untouched] };
  await rerender(); await act(async () => jest.advanceTimersByTime(250));
  expect(renderer.root.findAllByType('Text').some(node => node.children.join('') === message)).toBe(false);
  expect(mockCart.items.map(item => item.quantity)).toEqual([2, 3]);
});

test('unconfirmed browsing checkout asks for setup, and cancelling does not navigate or lose items', async () => {
  mockSetup.confirmed = false;
  mockSetup.ensureOrderSetup.mockResolvedValue(null);
  await mount();
  await act(async () => button('Checkout').props.onPress());
  expect(mockSetup.ensureOrderSetup).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(apiJson).not.toHaveBeenCalled();
  expect(mockCart.items).toHaveLength(1);
});

test('successful confirmation resumes checkout only after fresh APIs validate the selected setup', async () => {
  mockSetup.confirmed = false;
  mockSetup.ensureOrderSetup.mockImplementation(async () => { mockSetup.confirmed = true; return mockSetup.getConfirmedSetup(); });
  await mount();
  await act(async () => button('Checkout').props.onPress());
  expect(apiJson.mock.calls.map(call => call[0])).toEqual([expect.stringContaining('/api/v1/menu?'), '/api/v1/cart/quote']);
  expect(mockSetup.markCheckoutValidated).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).toHaveBeenCalledTimes(1);
});

test('repeated checkout taps cannot start duplicate validation or navigation', async () => {
  let release;
  mockSetup.ensureOrderSetup.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  await mount();
  const start = button('Checkout').props.onPress;
  let first, second;
  await act(async () => { first = start(); second = start(); });
  expect(mockSetup.ensureOrderSetup).toHaveBeenCalledTimes(1);
  await act(async () => { release(mockSetup.getConfirmedSetup()); await first; await second; });
  expect(mockRouter.push).toHaveBeenCalledTimes(1);
});

test('leaving Cart while validation waits prevents a late checkout navigation', async () => {
  let release, request;
  mockSetup.ensureOrderSetup.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  await mount();
  await act(async () => { request = button('Checkout').props.onPress(); });
  mockFocused = false; await rerender();
  await act(async () => { release(mockSetup.getConfirmedSetup()); await request; });
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('cart edits during server validation invalidate the pending checkout attempt', async () => {
  const original = apiJson.getMockImplementation();
  let release, request;
  apiJson.mockImplementation(url => url === '/api/v1/cart/quote' ? new Promise(resolve => { release = resolve; }) : original(url));
  await mount();
  await act(async () => { request = button('Checkout').props.onPress(); });
  mockCart = { ...mockCart, items: [{ ...mockCart.items[0], quantity: 2 }] }; await rerender();
  await act(async () => { release({ data: { final_payable_cents: 1130, lines: [{ menu_item_id: 'wings', quantity: 1 }] } }); await request; });
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockSetup.markCheckoutValidated).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType('Text').some(node => node.children.join('').includes('cart or order details changed'))).toBe(true);
});

test('an inactive Cart does not override the active screen’s status bar', async () => {
  await mount(); mockFocused = false; await rerender();
  expect(renderer.root.findAllByType('StatusBar')).toHaveLength(0);
});
