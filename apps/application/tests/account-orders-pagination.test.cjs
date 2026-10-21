const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, mockOrdersResponse, account, renderer, renders;
jest.mock('../src/context/session', () => ({ useSession: () => mockSession, withSilentRefresh: jest.fn(call => call()) }));
jest.mock('../src/lib/env', () => ({ DEFAULT_LOCATION_ID: 'store' }));
jest.mock('../src/lib/api', () => ({ getApiErrorMessage: (body, fallback) => body?.errors?.[0]?.message ?? fallback,
  apiFetch: jest.fn(async (path, init) => path.startsWith('/api/v1/orders/customer') ? mockOrdersResponse(path, init) :
    ({ ok: true, json: async () => ({ data: { entries: [], items: [], tickets: [], next_cursor: null } }) })) }));
const { apiFetch } = require('../src/lib/api');
const { withSilentRefresh } = require('../src/context/session');
const { AccountDataProvider, useAccountData } = require('../src/hooks/use-account-data');
const customer = id => ({ loaded: true, authenticated: true, user: { id }, refresh: jest.fn(), clear: jest.fn() });
const orders = (start, count = 20, status = 'DELIVERED') => Array.from({ length: count }, (_, i) => ({ id: String(start + i), status }));
const response = (rows, cursor = null) => ({ ok: true, json: async () => ({ data: { orders: rows, next_cursor: cursor } }) });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const requests = () => apiFetch.mock.calls.filter(([url]) => url.startsWith('/api/v1/orders/customer'));
function Probe() { account = useAccountData(); renders.push(account.data.orders); return null; }
const tree = () => React.createElement(AccountDataProvider, null, React.createElement(Probe));
const mount = async () => act(async () => { renderer = create(tree()); });
const update = async session => { mockSession = session; await act(async () => renderer.update(tree())); };
beforeEach(() => {
  jest.clearAllMocks(); renders = []; mockSession = customer('a');
  mockOrdersResponse = async () => response(orders(1), 'cursor/20+');
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('initial request loads 20 authenticated orders at the scoped location', async () => {
  await mount(); expect(account.data.orders).toHaveLength(20); expect(account.data.ordersNextCursor).toBe('cursor/20+');
  expect(requests()).toEqual([['/api/v1/orders/customer?limit=20', { locationId: 'store' }]]);
  expect(withSilentRefresh).toHaveBeenCalledWith(expect.any(Function), mockSession.refresh, mockSession.clear);
});

test('readiness distinguishes an unresolved account from a successful empty response without another API request', async () => {
  const pending = deferred(); mockOrdersResponse = () => pending.promise;
  await mount(); expect(account.loading).toBe(true); expect(account.hasLoaded).toBe(false); expect(account.data.orders).toEqual([]);
  await act(async () => pending.resolve(response([])));
  expect(account.loading).toBe(false); expect(account.hasLoaded).toBe(true); expect(account.data.orders).toEqual([]);
  expect(requests()).toHaveLength(1);
});

test('a cached account remains ready during refresh, while another account never inherits readiness', async () => {
  await mount(); const pending = deferred(); mockOrdersResponse = () => pending.promise; let request;
  await act(async () => { request = account.refresh('refresh'); });
  expect(account.hasLoaded).toBe(true); expect(account.data.orders).toHaveLength(20); expect(account.refreshing).toBe(true);
  mockOrdersResponse = () => new Promise(() => {}); await update(customer('b'));
  expect(account.hasLoaded).toBe(false); expect(account.data.orders).toEqual([]);
  await act(async () => { pending.resolve(response(orders(21))); await request; });
  expect(account.hasLoaded).toBe(false); expect(account.data.orders).toEqual([]);
});

test('resetting account contents during session revalidation also resets initial-load readiness', async () => {
  await mount(); expect(account.hasLoaded).toBe(true);
  const pending = deferred(); mockOrdersResponse = () => pending.promise;
  await update({ ...mockSession, loaded: false }); expect(account.hasLoaded).toBe(false);
  await update({ ...mockSession, loaded: true }); expect(account.hasLoaded).toBe(false); expect(account.loading).toBe(true);
  await act(async () => pending.resolve(response([])));
  expect(account.hasLoaded).toBe(true); expect(account.loading).toBe(false);
});
test('appends pages by cursor, deduplicates IDs, retains earlier rows, then stops at null', async () => {
  await mount(); mockOrdersResponse = async () => response(orders(20), 'cursor/39+');
  await act(async () => account.loadMoreOrders());
  expect(requests()[1][0]).toBe('/api/v1/orders/customer?limit=20&cursor=cursor%2F20%2B');
  expect(account.data.orders.map(row => row.id)).toEqual(orders(1, 39).map(row => row.id));
  mockOrdersResponse = async () => response(orders(40, 2));
  await act(async () => account.loadMoreOrders());
  expect(requests()[2][0]).toBe('/api/v1/orders/customer?limit=20&cursor=cursor%2F39%2B');
  expect(account.data.orders).toHaveLength(41); expect(account.data.ordersNextCursor).toBeNull();
  await act(async () => account.loadMoreOrders()); expect(requests()).toHaveLength(3);
});
test('mixed or active-only pages retain the next cursor so older history remains reachable', async () => {
  mockOrdersResponse = async () => response(orders(1, 20, 'PREPARING'), 'page2'); await mount();
  mockOrdersResponse = async () => response(orders(21, 20, 'ACCEPTED'), 'page3'); await act(async () => account.loadMoreOrders());
  expect(account.data.ordersNextCursor).toBe('page3');
  mockOrdersResponse = async () => response([...orders(41, 1, 'PREPARING'), ...orders(42, 2)]);
  await act(async () => account.loadMoreOrders()); expect(account.data.orders.filter(row => row.status === 'DELIVERED')).toHaveLength(2);
  expect(account.data.orders).toHaveLength(43);
});
test('empty pages with a cursor can continue loading older history', async () => {
  mockOrdersResponse = async () => response([], 'older'); await mount();
  mockOrdersResponse = async () => response(orders(101, 1)); await act(async () => account.loadMoreOrders());
  expect(account.data.orders[0].id).toBe('101');
});
test('loading lock blocks duplicate taps before rerender and failure preserves rows/cursor for retry', async () => {
  await mount(); const pending = deferred(); mockOrdersResponse = () => pending.promise;
  let request; const loadMore = account.loadMoreOrders;
  await act(async () => { request = loadMore(); loadMore(); });
  expect(account.loadingMoreOrders).toBe(true); expect(requests()).toHaveLength(2);
  await act(async () => { pending.reject(new Error('Offline')); await request; });
  expect(account.loadingMoreOrders).toBe(false); expect(account.data.orders).toHaveLength(20);
  expect(account.data.ordersNextCursor).toBe('cursor/20+'); expect(account.sectionErrors.orders).toBe('Offline');
  mockOrdersResponse = async () => response(orders(21)); await act(async () => account.loadMoreOrders());
  expect(account.data.orders).toHaveLength(40); expect(account.sectionErrors.orders).toBeUndefined();
});
test('even a previously captured handler reads the latest cursor instead of requesting a consumed page', async () => {
  await mount(); const loadMore = account.loadMoreOrders;
  mockOrdersResponse = async () => response(orders(21), 'page3'); await act(async () => loadMore());
  mockOrdersResponse = async () => response(orders(41)); await act(async () => loadMore());
  expect(requests().at(-1)[0]).toContain('cursor=page3'); expect(account.data.orders).toHaveLength(60);
});
test.each(['logout', 'switch'])('%s discards pending pages without showing the previous customer', async action => {
  await mount(); const pending = deferred(); mockOrdersResponse = () => pending.promise;
  let request; await act(async () => { request = account.loadMoreOrders(); });
  mockOrdersResponse = async () => response(orders(101), 'b-next'); renders = [];
  await update(action === 'logout' ? { loaded: true, authenticated: false, user: null } : customer('b'));
  await act(async () => { pending.resolve(response(orders(21))); await request; });
  expect(renders.every(rows => rows.every(row => Number(row.id) >= 101))).toBe(true);
  expect(account.data.orders).toHaveLength(action === 'logout' ? 0 : 20);
});
test('an old page finishing cannot unlock another customer’s pending page', async () => {
  await mount(); const old = deferred(); mockOrdersResponse = () => old.promise;
  let oldRequest; await act(async () => { oldRequest = account.loadMoreOrders(); });
  mockOrdersResponse = async () => response(orders(101), 'b-next'); await update(customer('b'));
  const current = deferred(); mockOrdersResponse = () => current.promise;
  let newRequest; await act(async () => { newRequest = account.loadMoreOrders(); });
  await act(async () => { old.resolve(response(orders(21))); await oldRequest; });
  expect(account.loadingMoreOrders).toBe(true);
  const calls = requests().length; await act(async () => account.loadMoreOrders()); expect(requests()).toHaveLength(calls);
  await act(async () => { current.resolve(response(orders(121))); await newRequest; });
  expect(account.data.orders).toHaveLength(40); expect(account.data.orders.every(row => Number(row.id) >= 101)).toBe(true);
});
test.each(['success', 'failure'])('refresh invalidates an earlier page %s and its cleanup cannot affect a fresh page', async outcome => {
  await mount(); const old = deferred(); mockOrdersResponse = () => old.promise;
  let oldRequest; await act(async () => { oldRequest = account.loadMoreOrders(); });
  mockOrdersResponse = async () => response(orders(201), 'fresh-next'); await act(async () => account.refresh());
  const fresh = deferred(); mockOrdersResponse = () => fresh.promise;
  let freshRequest; await act(async () => { freshRequest = account.loadMoreOrders(); });
  await act(async () => { if (outcome === 'success') old.resolve(response(orders(21))); else old.reject(new Error('Old error')); await oldRequest; });
  expect(account.loadingMoreOrders).toBe(true); expect(account.sectionErrors.orders).toBeUndefined();
  await act(async () => { fresh.resolve(response(orders(221))); await freshRequest; });
  expect(account.data.orders.map(row => row.id)).toEqual(orders(201, 40).map(row => row.id));
});
test('pagination cannot run during a pending refresh', async () => {
  await mount(); const pending = deferred(); mockOrdersResponse = () => pending.promise;
  let refresh; await act(async () => { refresh = account.refresh(); });
  const calls = requests().length; await act(async () => account.loadMoreOrders()); expect(requests()).toHaveLength(calls);
  await act(async () => { pending.resolve(response(orders(101))); await refresh; });
});
test('guests and authenticated sessions without a customer ID never fetch order history', async () => {
  mockSession = { loaded: true, authenticated: false }; await mount(); expect(apiFetch).not.toHaveBeenCalled();
  await update({ loaded: true, authenticated: true, user: null }); expect(apiFetch).not.toHaveBeenCalled();
});
test('a stale handler from another customer cannot fetch or append orders', async () => {
  await mount(); const stale = account.loadMoreOrders;
  mockOrdersResponse = async () => response(orders(101), 'b-next'); await update(customer('b'));
  const calls = requests().length; await act(async () => stale()); expect(requests()).toHaveLength(calls);
});
test('a stale initial page cannot replace a newly signed-in customer’s loaded history', async () => {
  const old = deferred(); mockOrdersResponse = () => old.promise; await mount();
  expect(account.loading).toBe(true);
  mockOrdersResponse = async () => response(orders(101), 'b-next'); await update(customer('b'));
  await act(async () => old.resolve(response(orders(1), 'a-next')));
  expect(account.data.orders.map(row => row.id)).toEqual(orders(101).map(row => row.id)); expect(account.data.ordersNextCursor).toBe('b-next');
});
test('a late 401 from an old account never refreshes or clears the new session', async () => {
  await mount(); const oldSession = mockSession, old = deferred(); mockOrdersResponse = () => old.promise;
  withSilentRefresh.mockImplementationOnce(async (call, refresh, clear) => { const res = await call(); if (res.status === 401) { await refresh(); clear(); } return res; });
  let request; await act(async () => { request = account.loadMoreOrders(); });
  mockOrdersResponse = async () => response(orders(101)); const newSession = customer('b'); await update(newSession);
  await act(async () => { old.resolve({ ok: false, status: 401, json: async () => ({ errors: [{ message: 'Expired' }] }) }); await request; });
  expect(oldSession.refresh).not.toHaveBeenCalled(); expect(oldSession.clear).not.toHaveBeenCalled();
  expect(newSession.refresh).not.toHaveBeenCalled(); expect(newSession.clear).not.toHaveBeenCalled();
  expect(account.data.orders[0].id).toBe('101');
});
