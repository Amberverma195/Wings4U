const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockDisk = new Map();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async key => mockDisk.get(key) ?? null),
  setItemAsync: jest.fn(async (key, value) => { mockDisk.set(key, value); }),
  deleteItemAsync: jest.fn(async key => { mockDisk.delete(key); }),
}), { virtual: true });
jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('../src/lib/env', () => ({ DEFAULT_LOCATION_ID: 'store' }));
jest.mock('../src/lib/api', () => ({ apiFetch: jest.fn(), getApiErrorMessage: (_, fallback) => fallback }));
const tokens = require('../src/lib/token-store');
const store = require('expo-secure-store');
const { apiFetch } = require('../src/lib/api');
const { SessionProvider, useSession, withSilentRefresh } = require('../src/context/session');
const { useAuth } = require('../src/hooks/use-auth');
const { AccountDataProvider, useAccountData } = require('../src/hooks/use-account-data');
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => ({ data }), headers: new Headers() });
const signedIn = id => ({ authenticated: true, user: { id }, profile_complete: true });
const rotated = id => response({ refreshed: true, access_token: `${id}:access2`, refresh_token: `${id}:refresh2` });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let session, auth, account, renderer;
function Probe() { session = useSession(); auth = useAuth(); return null; }
function AccountProbe() { account = useAccountData(); return null; }
const tree = includeAccount => React.createElement(SessionProvider, null, React.createElement(Probe),
  includeAccount ? React.createElement(AccountDataProvider, null, React.createElement(AccountProbe)) : null);
const mount = async includeAccount => act(async () => { renderer = create(tree(includeAccount)); });
const refreshCalls = () => apiFetch.mock.calls.filter(([path]) => path === '/api/v1/auth/refresh');
const protectedCall = () => jest.fn().mockResolvedValueOnce(response(null, 401)).mockResolvedValue(response({ ok: true }));
beforeEach(async () => {
  store.getItemAsync.mockImplementation(async key => mockDisk.get(key) ?? null);
  store.setItemAsync.mockImplementation(async (key, value) => { mockDisk.set(key, value); });
  store.deleteItemAsync.mockImplementation(async key => { mockDisk.delete(key); });
  await tokens.clearAllTokens(); await tokens.setSessionTokens('a:access', 'a:refresh');
  jest.clearAllMocks(); apiFetch.mockReset();
  apiFetch.mockImplementation(async path => {
    const id = (await tokens.getAccessToken())?.split(':')[0];
    if (path === '/api/v1/auth/session') return response(id ? signedIn(id) : { authenticated: false });
    if (path === '/api/v1/auth/refresh') return rotated(id ?? 'a');
    if (path === '/api/v1/auth/login') return response({ user: { id: 'b' }, access_token: 'b:access', refresh_token: 'b:refresh' });
    if (path.startsWith('/api/v1/orders/customer')) return response({ orders: [{ id: `${id}-order`, status: 'DELIVERED' }], next_cursor: 'older' });
    return response({ entries: [], items: [], tickets: [], next_cursor: null });
  });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.restoreAllMocks(); });

