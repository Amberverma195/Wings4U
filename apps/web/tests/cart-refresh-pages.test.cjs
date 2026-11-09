const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, renderer, cart, storage;
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }) => require('react').createElement('a', props, children) }));
jest.mock('@/lib/session', () => ({ useSession: () => mockSession, withSilentRefresh: fn => fn() }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn(), apiJson: jest.fn(), getApiErrorMessage: () => 'API error' }));
jest.mock('@/lib/saved-cart-api', () => ({ fetchSavedCart: jest.fn(), putSavedCart: jest.fn(), mergeSavedCartOnLogin: jest.fn(), cancelDeferredSavedCartWrite: jest.fn(), deleteSavedCart: jest.fn() }));
jest.mock('@/components/customer-auth', () => ({ CustomerAuth: () => null }));
jest.mock('../src/app/checkout/contactless-preference-combo', () => ({ ContactlessPreferenceCombo: () => null }));
jest.mock('@/components/delivery-address-provider', () => ({ useDeliveryAddress: () => ({ address: null, openAddressPicker: jest.fn() }) }));
jest.mock('../src/Wings4u/components/cart-order-settings', () => ({ CartOrderSettings: () => null }));
const saved = require('../src/lib/saved-cart-api');
const http = require('../src/lib/api');
const { useCartState, CartContext } = require('../src/lib/cart');
const { CartPage } = require('../src/Wings4u/components/cart-page');
const { CheckoutClient } = require('../src/app/checkout/checkout-client');
const item = { key: 'line', menu_item_id: 'wings', name: 'Wings', base_price_cents: 1000, quantity: 2,
  modifier_selections: [{ modifier_option_id: 'cheese', group_name: 'Extras', option_name: 'Cheese', price_delta_cents: 200 }],
  special_instructions: 'Sauce separately' };
const key = 'wings4u.cart-items-draft-v1';
const empty = { items: [], fulfillment_type: 'PICKUP', location_timezone: 'America/Toronto', scheduled_for: null,
  driver_tip_percent: 'none', expires_at: null, is_guest: false };
const quote = { item_subtotal_cents: 2400, final_payable_cents: 2712, tax_cents: 312, lines: [],
  delivery_fee_cents: 0, driver_tip_cents: 0, item_discount_total_cents: 0, order_discount_total_cents: 0,
  promo_discount_cents: 0, wallet_applied_cents: 0, wings_reward: { applied: false } };
