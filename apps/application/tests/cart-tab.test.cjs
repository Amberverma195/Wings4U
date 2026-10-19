const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockCart, mockSession, mockFocused, mockSetup, mockOffers, mockRewards;
const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useIsFocused: () => mockFocused }));
jest.mock('react-native', () => ({
  Image: 'Image', Pressable: 'Pressable', Modal: ({ visible, children }) => visible ? require('react').createElement('Modal', {}, children) : null, ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView', Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View',
  StyleSheet: { create: value => value },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('lucide-react-native', () => ({ Minus: 'Minus', Plus: 'Plus', ShoppingBag: 'ShoppingBag', Trash2: 'Trash2' }));
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession }));
jest.mock('../src/context/order-setup', () => ({ useOrderSetup: () => mockSetup }));
jest.mock('../src/components/order-setup-summary', () => ({ OrderSetupSummary: 'OrderSetupSummary' }));
jest.mock('../src/components/auth-sheet', () => ({ AuthSheet: 'AuthSheet' }));
const mockPromo = { promoCode: null, applyWingsReward: false };
jest.mock('../src/context/promo', () => ({ usePromo: () => mockPromo }));
jest.mock('../src/hooks/use-account-data', () => ({ useAccountData: () => ({ data: { promos: [], wingsRewards: mockRewards } }) }));
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }));
const { apiJson } = require('../src/lib/api');
const CartTab = require('../app/(tabs)/cart').default;
let renderer;
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => node.findAllByType('Text').some(text => text.children.join('') === label));
const rerender = async () => act(async () => renderer.update(React.createElement(CartTab)));
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockFocused = true;
  jest.setSystemTime(Date.parse('2026-10-17T16:00:00Z'));
  mockSession = { loaded: true, authenticated: false, user: { id: 'customer-a' }, refresh: jest.fn(async () => true) };
  mockOffers = []; mockRewards = null;
  Object.assign(mockPromo, { promoCode: null, applyWingsReward: false, hydrated: true,
    applyPromoCode: jest.fn(code => { mockPromo.promoCode = code; mockPromo.applyWingsReward = false; }),
    redeemWingsReward: jest.fn(() => { mockPromo.promoCode = null; mockPromo.applyWingsReward = true; }),
    clearPromoCode: jest.fn(() => { mockPromo.promoCode = null; }),
    clearAll: jest.fn(() => { mockPromo.promoCode = null; mockPromo.applyWingsReward = false; }),
  });
  mockCart = { items: [{ key: 'wings', menu_item_id: 'wings', name: 'Wings', base_price_cents: 1000, quantity: 1,
    modifier_selections: [], special_instructions: '' }], locationId: 'store', fulfillmentType: 'PICKUP',
    scheduledFor: null, driverTipPercent: 'none', isCartHydrating: false, isCartHydrated: true, updateQuantity: jest.fn(), removeItem: jest.fn(), setDriverTipPercent: jest.fn(value => { mockCart = { ...mockCart, driverTipPercent: value }; }) };
  mockSetup = { ready: true, confirmed: true, openOrderSetup: jest.fn(),
    getConfirmedSetup: () => mockSetup.confirmed ? { fulfillmentType: mockCart.fulfillmentType, scheduledFor: mockCart.scheduledFor, deliveryAddress: null } : null,
    ensureOrderSetup: jest.fn(async () => mockSetup.getConfirmedSetup()), hasCheckoutValidation: () => false, markCheckoutValidated: jest.fn() };
  apiJson.mockImplementation(async (url, init) => ({ data: url.startsWith('/api/v1/promotions/active') ? mockOffers : url === '/api/v1/rewards/me' ? mockRewards : url.startsWith('/api/v1/menu?') ? {
    location: { timezone: 'America/Toronto', is_open: true, pickup_min_minutes: 15, estimated_prep_minutes: 15,
      pickup_hours: Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, time_from: '00:00', time_to: '00:00', is_closed: false })), store_hours: [] },
    categories: [{ items: [{ id: 'wings', is_available: true, stock_status: 'NORMAL', allowed_fulfillment_type: 'BOTH' }] }],
  } : { item_subtotal_cents: 1000, tax_cents: 130, delivery_fee_cents: 500, delivery_fee_is_estimate: true, driver_tip_cents: init?.body ? JSON.parse(init.body).driver_tip_cents : 0, final_payable_cents: 1130, lines: [{ menu_item_id: 'wings', quantity: 1 }] } }));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.useRealTimers(); });
