const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, renderer, cart, storage;
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), message: jest.fn() } }));
jest.mock('@/lib/saved-cart-api', () => ({ fetchSavedCart: jest.fn(), putSavedCart: jest.fn(), mergeSavedCartOnLogin: jest.fn() }));
const api = require('../src/lib/saved-cart-api');
const { useCartState } = require('../src/lib/cart');
const item = { key: 'line', menu_item_id: 'wings', name: 'Wings', base_price_cents: 1000, quantity: 1, modifier_selections: [], special_instructions: '' };
const snapshot = items => ({ items, fulfillment_type: 'PICKUP', location_timezone: 'America/Toronto', scheduled_for: null, driver_tip_percent: 'none', expires_at: null, is_guest: true });
const key = 'wings4u.cart-items-draft-v1';
function Probe() { cart = useCartState('store'); return null; }
const tree = () => React.createElement(Probe);
const mount = async () => act(async () => { renderer = create(tree()); });
const tick = async () => act(async () => { jest.advanceTimersByTime(1000); });
const draft = (savedAt = Date.now(), ownerId = null) => ({ v: 1, ownerId, savedAt, locationId: 'store', items: [item], fulfillmentType: 'PICKUP', locationTimezone: 'America/Toronto', scheduledFor: null, driverTipPercent: 'none' });
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-23T16:00:00Z')); jest.clearAllMocks();
  storage = new Map();
  const sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  global.window = Object.assign(new EventTarget(), { sessionStorage });
  mockSession = { loaded: true, authenticated: false };
  api.fetchSavedCart.mockResolvedValue(snapshot([])); api.putSavedCart.mockResolvedValue(null);
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; delete global.window; jest.useRealTimers(); });

test('expired server cart discards even a recent recovery draft and never writes it back', async () => {
  storage.set(key, JSON.stringify(draft()));
  api.fetchSavedCart.mockResolvedValue({ ...snapshot([]), expired: true, expires_at: new Date(Date.now() - 1).toISOString() });
  await mount(); await tick();
  expect(cart.items).toEqual([]); expect(cart.isCartHydrated).toBe(true); expect(api.putSavedCart).not.toHaveBeenCalled();
  expect(JSON.parse(storage.get(key)).items).toEqual([]);
});

test.each([0, 60_000])('fresh legitimate drafts (%i ms old) recover after failed/debounced saves', async age => {
  storage.set(key, JSON.stringify(draft(Date.now() - age)));
  await mount();
  expect(cart.items).toHaveLength(1); expect(api.putSavedCart).toHaveBeenCalledTimes(1);
  expect(api.putSavedCart.mock.calls[0][1].items[0].menu_item_id).toBe('wings');
});

test.each([24 * 60 * 60 * 1000 + 1, -60_000])('out-of-window draft age %i never recovers', async age => {
  storage.set(key, JSON.stringify(draft(Date.now() - age))); await mount(); await tick();
  expect(cart.items).toEqual([]); expect(api.putSavedCart).not.toHaveBeenCalled();
});

test('pagehide does not write a cart or renew the timestamp on an unchanged recovery draft', async () => {
  const savedAt = Date.now() - 1000; storage.set(key, JSON.stringify(draft(savedAt)));
  api.fetchSavedCart.mockResolvedValue(snapshot([item])); await mount(); await tick();
  api.putSavedCart.mockClear(); window.dispatchEvent(new Event('pagehide'));
  expect(api.putSavedCart).not.toHaveBeenCalled(); expect(JSON.parse(storage.get(key)).savedAt).toBe(savedAt);
});

test('another customer cannot recover an owned draft, including after reload', async () => {
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer-b' } };
  storage.set(key, JSON.stringify(draft(Date.now(), 'customer-a'))); await mount(); await tick();
  expect(cart.items).toEqual([]); expect(api.putSavedCart).not.toHaveBeenCalled();
});

test('direct account switching clears prior items and hydrates the new owner', async () => {
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer-a' } };
  api.fetchSavedCart.mockResolvedValue(snapshot([item])); await mount();
  api.fetchSavedCart.mockResolvedValue(snapshot([])); mockSession = { ...mockSession, user: { id: 'customer-b' } };
  await act(async () => renderer.update(tree())); await tick();
  expect(cart.items).toEqual([]); expect(api.putSavedCart).not.toHaveBeenCalled();
});

test('logout during a delayed login merge ignores the old response', async () => {
  await mount(); let finish;
  api.mergeSavedCartOnLogin.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer-a' } };
  await act(async () => renderer.update(tree()));
  mockSession = { loaded: true, authenticated: false };
  await act(async () => renderer.update(tree()));
  await act(async () => finish({ snapshot: snapshot([item]), merge_outcome: 'merged' }));
  expect(cart.items).toEqual([]);
});

test('an open idle tab clears its cart at the deadline without writing it back', async()=>{
  api.fetchSavedCart.mockResolvedValue({...snapshot([item]),expires_at:new Date(Date.now()+1000).toISOString()});
  await mount();api.putSavedCart.mockClear();await tick();
  expect(cart.items).toEqual([]);expect(api.putSavedCart).not.toHaveBeenCalled();
});

test('an expired guest cookie cannot revive a draft carrying its old server deadline', async()=>{
  storage.set(key, JSON.stringify({...draft(),expiresAt:new Date(Date.now()-1).toISOString()}));
  api.fetchSavedCart.mockResolvedValue(snapshot([]));
  await mount();await tick();
  expect(cart.items).toEqual([]);expect(api.putSavedCart).not.toHaveBeenCalled();
});
