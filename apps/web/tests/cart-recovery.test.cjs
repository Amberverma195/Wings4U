const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockCart, renderer, mockStorage, mockRejectSavedItem;
const mockRouter = { push: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }) => require('react').createElement('a', props, children) }));
jest.mock('@/lib/cart', () => ({ useCart: () => mockCart }));
jest.mock('@/lib/api', () => ({ apiJson: jest.fn() }));
jest.mock('../src/Wings4u/components/cart-order-settings', () => ({ CartOrderSettings: () => null }));
const { apiJson } = require('@/lib/api');
const { CartPage, CART_EDIT_STORAGE_KEY } = require('../src/Wings4u/components/cart-page');
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children ? node.children.map(text).join('') : '';
const button = label => renderer.root.findAllByType('button').find(node => text(node).trim() === label);
const mount = async () => act(async () => { renderer = create(React.createElement(CartPage)); });
const tick = async () => act(async () => { jest.advanceTimersByTime(300); });
const rerender = async () => act(async () => { renderer.update(React.createElement(CartPage)); });
let message;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockStorage = new Map(); mockRejectSavedItem = true;
  message = 'Your 75 Wings selection needs updating because our menu options have changed. Please review this item before checkout.';
  global.window = Object.assign(new EventTarget(), { sessionStorage: { getItem: key => mockStorage.get(key) ?? null, setItem: (key, value) => mockStorage.set(key, value), removeItem: key => mockStorage.delete(key) } });
  mockCart = { locationId: 'store', fulfillmentType: 'PICKUP', scheduledFor: null, driverTipPercent: 'none', setDriverTipPercent: jest.fn(), setLocationTimezone: jest.fn(),
    isCartHydrated: true, isCartHydrating: false, updateQuantity: jest.fn(), removeItem: jest.fn(),
    items: [{ key: 'party', menu_item_id: 'party-75', menu_item_slug: 'party-75-wings', name: '75 Wings', base_price_cents: 8999, quantity: 2,
      modifier_selections: [], special_instructions: '', builder_payload: { builder_type: 'WINGS', weight_lb: 5 } },
    { key: 'burger', menu_item_id: 'burger', name: 'Burger', base_price_cents: 1000, quantity: 3, modifier_selections: [], special_instructions: '' }] };
  apiJson.mockImplementation(async (url, init) => {
    if (url.includes('/menu')) return { data: { categories: [], location: { timezone: 'America/Toronto', minimum_delivery_subtotal_cents: 0 } } };
    if (!url.includes('/cart/quote')) return { data: [] };
    const request = JSON.parse(init.body);
    if (mockRejectSavedItem) throw Object.assign(new Error(message), { body: { errors: [{ code: 'CART_ITEM_CONFIGURATION_INVALID', message,
      detail: { affected_item_ids: ['party-75'], affected_item_indices: [0] } }] } });
    return { data: { item_subtotal_cents: 20998, final_payable_cents: 20998, tax_cents: 0, wings_reward: { applied: false }, lines: request.items } };
  });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; delete global.window; jest.useRealTimers(); });
test.each(['old 75-wing weight / missing fields', 'old 100-wing weight', 'inactive modifier', 'invalid flavour'])('recovers %s without losing other lines and blocks navigation until a successful re-quote', async problem => {
  const saved = mockCart.items[0];
  if (problem === 'old 100-wing weight') Object.assign(saved, { menu_item_id: 'party-100', menu_item_slug: 'party-100-wings', name: '100 Wings', base_price_cents: 11699,
    builder_payload: { builder_type: 'WINGS', weight_lb: 6.67 } });
  if (problem === 'inactive modifier') saved.modifier_selections = [{ modifier_option_id: 'removed-paid', group_name: 'Extras', option_name: 'Extra cheese', price_delta_cents: 150 }];
  if (problem === 'invalid flavour') saved.builder_payload.flavour_slots = [{ slot_no: 1, wing_flavour_id: 'removed-flavour', flavour_name: 'Old sauce' }];
  message = `Your ${saved.name} selection needs updating because our menu options have changed. Please review this item before checkout.`;
  const unaffected = mockCart.items[1];
  await mount(); await tick();
  const cards = renderer.root.findAll(node => node.type === 'div' && node.props.className === 'wk-cart-line-card');
  expect(text(cards[0])).toContain(message); expect(text(cards[1])).not.toContain(message);
  if (problem !== 'invalid flavour') expect(text(cards[0])).toContain('Needs review');
  await act(async () => renderer.root.findByProps({ className: 'cart-checkout-fire-btn' }).props.onClick()); expect(mockRouter.push).not.toHaveBeenCalledWith('/checkout');
  await act(async () => cards[0].findAllByType('button').find(node => text(node) === 'Edit').props.onClick());
  expect(mockStorage.get(CART_EDIT_STORAGE_KEY)).toBe('party');
  expect(mockRouter.push).toHaveBeenCalledWith('/order?fulfillment_type=PICKUP');
  expect(mockCart.removeItem).not.toHaveBeenCalled(); expect(mockCart.items[1]).toBe(unaffected);
  mockRejectSavedItem = false;
  mockCart = { ...mockCart, items: [{ ...mockCart.items[0], modifier_selections: [], builder_payload: { builder_type: 'WINGS', weight_lb: problem === 'old 100-wing weight' ? 11 : 8, flavour_slots: [] } }, unaffected] };
  await rerender(); await tick();
  expect(text(renderer.root)).not.toContain(message);
  await act(async () => renderer.root.findByProps({ className: 'cart-checkout-fire-btn' }).props.onClick()); expect(mockRouter.push).toHaveBeenCalledWith('/checkout');
  expect(mockCart.items.map(line => line.quantity)).toEqual([2, 3]);
});

test('a saved out-of-stock line identifies the item, blocks checkout and can be removed individually', async () => {
  const untouched = mockCart.items[1];
  const original = apiJson.getMockImplementation();
  const stockMessage = '75 Wings is currently out of stock. Please remove it or choose another item.';
  apiJson.mockImplementation((url, init) => url.includes('/cart/quote') ? Promise.reject(Object.assign(new Error(stockMessage), {
    body: { errors: [{ code: 'CART_ITEM_UNAVAILABLE', message: stockMessage, detail: { affected_item_ids: ['party-75'], affected_item_indices: [0] } }] },
  })) : original(url, init));
  await mount(); await tick();
  const cards = renderer.root.findAll(node => node.type === 'div' && node.props.className === 'wk-cart-line-card');
  expect(text(cards[0])).toContain(stockMessage); expect(text(cards[1])).not.toContain(stockMessage);
  await act(async () => renderer.root.findByProps({ className: 'cart-checkout-fire-btn' }).props.onClick());
  expect(mockRouter.push).not.toHaveBeenCalledWith('/checkout');
  await act(async () => cards[0].findByProps({ className: 'cart-line-btn-remove' }).props.onClick());
  expect(mockCart.removeItem).toHaveBeenCalledWith('party'); expect(mockCart.removeItem).toHaveBeenCalledTimes(1);
  expect(mockCart.items[1]).toBe(untouched); expect(untouched.quantity).toBe(3);
});
