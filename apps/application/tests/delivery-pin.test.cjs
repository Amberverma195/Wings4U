const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let renderer, latest, mockGeneration, mockFocused, mockSession, order;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession, withSilentRefresh: jest.fn(async call => call()) }));
jest.mock('../src/lib/token-store', () => ({ getSessionGeneration: () => mockGeneration }));
jest.mock('../src/lib/api', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('../src/lib/api');
const { useDeliveryPin } = require('../src/hooks/use-delivery-pin');
const response = pin => ({ ok: true, json: async () => ({ data: { pin } }) });
function Probe() { latest = useDeliveryPin(order); return null; }
const rerender = () => act(async () => renderer.update(React.createElement(Probe)));
const mount = () => act(async () => { renderer = create(React.createElement(Probe)); });
beforeEach(() => {
  jest.clearAllMocks(); mockGeneration = 1; mockFocused = true;
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer' }, refresh: jest.fn(), clear: jest.fn() };
  order = { id: 'order-a', location_id: 'actual-store', customer_user_id: 'customer', fulfillment_type: 'DELIVERY', status: 'OUT_FOR_DELIVERY' };
  apiFetch.mockResolvedValue(response('1234'));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('PIN requests use silent refresh, the order location, and session generation', async () => {
  await mount(); expect(latest).toBe('1234');
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/orders/order-a/delivery-pin', { locationId: 'actual-store', expectedSessionGeneration: 1 });
  expect(require('../src/context/session').withSilentRefresh).toHaveBeenCalledWith(expect.any(Function), mockSession.refresh, mockSession.clear);
});
test.each(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED', 'NO_PIN_DELIVERY', 'NO_SHOW_DELIVERY'])(
  '%s never fetches or shows a delivery PIN', async status => { order.status = status; await mount(); expect(latest).toBeNull(); expect(apiFetch).not.toHaveBeenCalled(); });
test.each(['pickup', 'owner', 'signed-out', 'unfocused'])('%s never fetches a private delivery PIN', async change => {
  if (change === 'pickup') order.fulfillment_type = 'PICKUP';
  if (change === 'owner') order.customer_user_id = 'someone-else';
  if (change === 'signed-out') mockSession.authenticated = false;
  if (change === 'unfocused') mockFocused = false;
  await mount(); expect(latest).toBeNull(); expect(apiFetch).not.toHaveBeenCalled();
});
test.each(['order', 'account', 'terminal', 'blur'])('%s changes hide a loaded PIN and ignore old in-flight results', async change => {
  await mount(); expect(latest).toBe('1234');
  let resolve; apiFetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); order = { ...order, updated_at: 'new' }; await rerender();
  if (change === 'order') order = { ...order, id: 'order-b' };
  if (change === 'account') { mockGeneration++; mockSession = { ...mockSession, user: { id: 'other' } }; }
  if (change === 'terminal') order = { ...order, status: 'DELIVERED' };
  if (change === 'blur') mockFocused = false;
  apiFetch.mockResolvedValue(response('5678')); await rerender();
  await act(async () => resolve(response('STALE')));
  expect(latest).toBe(change === 'order' ? '5678' : null);
});
test('PIN failure is non-fatal and a later authoritative order refresh retries it', async () => {
  apiFetch.mockResolvedValueOnce({ ok: false, status: 503 }); await mount(); expect(latest).toBeNull();
  order = { ...order, updated_at: 'new' }; await rerender(); expect(latest).toBe('1234');
});