function Root({ Page }) { cart = useCartState('store'); return React.createElement(CartContext.Provider, { value: cart }, React.createElement(Page)); }
const screen = () => JSON.stringify(renderer.toJSON());
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); storage = new Map();
  global.window = Object.assign(new EventTarget(), { sessionStorage: { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
  mockSession = { loaded: false, authenticated: false, user: null, refresh: jest.fn().mockResolvedValue(true) };
  saved.putSavedCart.mockResolvedValue(null);
  saved.deleteSavedCart.mockResolvedValue(undefined);
  const menu = { categories: [], location: { timezone: 'America/Toronto', minimum_delivery_subtotal_cents: 0 } };
  http.apiJson.mockImplementation(async url => ({ data: url.includes('/menu') ? menu : url.includes('promotions') ? [] : quote }));
  http.apiFetch.mockImplementation(async url => ({ ok: true, json: async () => ({ data: url.includes('/menu') ? menu : quote }) }));
});

test('successful checkout clears the cart even if the redundant cleanup request fails', async () => {
  mockSession = { ...mockSession, loaded: true, authenticated: true, profileComplete: true,
    user: { id: 'customer-a', displayName: 'Customer', phone: '5195550123' } };
  saved.fetchSavedCart.mockResolvedValue({ ...empty, items: [item] });
  saved.deleteSavedCart.mockRejectedValue(new Error('cleanup unavailable'));
  global.requestAnimationFrame = fn => { fn(); return 1; }; window.scrollTo = jest.fn();
  const original = http.apiFetch.getMockImplementation();
  http.apiFetch.mockImplementation((url, init) => {
    if (url !== '/api/v1/checkout') return original(url, init);
    saved.fetchSavedCart.mockResolvedValue({ ...empty, converted: true, revision: 'after-checkout' });
    return Promise.resolve({ ok: true, json: async () => ({ data: { id: 'order', order_number: 123, status: 'PLACED', fulfillment_type: 'PICKUP' } }) });
  });
  await act(async () => { renderer = create(React.createElement(Root, { Page: CheckoutClient })); });
  const place = renderer.root.findAllByType('button').find(node => node.props.className === 'cart-checkout-fire-btn');
  expect(place.props.disabled).toBe(false);
  await act(async () => place.props.onClick());
  expect(screen()).toContain('Order placed!'); expect(cart.items).toEqual([]);
  delete global.requestAnimationFrame;
});

test('an old checkout response cannot clear another account cart or reveal the old order', async () => {
  mockSession = { ...mockSession, loaded: true, authenticated: true, profileComplete: true,
    user: { id: 'customer-a', displayName: 'Customer', phone: '5195550123' } };
  saved.fetchSavedCart.mockResolvedValue({ ...empty, items: [item] });
  let finish; const original = http.apiFetch.getMockImplementation();
  http.apiFetch.mockImplementation((url, init) => url === '/api/v1/checkout'
    ? new Promise(resolve => { finish = resolve; }) : original(url, init));
  await act(async () => { renderer = create(React.createElement(Root, { Page: CheckoutClient })); });
  const place = renderer.root.findAllByType('button').find(node => node.props.className === 'cart-checkout-fire-btn');
  await act(async () => place.props.onClick());
  mockSession = { ...mockSession, user: { id: 'customer-b' } };
  saved.fetchSavedCart.mockResolvedValue({ ...empty, items: [{ ...item, key: 'new', quantity: 9 }] });
  await act(async () => renderer.update(React.createElement(Root, { Page: CheckoutClient })));
  await act(async () => finish({ ok: true, json: async () => ({ data: { id: 'private-order', order_number: 987, status: 'PLACED', fulfillment_type: 'PICKUP' } }) }));
  expect(cart.items[0].quantity).toBe(9); expect(screen()).not.toContain('987');
  expect(saved.deleteSavedCart).not.toHaveBeenCalled();
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null;
  jest.useRealTimers(); delete global.window; });

test.each([['/cart', CartPage], ['/checkout', CheckoutClient]])('%s hard reload waits for ownership and saved-cart hydration before rendering restored lines', async (_path, Page) => {
  const draft = { v: 1, ownerId: 'customer-a', savedAt: Date.now(), locationId: 'store', items: [item],
    fulfillmentType: 'PICKUP', locationTimezone: 'America/Toronto', scheduledFor: null, driverTipPercent: 15 };
  storage.set(key, JSON.stringify(draft)); const original = storage.get(key);
  let finish; saved.fetchSavedCart.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await act(async () => { renderer = create(React.createElement(Root, { Page })); });
  await act(async () => jest.advanceTimersByTime(800));
  expect(screen()).not.toContain('YOUR CART IS EMPTY'); expect(screen()).not.toContain('Nothing to check out');
  expect(storage.get(key)).toBe(original);
  mockSession = { ...mockSession, loaded: true, authenticated: true, profileComplete: true,
    user: { id: 'customer-a', displayName: 'Customer', phone: '5195550123' } };
  await act(async () => renderer.update(React.createElement(Root, { Page })));
  await act(async () => jest.advanceTimersByTime(800)); expect(storage.get(key)).toBe(original);
  await act(async () => finish(empty));
  expect(cart.items[0]).toMatchObject(item); expect(cart.driverTipPercent).toBe(15);
  if (Page === CheckoutClient) await act(async () => renderer.root.findByProps({ 'aria-label': 'Show details for Wings' }).props.onClick());
  expect(screen()).toContain('Wings'); expect(screen()).toContain('Sauce separately');
  expect(screen()).not.toContain('Nothing to check out'); expect(screen()).not.toContain('YOUR CART IS EMPTY');
});

test.each([CartPage, CheckoutClient])('a failed cart read shows recovery controls instead of a false empty state', async Page => {
  mockSession = { ...mockSession, loaded: true };
  saved.fetchSavedCart.mockRejectedValue(new Error('Saved cart temporarily unavailable'));
  await act(async () => { renderer = create(React.createElement(Root, { Page })); });
  expect(screen()).toContain('Retry restoration'); expect(screen()).toContain('Saved cart temporarily unavailable');
  expect(screen()).not.toContain('Nothing to check out'); expect(screen()).not.toContain('YOUR CART IS EMPTY');
  saved.fetchSavedCart.mockResolvedValue({ ...empty, items: [item] });
  const retry = renderer.root.findAllByType('button').find(node => node.props.children === 'Retry restoration');
  await act(async () => retry.props.onClick()); expect(screen()).toContain('Wings');
});
