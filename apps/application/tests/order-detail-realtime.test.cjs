const React = require('react');
const { act, create } = require('react-test-renderer');
const { createFakeSocket } = require('./fake-socket.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, mockGeneration, renderer;
const mockAppStateListeners = new Set();
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' }, StyleSheet: { create: value => value }, AccessibilityInfo: { setAccessibilityFocus: jest.fn() }, findNodeHandle: () => null,
  AppState: { currentState: 'active', addEventListener: jest.fn((_, listener) => {
    mockAppStateListeners.add(listener);
    return { remove: () => mockAppStateListeners.delete(listener) };
  }) },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_, name) => name }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('expo-router', () => ({ useIsFocused: () => true, useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({ id: 'order-1' }) }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession, withSilentRefresh: jest.fn(async call => call()) }));
jest.mock('../src/lib/token-store', () => ({ getSessionGeneration: () => mockGeneration, getAccessToken: jest.fn(async () => 'token') }));
jest.mock('../src/lib/env', () => ({ DEFAULT_LOCATION_ID: 'store', getApiBase: () => 'https://api.example.com' }));
jest.mock('../src/lib/api', () => ({ ...jest.requireActual('../src/lib/api'), apiFetch: jest.fn() }));
jest.mock('../src/lib/realtime', () => ({ createOrdersSocket: jest.fn() }));
jest.mock('../src/components/order-history', () => ({ OrderReorderAction: () => null }));
const { apiFetch } = require('../src/lib/api');
const { createOrdersSocket } = require('../src/lib/realtime');
const { REFRESH_COALESCE_MS } = require('../src/lib/order-realtime');
const Screen = require('../app/orders/[id]').default;

