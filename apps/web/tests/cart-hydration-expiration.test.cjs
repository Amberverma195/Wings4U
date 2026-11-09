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

test.each(['/checkout', '/cart'])('hard reload on %s preserves a signed-in draft through slow session and API hydration', async () => {
  const rich = { ...draft(Date.now(), 'customer-a'), fulfillmentType: 'DELIVERY', driverTipPercent: 20,
    scheduledFor: '2026-10-24T18:00:00Z', items: [{ ...item, quantity: 3,
      modifier_selections: [{ modifier_option_id: 'cheese', group_name: 'Extras', option_name: 'Cheese', price_delta_cents: 200 }],
      removed_ingredients: [{ id: 'onion', name: 'Onion' }], builder_payload: { builder_type: 'ITEM_CUSTOMIZATION' } }] };
  const original = JSON.stringify(rich); storage.set(key, original);
  mockSession = { loaded: false, authenticated: false, user: null };
  await mount(); await tick(); window.dispatchEvent(new Event('pagehide'));
  expect(storage.get(key)).toBe(original); expect(api.fetchSavedCart).not.toHaveBeenCalled();
  expect(cart.isCartHydrating).toBe(true); expect(cart.items).toEqual([]);
  let resolve; api.fetchSavedCart.mockReturnValue(new Promise(done => { resolve = done; }));
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer-a' } };
  await act(async () => renderer.update(tree())); await tick();
  expect(storage.get(key)).toBe(original); expect(cart.isCartHydrating).toBe(true);
  await act(async () => resolve({ ...snapshot([]), is_guest: false }));
  expect(cart.items).toMatchObject(rich.items); expect(cart.fulfillmentType).toBe('DELIVERY');
  expect(cart.driverTipPercent).toBe(20); expect(cart.scheduledFor).toBe(rich.scheduledFor);
  expect(cart.isCartHydrated).toBe(true);
});

test('a guest refresh before the 400 ms backend save restores the synchronously saved draft', async () => {
  await mount(); api.putSavedCart.mockClear();
  await act(async () => { cart.addItem({ ...item, quantity: 4 }); cart.setDriverTipPercent(15);
    cart.commitOrderContext({ fulfillmentType: 'DELIVERY', scheduledFor: '2026-10-24T18:00:00Z' }); });
  expect(api.putSavedCart).not.toHaveBeenCalled();
  const saved = JSON.parse(storage.get(key)); expect(saved.items[0].quantity).toBe(4); expect(saved.pending).toBe(true);
  await act(async () => renderer.unmount()); renderer = null;
  await mount();
  expect(cart.items[0].quantity).toBe(4); expect(cart.driverTipPercent).toBe(15);
  expect(cart.fulfillmentType).toBe('DELIVERY'); expect(api.putSavedCart).toHaveBeenCalledTimes(1);
});

test('a failed read keeps the draft intact and exposes a retryable error rather than an empty cart', async () => {
  const original = JSON.stringify(draft()); storage.set(key, original);
  api.fetchSavedCart.mockRejectedValue(new Error('Temporary API failure'));
  await mount(); await tick(); window.dispatchEvent(new Event('pagehide'));
  expect(cart.cartHydrationError).toContain('Temporary API failure'); expect(cart.isCartHydrated).toBe(false);
  expect(cart.items).toHaveLength(1); expect(storage.get(key)).toBe(original); expect(api.putSavedCart).not.toHaveBeenCalled();
  api.fetchSavedCart.mockResolvedValue(snapshot([]));
  await act(async () => cart.retryCartRestoration());
  expect(cart.isCartHydrated).toBe(true); expect(cart.cartHydrationError).toBeNull(); expect(cart.items).toHaveLength(1);
});

test('an unverified session after a network failure must not treat a private draft as a guest cart', async () => {
  const original = JSON.stringify(draft(Date.now(), 'customer-a')); storage.set(key, original);
  mockSession = { loaded: true, resolved: false, authenticated: false, user: null, error: 'Session unavailable' };
  await mount(); await tick(); window.dispatchEvent(new Event('pagehide'));
  expect(cart.items).toEqual([]); expect(cart.cartHydrationError).toBe('Session unavailable');
  expect(storage.get(key)).toBe(original); expect(api.fetchSavedCart).not.toHaveBeenCalled();
});