test('restores expired access on startup using rotated native tokens', async () => {
  apiFetch.mockResolvedValueOnce(response({ authenticated: false })).mockResolvedValueOnce(rotated('a')).mockResolvedValueOnce(response(signedIn('a')));
  await mount(); expect(session.authenticated).toBe(true); expect(session.user.id).toBe('a');
  expect(await tokens.getAccessToken()).toBe('a:access2'); expect(await tokens.getRefreshToken()).toBe('a:refresh2');
  expect(JSON.parse(refreshCalls()[0][1].body)).toEqual({ refresh_token: 'a:refresh' });
});
test('same-session 401 refreshes, confirms the session and retries exactly once', async () => {
  const call = protectedCall(), refresh = jest.fn(); const generation = tokens.getSessionGeneration();
  expect((await withSilentRefresh(call, refresh, jest.fn())).status).toBe(200);
  expect(refreshCalls()).toHaveLength(1); expect(call).toHaveBeenCalledTimes(2); expect(refresh).toHaveBeenCalledTimes(1);
  expect(tokens.getSessionGeneration()).toBe(generation); expect(await tokens.getAccessToken()).toBe('a:access2');
});
test('concurrent same-session 401s share one refresh', async () => {
  const pending = deferred(); apiFetch.mockReturnValueOnce(pending.promise);
  const calls = [protectedCall(), protectedCall(), protectedCall()];
  const requests = calls.map(call => withSilentRefresh(call, jest.fn(), jest.fn())); await flush();
  expect(refreshCalls()).toHaveLength(1); pending.resolve(rotated('a')); await Promise.all(requests);
  calls.forEach(call => expect(call).toHaveBeenCalledTimes(2));
});
test('a repeated 401 after retry does not create a refresh loop', async () => {
  const call = jest.fn(async () => response(null, 401));
  expect((await withSilentRefresh(call, jest.fn(), jest.fn())).status).toBe(401);
  expect(call).toHaveBeenCalledTimes(2); expect(refreshCalls()).toHaveLength(1);
});
test('a rate-limited refresh keeps the signed-in session and its tokens', async () => {
  await mount();
  apiFetch.mockResolvedValueOnce(response({ authenticated: false })).mockResolvedValueOnce(response(null, 429));
  await act(async () => { expect(await session.refresh()).toBe(false); });
  expect(session.authenticated).toBe(true); expect(session.user.id).toBe('a');
  expect(await tokens.getAccessToken()).toBe('a:access'); expect(await tokens.getRefreshToken()).toBe('a:refresh');
  const clear = jest.fn(); apiFetch.mockResolvedValueOnce(response(null, 429));
  expect((await withSilentRefresh(protectedCall(), jest.fn(), clear)).status).toBe(401);
  expect(clear).not.toHaveBeenCalled();
});
test('temporary refresh failure preserves the active session', async () => {
  await mount(); apiFetch.mockResolvedValueOnce(response({ authenticated: false })).mockResolvedValueOnce(response(null, 503));
  await act(async () => { expect(await session.refresh()).toBe(false); }); expect(session.user.id).toBe('a');
  const clear = jest.fn(); apiFetch.mockRejectedValueOnce(new Error('Offline'));
  await withSilentRefresh(protectedCall(), jest.fn(), clear); expect(clear).not.toHaveBeenCalled();
});
test('definitive same-session refresh rejection clears once', async () => {
  apiFetch.mockResolvedValueOnce(response({ refreshed: false })); const clear = jest.fn();
  await withSilentRefresh(protectedCall(), jest.fn(), clear); expect(clear).toHaveBeenCalledTimes(1);
});
test.each(['logout', 'login-success', 'login-rejection', 'login-network'])('%s while old refresh is pending never writes stale credentials or invokes callbacks', async change => {
  await mount(); const pending = deferred(); apiFetch.mockReturnValueOnce(pending.promise);
  const refresh = jest.fn(() => session.refresh()), clear = jest.fn(() => session.clear());
  const call = protectedCall(), request = withSilentRefresh(call, refresh, clear).catch(error => error); await flush();
  if (change === 'logout') await act(async () => session.clear());
  else await act(async () => auth.login('b@example.com', 'password'));
  pending.resolve(change === 'login-rejection' ? response({ refreshed: false }, 401) : change === 'login-network' ? response(null, 503) : rotated('a'));
  const result = await request; expect(result.message).toMatch(/session changed/);
  expect(refresh).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled(); expect(call).toHaveBeenCalledTimes(1);
  expect(await tokens.getAccessToken()).toBe(change === 'logout' ? null : 'b:access');
  expect(await tokens.getRefreshToken()).toBe(change === 'logout' ? null : 'b:refresh');
  expect(store.setItemAsync.mock.calls.some(([, value]) => value === 'a:access2' || value === 'a:refresh2')).toBe(false);
  expect(session.authenticated).toBe(change !== 'logout');
});
test('different sessions never share a refresh, and old cleanup cannot release the new flight', async () => {
  const a = deferred(), b = deferred();
  apiFetch.mockImplementation(async (_path, init) => JSON.parse(init.body).refresh_token.startsWith('a:') ? a.promise : b.promise);
  const first = withSilentRefresh(protectedCall(), jest.fn(), jest.fn()).catch(error => error); await flush();
  await tokens.setSessionTokens('b:access', 'b:refresh');
  const second = withSilentRefresh(protectedCall(), jest.fn(), jest.fn()); await flush();
  expect(refreshCalls()).toHaveLength(2); a.resolve(rotated('a')); await first;
  const third = withSilentRefresh(protectedCall(), jest.fn(), jest.fn()); await flush(); expect(refreshCalls()).toHaveLength(2);
  b.resolve(rotated('b')); await Promise.all([second, third]); expect(await tokens.getAccessToken()).toBe('b:access2');
});
test('account change during refresh-token read cancels before the refresh HTTP request', async () => {
  const pending = deferred(); jest.spyOn(tokens, 'getRefreshToken').mockImplementationOnce(() => pending.promise);
  const request = withSilentRefresh(protectedCall(), jest.fn(), jest.fn()).catch(error => error); await flush();
  await tokens.setSessionTokens('b:access', 'b:refresh'); pending.resolve('a:refresh'); await request;
  expect(refreshCalls()).toHaveLength(0); expect(await tokens.getAccessToken()).toBe('b:access');
});
test('an in-flight native write cannot finish after the newer login has been persisted', async () => {
  const pending = deferred();
  store.setItemAsync.mockImplementation(async (key, value) => { if (value === 'a:access2') await pending.promise; mockDisk.set(key, value); });
  const refresh = jest.fn(), request = withSilentRefresh(protectedCall(), refresh, jest.fn()).catch(error => error); await flush();
  expect(store.setItemAsync).toHaveBeenCalledWith('wings4u_access_token', 'a:access2');
  const login = tokens.setSessionTokens('b:access', 'b:refresh'); expect(await tokens.getAccessToken()).toBe('b:access');
  pending.resolve(); await login; await request;
  expect(mockDisk.get('wings4u_access_token')).toBe('b:access'); expect(mockDisk.get('wings4u_refresh_token')).toBe('b:refresh');
  expect(store.setItemAsync).not.toHaveBeenCalledWith('wings4u_refresh_token', 'a:refresh2'); expect(refresh).not.toHaveBeenCalled();
});
test('an already-running sessionRefresh cannot replace a newer provider session', async () => {
  await mount(); const old = deferred(); apiFetch.mockReturnValueOnce(old.promise);
  let request; await act(async () => { request = session.refresh(); });
  await tokens.setSessionTokens('b:access', 'b:refresh'); await act(async () => session.refresh());
  await act(async () => { old.resolve(response(signedIn('a'))); await request; }); expect(session.user.id).toBe('b');
});