const mount = async () => act(async () => { renderer = create(React.createElement(CartTab)); });

test.each([
  [401, {}, 'Authentication failed', 'Sign in'],
  [422, { field: 'fulfillment_type' }, 'Minimum subtotal for delivery is $20.00', 'Add more items'],
])('pricing failure %s offers the correct recovery destination', async (status, row, message, label) => {
  apiJson.mockRejectedValue(Object.assign(new Error(message), { status, body: { errors: [{ ...row, message }] } }));
  await mount(); await act(async () => jest.advanceTimersByTime(250));
  expect(button('Review order details')).toBeUndefined();
  await act(async () => button(label).props.onPress());
  if (label === 'Sign in') {
    expect(renderer.root.findByType('AuthSheet').props.visible).toBe(true);
    expect(mockRouter.push).not.toHaveBeenCalled();
  } else {
    expect(mockRouter.push).toHaveBeenCalledWith('/(tabs)/menu');
  }
  expect(mockSetup.openOrderSetup).not.toHaveBeenCalled();
});

test('quantity buttons announce and apply the correct change', async () => {
  await mount();
  const decrease = renderer.root.findByProps({ accessibilityLabel: 'Decrease Wings quantity' });
  const increase = renderer.root.findByProps({ accessibilityLabel: 'Increase Wings quantity' });
  expect(decrease.props.accessibilityRole).toBe('button');
  expect(increase.props.accessibilityRole).toBe('button');
  await act(async () => { decrease.props.onPress(); increase.props.onPress(); });
  expect(mockCart.updateQuantity.mock.calls).toEqual([['wings', 0], ['wings', 2]]);
});

const renderedText = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(renderedText).join('') : node?.children ? node.children.map(renderedText).join('') : '';
test('pickup has no delivery fee row', async () => {
  await mount(); await act(async () => jest.advanceTimersByTime(250));
  expect(renderedText(renderer.toJSON())).not.toContain('Delivery fee');
});
test.each(['pending', 'unavailable', 'estimated', 'confirmed', 'coupon', 'threshold', 'waived-zero'])('cart delivery fee presentation: %s', async mode => {
  mockCart.fulfillmentType = 'DELIVERY';
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation(async (url, init) => {
    if (url !== '/api/v1/cart/quote') return original(url, init);
    if (mode === 'pending') return new Promise(() => {});
    if (mode === 'unavailable') throw new Error('Quote unavailable');
    return { data: { item_subtotal_cents: 1000, tax_cents: 130, final_payable_cents: 1905, lines: [],
      delivery_fee_cents: ['coupon', 'threshold', 'waived-zero'].includes(mode) ? 0 : 775,
      delivery_fee_stated_cents: mode === 'waived-zero' ? 0 : 775,
      delivery_fee_waived: ['coupon', 'threshold', 'waived-zero'].includes(mode), delivery_fee_is_estimate: mode !== 'confirmed',
      applied_promo_code: mode === 'coupon' ? 'FREEDEL' : undefined } };
  });
  await mount(); await act(async () => jest.advanceTimersByTime(250));
  const output = renderedText(renderer.toJSON());
  expect(output).not.toContain('$7.75');
  if (mode === 'pending' || mode === 'unavailable') {
    expect(output).not.toContain('Delivery fee');
    expect(output).not.toContain('Free');
  } else if (['estimated', 'confirmed', 'waived-zero'].includes(mode)) {
    expect(output).toContain('From $5 — calculated at checkout');
    expect(output).not.toContain('Free');
  } else {
    expect(output).toContain('From $5 Free');
    expect(renderer.root.findAllByType('Text').some(node => node.props.style?.textDecorationLine === 'line-through')).toBe(true);
  }
});

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
  await act(async () => { release({ data: { item_subtotal_cents: 1000, final_payable_cents: 1130, lines: [{ menu_item_id: 'wings', quantity: 1 }] } }); await request; });
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockSetup.markCheckoutValidated).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType('Text').some(node => node.children.join('').includes('cart or order details changed'))).toBe(true);
});