const ORDER_PATH = '/api/v1/orders/order-1';
const CHAT_PATH = '/api/v1/orders/order-1/chat';
const refreshWarning = "Couldn't refresh order. Showing the last available details.";
let server, sockets;
const ok = data => ({ ok: true, status: 200, json: async () => ({ data }) });
const orderRow = status => ({
  id: 'order-1', location_id: 'store-location', customer_user_id: 'customer', order_number: 1061, status,
  fulfillment_type: 'PICKUP', placed_at: '2026-10-19T10:00:00Z', items: [], status_events: [],
  item_subtotal_cents: 1000, item_discount_total_cents: 0, order_discount_total_cents: 0, delivery_fee_cents: 0,
  tax_cents: 130, tax_rate_bps: 1300, driver_tip_cents: 0, wallet_applied_cents: 0, final_payable_cents: 1130,
});
const gets = path => apiFetch.mock.calls.filter(([called]) => called === path).length;
const texts = () => renderer.root.findAllByType('Text').map(node => node.children.join(''));
const byLabel = label => renderer.root.findAllByType('TouchableOpacity').find(node => node.props.accessibilityLabel === label);
const tap = label => act(async () => byLabel(label).props.onPress());
const advance = ms => act(async () => { await jest.advanceTimersByTimeAsync(ms); });
const mount = () => act(async () => { renderer = create(React.createElement(Screen)); });
async function mountLive() {
  await mount();
  await act(async () => { sockets[0].serverConnect(); sockets[0].ackAll(); });
  return sockets[0];
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockAppStateListeners.clear();
  mockGeneration = 1;
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer', role: 'CUSTOMER' }, refresh: jest.fn(async () => true), clear: jest.fn() };
  server = { status: 'PLACED', nextOrderResponses: [] };
  sockets = [];
  createOrdersSocket.mockImplementation(() => {
    const fake = createFakeSocket();
    sockets.push(fake);
    return fake.socket;
  });
  apiFetch.mockImplementation(async path => {
    if (path === ORDER_PATH) return server.nextOrderResponses.shift() ?? ok(orderRow(server.status));
    if (path === CHAT_PATH) return ok({ messages: [], conversation_id: null, is_closed: false });
    throw new Error(`Unexpected request ${path}`);
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  jest.useRealTimers();
});

test('a KDS accept moves the open order to Preparing without a manual refresh', async () => {
  await mount();
  expect(texts()).toEqual(expect.arrayContaining(['Order placed', 'Connecting live updates']));
  const socket = sockets[0];
  expect(socket.socket.connect).toHaveBeenCalledTimes(1);

  await act(async () => { socket.serverConnect(); socket.ack('order:order-1'); });
  expect(texts()).toContain('Connecting live updates');
  await act(async () => socket.ack('chat:order-1'));
  expect(texts()).toContain('Live updates connected');
  expect(gets(ORDER_PATH)).toBe(2);

  server.status = 'PREPARING';
  await act(async () => {
    socket.emitEvent('order.accepted', { order_id: 'order-1', from_status: 'PLACED', to_status: 'ACCEPTED' });
    socket.emitEvent('order.status_changed', { order_id: 'order-1', from_status: 'ACCEPTED', to_status: 'PREPARING' });
  });
  await advance(REFRESH_COALESCE_MS);

  expect(gets(ORDER_PATH)).toBe(3);
  expect(texts()).toEqual(expect.arrayContaining(['Preparing your order', 'Live updates connected']));
  expect(texts()).not.toContain(refreshWarning);
  expect(createOrdersSocket).toHaveBeenCalledTimes(1);
});

test('a failed refresh keeps the last order with a diagnostic reference until the next success', async () => {
  const socket = await mountLive();
  server.nextOrderResponses.push({ ok: false, status: 503, json: async () => ({
    data: null, meta: { request_id: 'req-123' }, errors: [{ code: 'SERVICE_UNAVAILABLE', message: 'Temporarily unavailable' }],
  }) });
  await act(async () => socket.emitEvent('order.status_changed', { to_status: 'PREPARING' }));
  await advance(REFRESH_COALESCE_MS);

  expect(texts()).toEqual(expect.arrayContaining([
    'Order placed', refreshWarning, 'Temporarily unavailable (HTTP 503 · SERVICE_UNAVAILABLE · ref req-123)', 'Live updates connected',
  ]));
  expect(texts().join(' ')).not.toContain('token');

  server.status = 'PREPARING';
  await tap('Retry order refresh');
  expect(texts()).not.toContain(refreshWarning);
  expect(texts()).toContain('Preparing your order');
});

test('a non-JSON gateway error is reported with its HTTP status', async () => {
  const socket = await mountLive();
  server.nextOrderResponses.push({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  await act(async () => socket.emitEvent('order.eta_updated'));
  await advance(REFRESH_COALESCE_MS);
  expect(texts()).toEqual(expect.arrayContaining(['Order placed', refreshWarning, 'Unable to load order. (HTTP 502)']));
});

test('a session change replaces the socket without duplicate listeners, and unmount cleans up', async () => {
  const first = await mountLive();
  const perSocket = first.listenerCount();
  mockGeneration += 1;
  await act(async () => renderer.update(React.createElement(Screen)));

  expect(first.listenerCount()).toBe(0);
  expect(first.socket.disconnect).toHaveBeenCalledTimes(1);
  expect(sockets).toHaveLength(2);
  expect(sockets[1].listenerCount()).toBe(perSocket);

  const before = gets(ORDER_PATH);
  first.emitEvent('order.status_changed');
  await advance(REFRESH_COALESCE_MS);
  expect(gets(ORDER_PATH)).toBe(before);

  await act(async () => renderer.unmount());
  renderer = null;
  expect(sockets[1].listenerCount()).toBe(0);
  expect(sockets[1].socket.disconnect).toHaveBeenCalledTimes(1);
});

test('returning to the foreground refetches the live order and chat', async () => {
  await mountLive();
  const orders = gets(ORDER_PATH);
  const chats = gets(CHAT_PATH);
  await act(async () => { for (const listener of mockAppStateListeners) listener('active'); });
  expect(gets(ORDER_PATH)).toBe(orders + 1);
  expect(gets(CHAT_PATH)).toBe(chats + 1);
});

test('while live updates are unavailable the order keeps refreshing, and Retry reconnects', async () => {
  await mount();
  const socket = sockets[0];
  await act(async () => { socket.connectError(); socket.connectError(); socket.connectError(); });
  expect(texts()).toContain('Live updates unavailable');

  const before = gets(ORDER_PATH);
  await advance(30_000);
  expect(gets(ORDER_PATH)).toBe(before + 1);

  await tap('Retry live updates');
  expect(mockSession.refresh).toHaveBeenCalledTimes(1);
  expect(socket.socket.connect).toHaveBeenCalledTimes(2);
  await act(async () => { socket.serverConnect(); socket.ackAll(); });
  expect(texts()).toContain('Live updates connected');
  expect(byLabel('Retry live updates')).toBeUndefined();

  const live = gets(ORDER_PATH);
  await advance(90_000);
  expect(gets(ORDER_PATH)).toBe(live);
});