test('new credentials hide the old session and orders before native persistence completes', async () => {
  await mount(true); expect(session.user.id).toBe('a'); expect(account.data.orders[0].id).toBe('a-order');
  const write = deferred();
  store.setItemAsync.mockImplementation(async (key, value) => { if (value === 'b:access') await write.promise; mockDisk.set(key, value); });
  let login;
  await act(async () => { login = tokens.setSessionTokens('b:access', 'b:refresh'); });
  expect(session.authenticated).toBe(false); expect(session.user).toBeNull(); expect(account.data.orders).toEqual([]);
  await act(async () => { write.resolve(); await login; await session.refresh(); });
  expect(session.user.id).toBe('b'); expect(account.data.orders[0].id).toBe('b-order');
});

test('a delayed login response cannot overwrite a newer accepted login', async () => {
  await mount(); const pending = deferred(); apiFetch.mockReturnValueOnce(pending.promise);
  let login;
  await act(async () => { login = auth.login('a@example.com', 'password').catch(error => error); });
  await act(async () => { await tokens.setSessionTokens('b:access', 'b:refresh'); await session.refresh(); });
  await act(async () => { pending.resolve(response({ access_token: 'a:access', refresh_token: 'a:refresh' })); });
  expect((await login).message).toMatch(/session changed/);
  expect(session.user.id).toBe('b'); expect(await tokens.getRefreshToken()).toBe('b:refresh');
});

test('failed old login confirmation cannot clear a newer accepted session', async () => {
  await mount(); const pending = deferred(); const original = apiFetch.getMockImplementation();
  apiFetch.mockImplementation((path, ...args) => path === '/api/v1/auth/session' ? pending.promise : original(path, ...args));
  let login;
  await act(async () => { login = auth.login('b@example.com', 'password').catch(error => error); });
  await tokens.setSessionTokens('c:access', 'c:refresh');
  apiFetch.mockImplementation(original);
  await act(async () => session.refresh());
  await act(async () => { pending.resolve(response(null, 401)); await login; });
  expect(session.user.id).toBe('c'); expect(await tokens.getRefreshToken()).toBe('c:refresh');
});
test('logout followed by login invalidates refreshes even while logout HTTP is pending', async () => {
  await mount(); const logout = deferred(); apiFetch.mockReturnValueOnce(logout.promise);
  let leaving; await act(async () => { leaving = auth.logout(); });
  // A second auth consumer can sign in while the first consumer is waiting.
  await tokens.setSessionTokens('b:access', 'b:refresh'); await act(async () => session.refresh());
  await act(async () => { logout.resolve(response({})); await leaving; }); expect(session.user.id).toBe('b'); expect(await tokens.getAccessToken()).toBe('b:access');
});
test('stale refresh and old protected response cannot repopulate the new account order history', async () => {
  await mount(true); expect(account.data.orders[0].id).toBe('a-order');
  const old = deferred(); apiFetch.mockResolvedValueOnce(response(null, 401)).mockReturnValueOnce(old.promise);
  let request; await act(async () => { request = account.loadMoreOrders(); });
  await act(async () => auth.login('b@example.com', 'password')); expect(account.data.orders[0].id).toBe('b-order');
  await act(async () => { old.resolve(rotated('a')); await request; }); expect(account.data.orders[0].id).toBe('b-order'); expect(session.user.id).toBe('b');
});