test('an inactive Cart does not override the active screen’s status bar', async () => {
  await mount(); mockFocused = false; await rerender();
  expect(renderer.root.findAllByType('StatusBar')).toHaveLength(0);
});

const textOf = node => typeof node === 'string' ? node : node?.children?.map(textOf).join('') ?? '';
const screenText = () => textOf(renderer.toJSON());
const press = async label => act(async () => renderer.root.findByProps({ accessibilityLabel: label }).props.onPress());
const coupon = (code, extra = {}) => ({ id: code, code, name: code + ' offer', discountType: 'PERCENT', discountValue: 10,
  minSubtotalCents: 1000, endsAt: null, eligibleFulfillmentType: 'BOTH', bxgyRule: null, ...extra });
const openCoupons = () => press('See coupons & rewards');
const quoteCalls = () => apiJson.mock.calls.filter(call => call[0] === '/api/v1/cart/quote');

test('counts quantities, shows the summary action with zero coupons, and reopens a dismissible accessible modal', async () => {
  mockCart.items[0].quantity = 3;
  await mount();
  expect(screenText()).toContain('Your Order3 items'); expect(screenText()).toContain('Order Summary');
  expect(button('See coupons & rewards')).toBeDefined(); expect(screenText()).not.toContain('Available Coupons');
  await openCoupons(); expect(screenText()).toContain('Available Coupons'); expect(screenText()).toContain('No coupons yet');
  expect(renderer.root.findByProps({ accessibilityViewIsModal: true })).toBeDefined();
  await press('Close coupons'); expect(screenText()).not.toContain('Available Coupons');
  await openCoupons(); expect(apiJson.mock.calls.filter(call => call[0].startsWith('/api/v1/promotions/active'))).toHaveLength(2);
  await act(async () => renderer.root.findByType('Modal').parent.props.onRequestClose());
  expect(screenText()).not.toContain('Available Coupons');
});

test('shows live loading, retry, and all server promotion types including automatic and first-order offers', async () => {
  let release;
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url.startsWith('/api/v1/promotions/active') ? new Promise(resolve => { release = resolve; }) : original(url, init));
  await mount(); await openCoupons(); expect(screenText()).toContain('Checking coupons');
  await act(async () => release({ data: [coupon('PCT'), coupon('FIX', { discountType: 'FIXED_AMOUNT', discountValue: 500 }),
    coupon('DEL', { discountType: 'FREE_DELIVERY', eligibleFulfillmentType: 'DELIVERY' }),
    coupon('BXGY', { discountType: 'BXGY', bxgyRule: { requiredQty: 2, rewardQty: 1, qualifyingLabel: '1lb wings', rewardLabel: 'Fries' } }),
    coupon('FIRST', { name: 'First order offer' }), coupon('AUTO', { autoApply: true }), coupon('EXPIRED', { endsAt: '2020-01-01' })] }));
  for (const label of ['10% OFF', '$5.00 OFF', 'FREE DELIVERY', 'Buy 2: 1lb wings', 'First order offer', 'Auto', 'Delivery only']) expect(screenText()).toContain(label);
  expect(screenText()).not.toContain('EXPIRED');
  expect(renderer.root.findByProps({ accessibilityLabel: 'Apply coupon AUTO' }).props.disabled).toBe(true);
  await press('Close coupons');
  apiJson.mockImplementation((url, init) => url.startsWith('/api/v1/promotions/active') ? Promise.reject(new Error('Offers unavailable')) : original(url, init));
  await openCoupons(); expect(screenText()).toContain('Offers unavailable');
  apiJson.mockImplementation(original); await act(async () => button('Retry coupons').props.onPress()); expect(screenText()).toContain('No coupons yet');
});

