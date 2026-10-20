const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, mockGeneration, latest, renderer, orderId;
jest.mock('../src/lib/env', () => ({ getApiBase: () => 'https://mock.invalid', DEFAULT_LOCATION_ID: 'default-location' }));
jest.mock('../src/lib/token-store', () => ({ getAccessToken: jest.fn(), getSessionGeneration: () => mockGeneration, getSignupDeviceId: jest.fn() }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession, withSilentRefresh: jest.fn(async call => call()) }));
const { getAccessToken } = require('../src/lib/token-store');
const { apiFetch } = require('../src/lib/api');
const { useOrderDetail } = require('../src/hooks/use-order-detail');
const { withSilentRefresh } = require('../src/context/session');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const response = data => ({ ok: true, status: 200, json: async () => ({ data }) });
function Probe() { latest = useOrderDetail(orderId); return null; }
const mount = () => act(async () => { renderer = create(React.createElement(Probe)); });
const rerender = () => act(async () => renderer.update(React.createElement(Probe)));
beforeEach(() => {
  jest.clearAllMocks(); mockGeneration = 1; orderId = 'order-a';
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer', role: 'CUSTOMER' }, refresh: jest.fn(), clear: jest.fn() };
  getAccessToken.mockResolvedValue('customer-token'); global.fetch = jest.fn().mockResolvedValue(response({ id: 'order-a', customer_user_id: 'customer' }));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; delete global.fetch; });

test('authenticated feedback fetch sends Bearer and actual location headers; internal guard is not sent to fetch', async () => {
  await apiFetch('/api/v1/support/tickets', { method: 'POST', locationId: 'order-location', expectedSessionGeneration: 1 });
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toBe('https://mock.invalid/api/v1/support/tickets');
  expect(init.headers.get('Authorization')).toBe('Bearer customer-token'); expect(init.headers.get('X-Location-Id')).toBe('order-location');
  expect(init.expectedSessionGeneration).toBeUndefined(); expect(init.credentials).toBe('omit');
});
test('account switch during asynchronous token lookup prevents sending any request', async () => {
  const token = deferred(); getAccessToken.mockReturnValue(token.promise);
  const request = apiFetch('/api/v1/support/tickets', { method: 'POST', locationId: 'order-location', expectedSessionGeneration: 1 });
  mockGeneration = 2; token.resolve('other-account-token');
  await expect(request).rejects.toThrow('Your session changed'); expect(global.fetch).not.toHaveBeenCalled();
});
test('order detail uses silent refresh and preserves visible order during live refetch', async () => {
  await mount(); expect(latest.order.id).toBe('order-a');
  const pending = deferred(); global.fetch.mockReturnValueOnce(pending.promise);
  await act(async () => latest.refetch()); expect(latest.order.id).toBe('order-a');
  await act(async () => pending.resolve(response({ id: 'order-a', status: 'DELIVERED' })));
  expect(latest.order.status).toBe('DELIVERED'); expect(withSilentRefresh).toHaveBeenCalledWith(expect.any(Function), mockSession.refresh, mockSession.clear);
});
test.each(['logout', 'account', 'order', 'generation'])('%s clears authenticated order data and ignores late responses', async change => {
  await mount(); expect(latest.order.id).toBe('order-a');
  const pending = deferred(); global.fetch.mockReturnValue(pending.promise); await act(async () => latest.refetch());
  if (change === 'logout') mockSession = { ...mockSession, authenticated: false, user: null };
  if (change === 'account') mockSession = { ...mockSession, user: { id: 'other', role: 'CUSTOMER' } };
  if (change === 'order') orderId = 'order-b';
  if (change === 'generation') mockGeneration++;
  global.fetch.mockResolvedValue(response({ id: orderId, customer_user_id: mockSession.user?.id }));
  await rerender();
  await act(async () => pending.resolve(response({ id: 'order-a', customer_user_id: 'customer', stale: true })));
  expect(latest.order?.stale).not.toBe(true);
  if (change === 'logout') expect(latest.order).toBeNull();
  if (change === 'account') expect(latest.order.customer_user_id).toBe('other');
  if (change === 'order') expect(latest.order.id).toBe('order-b');
});
test('unauthenticated session never fetches order detail', async () => {
  mockSession.authenticated = false; mockSession.user = null; await mount(); expect(global.fetch).not.toHaveBeenCalled(); expect(latest.order).toBeNull();
});

test('initial loading and initial network failure have no cached order', async () => {
  const pending = deferred(); global.fetch.mockReturnValueOnce(pending.promise); await mount();
  expect(latest.loading).toBe(true); expect(latest.order).toBeNull();
  await act(async () => pending.resolve({ ok: false, status: 503, json: async () => ({ message: 'Unavailable' }) }));
  expect(latest.loading).toBe(false); expect(latest.order).toBeNull(); expect(latest.error).toBe('Unavailable (HTTP 503)');
});
test.each(['network', 408, 429, 500, 503])('temporary %s refresh failure retains data until successful retry', async failure => {
  await mount(); const previous = latest.order;
  if (failure === 'network') global.fetch.mockRejectedValueOnce(new TypeError('Network request failed'));
  else global.fetch.mockResolvedValueOnce({ ok: false, status: failure, json: async () => ({ message: 'Temporary failure' }) });
  await act(async () => latest.refetch()); expect(latest.order).toBe(previous); expect(latest.error).toBeTruthy();
  const warning = latest.error, pending = deferred(); global.fetch.mockReturnValueOnce(pending.promise);
  await act(async () => latest.refetch()); expect(latest.order).toBe(previous); expect(latest.loading).toBe(true); expect(latest.error).toBe(warning);
  await act(async () => pending.resolve(response({ ...previous, status: 'DELIVERED' })));
  expect(latest.order.status).toBe('DELIVERED'); expect(latest.error).toBeNull(); expect(latest.loading).toBe(false);
});
test.each([401, 403, 404, 410])('%s discards cached private order, including non-JSON error responses', async status => {
  await mount(); expect(latest.order).not.toBeNull();
  global.fetch.mockResolvedValueOnce({ ok: false, status, json: async () => { throw new SyntaxError('Invalid JSON'); } });
  await act(async () => latest.refetch()); expect(latest.order).toBeNull(); expect(latest.error).toBeTruthy();
  global.fetch.mockRejectedValueOnce(new TypeError('Network request failed'));
  await act(async () => latest.refetch()); expect(latest.order).toBeNull();
});
test('successful response with no order clears previously cached details', async () => {
  await mount(); global.fetch.mockResolvedValueOnce(response(null)); await act(async () => latest.refetch());
  expect(latest.order).toBeNull(); expect(latest.error).toBeNull();
});
test.each(['logout', 'account', 'order', 'generation', 'invalid-session'])('%s immediately hides cached data while a new request is pending', async change => {
  await mount(); const pending = deferred(); global.fetch.mockReturnValue(pending.promise);
  if (change === 'logout') mockSession = { ...mockSession, authenticated: false, user: null };
  if (change === 'account') mockSession = { ...mockSession, user: { id: 'other', role: 'CUSTOMER' } };
  if (change === 'order') orderId = 'order-b';
  if (change === 'generation') mockGeneration++;
  if (change === 'invalid-session') mockSession = { ...mockSession, loaded: false };
  await rerender(); expect(latest.order).toBeNull();
});
