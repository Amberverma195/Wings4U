const React = require('react');
const { act, create } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
let session;
let cart;
let renderer;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));
jest.mock('../src/lib/env', () => ({ DEFAULT_LOCATION_ID: 'location' }));
jest.mock('../src/context/session', () => ({ useSession: () => session }));
jest.mock('../src/lib/saved-cart-api', () => ({
  fetchSavedCart: jest.fn(),
  mergeSavedCartOnLogin: jest.fn(),
  putSavedCart: jest.fn(),
  deleteSavedCart: jest.fn(),
}));

const api = require('../src/lib/saved-cart-api');
const { CartProvider, useCart, cartItemKey } = require('../src/context/cart');

const item = {
  key: 'wings', menu_item_id: 'wings', menu_item_slug: 'wings', name: 'Wings',
  image_url: null, base_price_cents: 1000, quantity: 1,
  modifier_selections: [], removed_ingredients: [], special_instructions: '',
  builder_payload: null,
};
const snapshot = (items, isGuest = true) => ({
  items, fulfillment_type: 'PICKUP', location_timezone: 'America/Toronto',
  scheduled_for: null, driver_tip_percent: 'none', expires_at: null,
  is_guest: isGuest,
});

function Probe() {
  cart = useCart();
  return null;
}
const tree = () => React.createElement(CartProvider, null, React.createElement(Probe));

test('checkout cart cleanup removes the saved cart and local draft and resets selections', async () => {
  await act(async () => { cart.setDriverTipPercent(15); cart.setScheduledFor('2026-10-20T17:00:00Z'); });
  const storage = require('@react-native-async-storage/async-storage'); storage.removeItem.mockClear();
  await act(async () => cart.clear());
  expect(cart.items).toEqual([]); expect(cart.driverTipPercent).toBe('none'); expect(cart.scheduledFor).toBeNull();
  expect(api.deleteSavedCart).toHaveBeenCalledWith('location');
  expect(storage.removeItem).toHaveBeenCalledWith('wings4u.mobile-cart-draft-v1:location');
});

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  session = { loaded: true, authenticated: false };
  api.fetchSavedCart.mockResolvedValue(snapshot([item]));
  api.putSavedCart.mockResolvedValue(null);
  await act(async () => { renderer = create(tree()); });
  expect(cart.isCartHydrating).toBe(false);
});

afterEach(async () => {
  await act(async () => { renderer.unmount(); });
  jest.useRealTimers();
});

test('finishes a delayed cart merge after signing in', async () => {
  let resolveMerge;
  api.mergeSavedCartOnLogin.mockReturnValue(new Promise(resolve => { resolveMerge = resolve; }));
  session = { ...session, authenticated: true };
  await act(async () => { renderer.update(tree()); });
  expect(cart.isCartHydrating).toBe(true);
  await act(async () => {
    resolveMerge({ snapshot: snapshot([{ ...item, quantity: 2 }], false), merge_outcome: 'merged' });
  });
  expect(cart.isCartHydrating).toBe(false);
  expect(cart.items[0].quantity).toBe(2);
  expect(cart.isGuestCart).toBe(false);
  expect(api.mergeSavedCartOnLogin).toHaveBeenCalledTimes(1);
});

test('preserves local items when merging and saving fail', async () => {
  api.mergeSavedCartOnLogin.mockResolvedValue({ snapshot: null, merge_outcome: 'no_guest' });
  api.fetchSavedCart.mockResolvedValue(null);
  session = { ...session, authenticated: true };
  await act(async () => { renderer.update(tree()); });
  expect(cart.isCartHydrating).toBe(false);
  expect(cart.items[0].menu_item_id).toBe('wings');
  expect(api.putSavedCart).toHaveBeenCalledWith('location', expect.objectContaining({ items: cart.items }));
});

test('releases loading if the merge throws', async () => {
  api.mergeSavedCartOnLogin.mockRejectedValue(new Error('Network unavailable'));
  session = { ...session, authenticated: true };
  await act(async () => { renderer.update(tree()); });
  expect(cart.isCartHydrating).toBe(false);
  expect(cart.items).toHaveLength(1);
});

test('signing out during a merge prevents stale items from returning', async () => {
  let resolveMerge;
  api.mergeSavedCartOnLogin.mockReturnValue(new Promise(resolve => { resolveMerge = resolve; }));
  session = { ...session, authenticated: true };
  await act(async () => { renderer.update(tree()); });
  session = { ...session, authenticated: false };
  await act(async () => { renderer.update(tree()); });
  await act(async () => {
    resolveMerge({ snapshot: snapshot([item], false), merge_outcome: 'merged' });
  });
  expect(cart.isCartHydrating).toBe(false);
  expect(cart.items).toHaveLength(0);
});

test('reorder configurations merge deterministically with saved lines and refresh current prices', async () => {
  const first = { builder_type: 'ITEM_CUSTOMIZATION', removed_ingredients: [], side_pop_bundle: { price_cents: 499, side_label: 'Fries', pop_label: 'Pepsi' } };
  const second = { side_pop_bundle: { pop_label: 'Pepsi', side_label: 'Fries', price_cents: 499 }, removed_ingredients: [], builder_type: 'ITEM_CUSTOMIZATION' };
  expect(cartItemKey('burger', [], '', [], first)).toBe(cartItemKey('burger', [], '', [], second));
  await act(async () => cart.addItem({ ...item, menu_item_id: 'burger', key: undefined, base_price_cents: 1400, builder_payload: first }));
  await act(async () => cart.addItem({ ...item, menu_item_id: 'burger', key: undefined, base_price_cents: 1600, quantity: 2, builder_payload: second }));
  expect(cart.items.filter(row => row.menu_item_id === 'burger')).toHaveLength(1);
  expect(cart.items.find(row => row.menu_item_id === 'burger')).toMatchObject({ quantity: 3, base_price_cents: 1600 });
  expect(cart.items.find(row => row.menu_item_id === 'wings')).toMatchObject({ quantity: 1 });
});

test.each([10, 15, 20])('tip %i survives saved-cart persistence and hydration', async tip => {
  await act(async () => cart.setDriverTipPercent(tip));
  await act(async () => jest.advanceTimersByTime(1000));
  expect(api.putSavedCart).toHaveBeenLastCalledWith('location', expect.objectContaining({ driverTipPercent: tip }));
  await act(async () => renderer.unmount());
  api.fetchSavedCart.mockResolvedValue({ ...snapshot([item]), driver_tip_percent: tip });
  await act(async () => { renderer = create(tree()); });
  expect(cart.driverTipPercent).toBe(tip);
});