test.each([false, true])('refreshes the selected location and preserves guest/account-specific visibility (auth=%s)', async authenticated => {
  mockSession.authenticated = authenticated;
  mockOffers = [coupon(authenticated ? 'FIRST-ORDER' : 'PUBLIC')]; mockRewards = { available_stamps: 8, stamps_per_reward: 8 };
  await mount(); await openCoupons();
  expect(screenText()).toContain(authenticated ? 'FIRST-ORDER' : 'PUBLIC');
  expect(screenText().includes('Get 1lb of wings free')).toBe(authenticated);
  expect(apiJson.mock.calls.find(call => call[0].startsWith('/api/v1/promotions/active'))[1].locationId).toBe('store');
  mockCart = { ...mockCart, locationId: 'other-store' }; await rerender();
  expect(apiJson.mock.calls.filter(call => call[0].startsWith('/api/v1/promotions/active')).at(-1)[1].locationId).toBe('other-store');
});

test('only commits a confirmed coupon, rejects duplicates and preserves the old valid selection on replacement failure', async () => {
  mockPromo.promoCode = 'OLD'; mockOffers = [coupon('NEW')];
  let release;
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? new Promise(resolve => { release = resolve; }) : original(url, init));
  await mount(); await openCoupons();
  const apply = renderer.root.findByProps({ accessibilityLabel: 'Apply coupon NEW' }).props.onPress;
  await act(async () => { apply(); apply(); });
  expect(quoteCalls()).toHaveLength(1); expect(mockPromo.promoCode).toBe('OLD'); expect(screenText()).toContain('Validating');
  await act(async () => release({ data: { item_subtotal_cents: 1000, final_payable_cents: 1000, applied_promo_code: 'AUTO, NEW' } }));
  expect(mockPromo.promoCode).toBe('NEW'); expect(screenText()).not.toContain('Available Coupons');
  mockOffers = [coupon('BAD')]; apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? Promise.reject(new Error('Invalid or expired promo code')) : original(url, init));
  await openCoupons(); await press('Apply coupon BAD');
  expect(mockPromo.promoCode).toBe('NEW'); expect(screenText()).toContain('Invalid or expired promo code'); expect(screenText()).toContain('Available Coupons');
});

test.each(['location', 'items', 'tip', 'account', 'close'])('discards a late coupon response after changing %s', async change => {
  mockOffers = [coupon('SAVE')]; let release; const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? new Promise(resolve => { release = resolve; }) : original(url, init));
  await mount(); await openCoupons(); await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Apply coupon SAVE' }).props.onPress());
  if (change === 'location') mockCart = { ...mockCart, locationId: 'different-store' };
  if (change === 'items') mockCart = { ...mockCart, items: [{ ...mockCart.items[0], quantity: 2 }] };
  if (change === 'tip') mockCart = { ...mockCart, driverTipPercent: 15 };
  if (change === 'account') mockSession = { ...mockSession, authenticated: true, user: { id: 'customer-b' } };
  if (change === 'close') await press('Close coupons'); else await rerender();
  await act(async () => release({ data: { item_subtotal_cents: 1000, final_payable_cents: 1, applied_promo_code: 'SAVE' } }));
  expect(mockPromo.applyPromoCode).not.toHaveBeenCalled(); expect(screenText()).not.toContain('$0.01');
});

test.each(['NO_WINGS_IN_CART', 'NOT_ENOUGH_STAMPS', 'NOT_SIGNED_IN', 'applied'])('validates earned reward and handles %s without deducting stamps', async reason => {
  mockSession.authenticated = true; mockRewards = { available_stamps: 8, stamps_per_reward: 8 }; mockPromo.promoCode = 'OLD';
  const original = apiJson.getMockImplementation();
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? Promise.resolve({ data: { item_subtotal_cents: 1000, final_payable_cents: 100,
    wings_reward: { applied: reason === 'applied', discount_cents: 900, not_eligible_reason: reason === 'applied' ? null : reason } } }) : original(url, init));
  await mount(); await openCoupons(); await press('Apply Wings Reward');
  expect(JSON.parse(quoteCalls()[0][1].body)).toMatchObject({ apply_wings_reward: true });
  expect(JSON.parse(quoteCalls()[0][1].body).promo_code).toBeUndefined();
  if (reason === 'applied') { expect(mockPromo.applyWingsReward).toBe(true); expect(mockPromo.promoCode).toBeNull(); }
  else { expect(mockPromo.applyWingsReward).toBe(false); expect(mockPromo.promoCode).toBe('OLD'); }
  if (reason === 'NO_WINGS_IN_CART') {
    expect(screenText()).toContain('No relevant item in the cart'); await act(async () => button('Add to cart').props.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/menu', params: { category: 'wings', promotion: 'reward', ts: expect.any(String) } });
  }
  expect(mockRewards.available_stamps).toBe(8);
});