test('explicit clear is a pending empty draft and cannot resurrect the previous server cart on refresh', async () => {
  api.fetchSavedCart.mockResolvedValue(snapshot([item])); await mount();
  await act(async () => cart.clear());
  expect(JSON.parse(storage.get(key))).toMatchObject({ items: [], pending: true });
  await act(async () => renderer.unmount()); renderer = null; await mount();
  expect(cart.items).toEqual([]); expect(api.putSavedCart.mock.calls.at(-1)[1].items).toEqual([]);
});

test('an acknowledged draft cannot revive a legitimately empty server cart', async () => {
  storage.set(key, JSON.stringify({ ...draft(), pending: false })); await mount();
  expect(cart.items).toEqual([]); expect(api.putSavedCart).not.toHaveBeenCalled();
});

test('a server revision conflict preserves the browser draft until the user chooses the saved version', async () => {
  storage.set(key, JSON.stringify({ ...draft(), pending: true, baseRevision: 'old' }));
  api.fetchSavedCart.mockResolvedValue({ ...snapshot([{ ...item, quantity: 8 }]), revision: 'new' });
  await mount(); expect(cart.cartHydrationConflict).toBe(true); expect(api.putSavedCart).not.toHaveBeenCalled();
  expect(JSON.parse(storage.get(key)).items[0].quantity).toBe(1);
  await act(async () => cart.retryCartRestoration());
  expect(cart.items[0].quantity).toBe(8); expect(cart.cartHydrationError).toBeNull();
});

test('a delayed read from a prior account cannot show or persist its private cart', async () => {
  let finish; api.fetchSavedCart.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer-a' } }; await mount();
  mockSession = { ...mockSession, user: { id: 'customer-b' } };
  api.fetchSavedCart.mockResolvedValue({ ...snapshot([]), is_guest: false });
  await act(async () => renderer.update(tree()));
  await act(async () => finish({ ...snapshot([item]), is_guest: false })); await tick();
  expect(cart.items).toEqual([]); expect(cart.itemCount).toBe(0); expect(api.putSavedCart).not.toHaveBeenCalled();
  expect(JSON.parse(storage.get(key)).ownerId).toBe('customer-b');
});

test('browser storage restrictions do not prevent server cart hydration', async () => {
  window.sessionStorage.getItem = () => { throw new Error('Storage denied'); };
  window.sessionStorage.setItem = () => { throw new Error('Storage denied'); };
  api.fetchSavedCart.mockResolvedValue(snapshot([item]));
  await mount(); expect(cart.isCartHydrated).toBe(true); expect(cart.items).toHaveLength(1);
});

test('an ownership conflict refreshes the session without discarding the private recovery draft', async () => {
  const original = JSON.stringify(draft(Date.now(), 'customer-a')); storage.set(key, original);
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer-a' }, refresh: jest.fn().mockResolvedValue(true) };
  api.fetchSavedCart.mockRejectedValue(Object.assign(new Error('Verify session'), { status: 409, code: 'SAVED_CART_OWNER_CHANGED' }));
  await mount(); expect(cart.cartHydrationConflict).toBe(false); expect(storage.get(key)).toBe(original);
  api.fetchSavedCart.mockResolvedValue({ ...snapshot([]), is_guest: false });
  await act(async () => cart.retryCartRestoration());
  expect(mockSession.refresh).toHaveBeenCalled(); expect(cart.items).toHaveLength(1);
});

test('a converted cart invalidates an older pending draft but permits a new cart based on its marker', async () => {
  storage.set(key, JSON.stringify({ ...draft(), pending: true, baseRevision: null }));
  api.fetchSavedCart.mockResolvedValue({ ...snapshot([]), converted: true, revision: 'after-checkout' });
  await mount(); expect(cart.items).toEqual([]); expect(api.putSavedCart).not.toHaveBeenCalled();
  await act(async () => { cart.addItem({ ...item, quantity: 6 }); });
  await act(async () => renderer.unmount()); renderer = null; await mount();
  expect(cart.items[0].quantity).toBe(6); expect(api.putSavedCart).toHaveBeenCalledTimes(1);
});
