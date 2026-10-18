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