test.each(['none', 10, 15, 20])('cart tip %s invalidates authoritative pricing and requotes for pickup', async tip => {
  await mount(); await act(async () => jest.advanceTimersByTime(250));
  await press(tip === 'none' ? 'No tip' : `Tip ${tip}%`); await rerender();
  await act(async () => jest.advanceTimersByTime(250));
  expect(mockCart.setDriverTipPercent).toHaveBeenCalledWith(tip);
  expect(JSON.parse(quoteCalls().at(-1)[1].body).driver_tip_cents).toBe(tip === 'none' ? 0 : 1000 * tip / 100);
});

const summaryAmount = label => {
  const node = renderer.root.findAllByType('Text').find(node => textOf(node) === label);
  return node ? textOf(node.parent.findAllByType('Text').at(-1)) : undefined;
};
test('tip refresh keeps the entire server breakdown visible and sends only the latest tip', async () => {
  mockCart.fulfillmentType = 'DELIVERY';
  const original = apiJson.getMockImplementation();
  const priced = tip => ({ item_subtotal_cents: 1000, tax_cents: 83 + tip, delivery_fee_cents: 675, delivery_fee_stated_cents: 675,
    delivery_fee_is_estimate: true, driver_tip_cents: tip, final_payable_cents: 1758 + 2 * tip,
    applied_promo_code: 'AUTO', promo_discount_cents: 100, lines: [{ menu_item_id: 'wings', quantity: 1, line_total_cents: 1000 }] });
  apiJson.mockImplementation(async (url, init) => url === '/api/v1/cart/quote' ? { data: priced(JSON.parse(init.body).driver_tip_cents) } : original(url, init));
  await mount(); await act(async () => jest.advanceTimersByTime(250));
  expect(summaryAmount('Tax')).toBe('$0.83'); expect(summaryAmount('Estimated total')).toBe('$17.58');
  let release;
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? new Promise(resolve => { release = () => resolve({ data: priced(JSON.parse(init.body).driver_tip_cents) }); }) : original(url, init));
  await press('Tip 20%'); await rerender();
  expect(renderer.root.findByProps({ accessibilityLabel: 'Tip 20%' }).props.accessibilityState.selected).toBe(true);
  expect(summaryAmount('Tax')).toBe('$0.83'); expect(summaryAmount('Estimated total')).toBe('$17.58');
  expect(summaryAmount('Promo code (AUTO)')).toBe('-$1.00'); expect(screenText()).not.toContain('Updating?');
  expect(screenText()).not.toContain('...'); expect(screenText()).toContain('Previous amounts shown');
  const coupons = renderer.root.findAll(node => node.type?.name === 'CartCoupons')[0];
  expect(coupons.props.quote).toBeNull();
  await act(async () => jest.advanceTimersByTime(250)); await act(async () => release());
  expect(summaryAmount('Tax')).toBe('$2.83'); expect(summaryAmount('Tip')).toBe('$2.00'); expect(summaryAmount('Estimated total')).toBe('$21.58');
  expect(summaryAmount('Delivery fee')).toBe('From $5 — calculated at checkout'); expect(screenText()).not.toContain('Previous amounts shown');
});

test.each(['PICKUP', 'DELIVERY'])('closed-store %s errors offer order setup instead of generic pricing retry', async type => {
  mockCart.fulfillmentType = type;
  const message = `The store is not open for ${type.toLowerCase()} at the selected time.`;
  apiJson.mockRejectedValue(Object.assign(new Error(message), { status: 422, body: { errors: [{ field: 'scheduled_for', message }] } }));
  await mount(); await act(async () => jest.advanceTimersByTime(250));
  expect(screenText()).toContain(message); expect(button('Retry pricing')).toBeUndefined(); expect(summaryAmount('Tax')).toBe('Unavailable');
  await act(async () => button('Change order time').props.onPress()); expect(mockSetup.openOrderSetup).toHaveBeenCalledWith(type);
  expect(mockRouter.push).not.toHaveBeenCalled(); expect(mockCart.scheduledFor).toBeNull();
});
test('temporary failures retain a visible retry action and can recover', async () => {
  apiJson.mockRejectedValueOnce(new Error('Network unavailable')); await mount(); await act(async () => jest.advanceTimersByTime(250));
  expect(button('Retry pricing')).toBeDefined(); expect(screenText()).toContain('Network unavailable');
  expect(summaryAmount('Tax')).toBe('Unavailable'); expect(summaryAmount('Est. Subtotal')).toBe('$10.00');
  await act(async () => button('Retry pricing').props.onPress()); await act(async () => jest.advanceTimersByTime(250));
  expect(summaryAmount('Tax')).toBe('$1.30'); expect(button('Retry pricing')).toBeUndefined();
});
test('a retained tip quote cannot bypass fresh checkout validation while pricing is pending', async () => {
  await mount(); await act(async () => jest.advanceTimersByTime(250));
  const original = apiJson.getMockImplementation(); let rejectQuote;
  apiJson.mockImplementation((url, init) => url === '/api/v1/cart/quote' ? new Promise((_resolve, reject) => { rejectQuote = reject; }) : original(url, init));
  await press('Tip 10%'); await rerender(); expect(summaryAmount('Tax')).toBe('$1.30');
  let submitting; await act(async () => { submitting = button('Checkout').props.onPress(); });
  expect(mockSetup.ensureOrderSetup).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).not.toHaveBeenCalled(); expect(mockSetup.markCheckoutValidated).not.toHaveBeenCalled();
  await act(async () => { rejectQuote(new Error('The store is not open for pickup at the selected time.')); await submitting; });
  expect(mockRouter.push).not.toHaveBeenCalled(); expect(mockSetup.markCheckoutValidated).not.toHaveBeenCalled();
  await act(async () => button('Change order time').props.onPress()); expect(mockSetup.openOrderSetup).toHaveBeenCalledWith('PICKUP');
});

test('unknown pricing does not claim zero tax, free delivery or a confirmed total', async () => {
  mockCart.fulfillmentType = 'DELIVERY'; apiJson.mockImplementation(() => new Promise(() => {}));
  await mount(); expect(screenText()).not.toContain('Delivery fee'); expect(screenText()).not.toContain('Free');
  expect(screenText()).toContain('Est. Subtotal');
});

test('server line prices, rewards, automatic discounts and totals are displayed without discount arithmetic on the client', async () => {
  apiJson.mockResolvedValue({ data: { item_subtotal_cents: 2000, item_discount_total_cents: 400, order_discount_total_cents: 300,
    promo_discount_cents: 300, applied_promo_code: 'SAVE, AUTO', tax_cents: 130, final_payable_cents: 1430,
    driver_tip_cents: 0, lines: [{ menu_item_id: 'wings', quantity: 1, line_total_cents: 2000 }],
    wings_reward: { applied: true, discount_cents: 400 } } });
  await mount(); await act(async () => jest.advanceTimersByTime(250));
  expect(screenText()).toContain('Wings reward (1lb free)-$4.00');
  expect(screenText()).toContain('Promo code (SAVE, AUTO)-$3.00');
  expect(screenText()).toContain('Total$14.30');
  expect(renderer.root.findAllByType('Text').filter(node => textOf(node) === '$20.00')).toHaveLength(2);
});

test('an older background rejection cannot clear a newly confirmed selection of the same coupon', async () => {
  mockPromo.promoCode = 'SAVE'; mockOffers = [coupon('SAVE')];
  let rejectOld; const original = apiJson.getMockImplementation(); let quotes = 0;
  apiJson.mockImplementation((url, init) => {
    if (url !== '/api/v1/cart/quote') return original(url, init);
    if (++quotes === 1) return new Promise((resolve, reject) => { rejectOld = reject; });
    return Promise.resolve({ data: { item_subtotal_cents: 1000, final_payable_cents: 900, applied_promo_code: 'SAVE' } });
  });
  await mount(); await act(async () => jest.advanceTimersByTime(250));
  await openCoupons(); await press('Apply coupon SAVE');
  await act(async () => rejectOld(new Error('Invalid or expired promo code')));
  expect(mockPromo.clearPromoCode).not.toHaveBeenCalled(); expect(mockPromo.promoCode).toBe('SAVE');
});
