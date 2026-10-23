const React = require('react');
const { act, create } = require('react-test-renderer');
const { createFakeSocket } = require('./fake-socket.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, mockGeneration, renderer, mockFocused = true, mockOrderId = 'order-1';
const mockOpenURL = jest.fn(async () => {});
const mockAppStateListeners = new Set();
jest.mock('react-native', () => ({
  ...require('./skeleton-native-mock.cjs').createNativeSkeletonMock(),
  RefreshControl: 'RefreshControl', ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' }, Linking: { openURL: (...args) => mockOpenURL(...args) }, StyleSheet: { create: value => value }, AccessibilityInfo: { ...require('./skeleton-native-mock.cjs').createNativeSkeletonMock().AccessibilityInfo, setAccessibilityFocus: jest.fn() }, findNodeHandle: () => null,
  AppState: { currentState: 'active', addEventListener: jest.fn((_, listener) => {
    mockAppStateListeners.add(listener);
    return { remove: () => mockAppStateListeners.delete(listener) };
  }) },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_, name) => name }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused, useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({ id: mockOrderId }) }));
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
  id: 'order-1', location_id: 'store-location', cancel_allowed_until: '2020-01-01', customer_user_id: 'customer', order_number: 1061, status,
  fulfillment_type: 'PICKUP', placed_at: '2026-10-19T10:00:00Z', items: [], status_events: [{id:'placed',to_status:'PLACED',created_at:'2026-10-19T10:00:00Z'}],
  item_subtotal_cents: 1000, item_discount_total_cents: 0, order_discount_total_cents: 0, delivery_fee_cents: 0,
  tax_cents: 130, tax_rate_bps: 1300, driver_tip_cents: 0, wallet_applied_cents: 0, final_payable_cents: 1130, ...server?.orderOverrides,
});
const gets = path => apiFetch.mock.calls.filter(([called]) => called === path).length;
const texts = () => renderer.root.findAllByType('Text').map(node => node.children.join(''));
const byLabel = label => renderer.root.findAllByType('TouchableOpacity').find(node => node.props.accessibilityLabel === label);
const tap = label => act(async () => { const node=byLabel(label); if (node && !node.props.disabled) return node.props.onPress(); });
const refreshOrder = () => act(async () => renderer.root.findByType('ScrollView').props.refreshControl.props.onRefresh());
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
  mockGeneration = 1; mockFocused = true; mockOrderId = 'order-1';
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer', role: 'CUSTOMER' }, refresh: jest.fn(async () => true), clear: jest.fn() };
  server = { status: 'PLACED', nextOrderResponses: [], orderOverrides: {cancel_allowed_until: new Date(Date.now()-1000).toISOString()} };
  sockets = [];
  createOrdersSocket.mockImplementation(() => {
    const fake = createFakeSocket();
    sockets.push(fake);
    return fake.socket;
  });
  apiFetch.mockImplementation(async (path, init) => {
    if (path === ORDER_PATH) return server.nextOrderResponses.shift() ?? ok(orderRow(server.status));
    if (path === ORDER_PATH + '/cancel') {
      if (server.cancelResponse) return server.cancelResponse;
      server.status = 'CANCELLED'; return ok({ id: 'order-1', status: 'CANCELLED' });
    }
    if (path === CHAT_PATH && init?.method === 'POST') {
      server.messages = [...(server.messages ?? []), { id: 'sent', sender_surface: 'CUSTOMER', message_body: JSON.parse(init.body).message_body, created_at: new Date().toISOString() }];
      return ok({ id: 'sent' });
    }
    if (path === CHAT_PATH) return ok({ messages: server.messages ?? [], conversation_id: null, is_closed: server.closed ?? false });
    throw new Error(`Unexpected request ${path}`);
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  jest.useRealTimers();
});

test.each([
  ['PICKED_UP', 'Picked up'], ['DELIVERED', 'Delivered'],
  ['NO_SHOW_PICKUP', 'No-show (not picked up)'], ['NO_SHOW_DELIVERY', 'Delivery not completed'],
  ['NO_PIN_DELIVERY', 'Delivery completed without PIN'], ['CANCELLED', 'Order cancelled'],
])('KDS %s shows the final status, stops tracking, and preserves unpaid history', async (status, label) => {
  const socket = await mountLive();
  server.status = status;
  server.orderOverrides = { payment_status_summary: 'UNPAID', payment_summary: { outstanding_cents: 1130 } };
  await act(async () => socket.emitEvent('order.status_changed'));
  await advance(REFRESH_COALESCE_MS);
  expect(texts()).toContain(label);
  expect(socket.socket.disconnect).toHaveBeenCalledTimes(1);
  expect(socket.listenerCount()).toBe(0);
  const requests = gets(ORDER_PATH);
  await advance(120_000);
  expect(gets(ORDER_PATH)).toBe(requests);
  expect(byLabel('Cancel order')).toBeUndefined();
  expect(renderer.root.findByType('ScrollView').props.refreshControl).toBeUndefined();
});

test('a KDS accept moves the open order to Preparing without a manual refresh', async () => {
  await mount();
  expect(texts()).toContain('Order placed');
  expect(texts().join(' ')).not.toMatch(/Live updates|Connecting live/);
  const socket = sockets[0];
  expect(socket.socket.connect).toHaveBeenCalledTimes(1);

  await act(async () => { socket.serverConnect(); socket.ack('order:order-1'); });
  expect(gets(ORDER_PATH)).toBe(1);
  await act(async () => socket.ack('chat:order-1'));
  expect(texts().join(' ')).not.toMatch(/Live updates|Connecting live/);
  expect(gets(ORDER_PATH)).toBe(2);

  server.status = 'PREPARING';
  await act(async () => {
    socket.emitEvent('order.accepted', { order_id: 'order-1', from_status: 'PLACED', to_status: 'ACCEPTED' });
    socket.emitEvent('order.status_changed', { order_id: 'order-1', from_status: 'ACCEPTED', to_status: 'PREPARING' });
  });
  await advance(REFRESH_COALESCE_MS);

  expect(gets(ORDER_PATH)).toBe(3);
  expect(texts()).toEqual(expect.arrayContaining(['Preparing your order']));
  expect(texts()).not.toContain(refreshWarning);
  expect(createOrdersSocket).toHaveBeenCalledTimes(1);
});

test('a failed refresh keeps the last order with a diagnostic reference until the next success', async () => {
  const socket = await mountLive();
  expect(byLabel('Order Chat')).toBeDefined();
  server.nextOrderResponses.push({ ok: false, status: 503, json: async () => ({
    data: null, meta: { request_id: 'req-123' }, errors: [{ code: 'SERVICE_UNAVAILABLE', message: 'Temporarily unavailable' }],
  }) });
  await act(async () => socket.emitEvent('order.status_changed', { to_status: 'PREPARING' }));
  await advance(REFRESH_COALESCE_MS);

  expect(texts()).toEqual(expect.arrayContaining([
    'Order placed', refreshWarning, 'Temporarily unavailable (HTTP 503 · SERVICE_UNAVAILABLE · ref req-123)',
  ]));
  expect(texts().join(' ')).not.toContain('token');
  expect(byLabel('Order Chat')).toBeUndefined(); expect(byLabel('Help')).toBeUndefined();

  server.status = 'PREPARING';
  await tap('Retry order refresh');
  expect(texts()).not.toContain(refreshWarning);
  expect(texts()).toContain('Preparing your order');
  expect(byLabel('Order Chat')).toBeDefined(); expect(byLabel('Help')).toBeDefined();
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

test('Refresh order recovers when the live-update socket could not be created', async () => {
  createOrdersSocket.mockImplementationOnce(() => { throw new Error('Realtime origin unavailable'); });
  await mount();
  expect(texts()).toContain('Order placed');
  expect(sockets).toHaveLength(0);

  await refreshOrder();
  expect(createOrdersSocket).toHaveBeenCalledTimes(2);
  expect(sockets[0].socket.connect).toHaveBeenCalledTimes(1);
  await act(async () => { sockets[0].serverConnect(); sockets[0].ackAll(); });
  expect(texts().join(' ')).not.toMatch(/Live updates|Connecting live/);
});

test('while live updates are unavailable the order keeps refreshing, and Retry reconnects', async () => {
  await mount();
  const socket = sockets[0];
  await act(async () => { socket.connectError(); socket.connectError(); socket.connectError(); });
  expect(byLabel('Retry live updates')).toBeUndefined();

  const before = gets(ORDER_PATH);
  await advance(30_000);
  expect(gets(ORDER_PATH)).toBe(before + 1);

  await refreshOrder();
  expect(mockSession.refresh).toHaveBeenCalledTimes(1);
  expect(socket.socket.connect).toHaveBeenCalledTimes(2);
  await act(async () => { socket.serverConnect(); socket.ackAll(); });
  expect(texts().join(' ')).not.toMatch(/Live updates|Connecting live/);
  expect(byLabel('Retry live updates')).toBeUndefined();

  const live = gets(ORDER_PATH);
  await advance(90_000);
  expect(gets(ORDER_PATH)).toBe(live);
});

const futureDeadline = () => new Date(Date.now() + 120_000).toISOString();
const cancelPosts = () => apiFetch.mock.calls.filter(([path, init]) => path.endsWith('/cancel') && init.method === 'POST');
const messages = () => renderer.root.findAllByType('Text').map(node => node.children.join(''));
const typeMessage = value => act(async () => renderer.root.findByType('TextInput').props.onChangeText(value));

test.each(['PLACED', 'ACCEPTED'])('%s uses its existing deadline and automatically replaces Cancel with Help', async status => {
  server.status = status; server.orderOverrides = { cancel_allowed_until: futureDeadline() };
  await mountLive();
  expect(byLabel('Cancel order')).toBeDefined(); expect(byLabel('Order Chat')).toBeUndefined();
  expect(byLabel('Help')).toBeUndefined();
  await tap('Cancel order'); expect(messages()).toContain('Cancel this order?');
  // No status event or API change is needed to expire this action.
  await advance(120_000);
  expect(byLabel('Cancel order')).toBeUndefined(); expect(byLabel('Help')).toBeDefined();
  expect(renderer.root.findAllByType('Modal')).toHaveLength(0);
  expect(cancelPosts()).toHaveLength(0);
});

test.each(['PREPARING', 'READY', 'OUT_FOR_DELIVERY'])('%s immediately replaces cancellation and dismisses confirmation after realtime refresh', async status => {
  server.orderOverrides = { cancel_allowed_until: futureDeadline() };
  const socket = await mountLive(); await tap('Cancel order');
  server.status = status;
  await act(async () => socket.emitEvent('order.status_changed', { to_status: status }));
  await advance(REFRESH_COALESCE_MS);
  expect(byLabel('Cancel order')).toBeUndefined(); expect(byLabel('Help')).toBeDefined();
  expect(byLabel('Order Chat')).toBeDefined(); expect(messages()).not.toContain('Cancel this order?');
});

test.each(['PLACED', 'ACCEPTED'])('%s after expiry offers Chat and Help', async status => {
  server.status = status; server.orderOverrides = { cancel_allowed_until: new Date(Date.now() - 1).toISOString() };
  await mount(); expect(byLabel('Cancel order')).toBeUndefined();
  expect(byLabel('Order Chat')).toBeDefined(); expect(byLabel('Help')).toBeDefined();
});

test('cancellation sends an empty payload under the actual location, refreshes and displays server CANCELLED', async () => {
  server.orderOverrides = { cancel_allowed_until: futureDeadline() };
  await mount(); await tap('Cancel order');
  expect(messages().join(' ')).toContain('Are you sure you want to cancel order #1061? This cannot be undone once confirmed.');
  await tap('Yes, cancel order');
  expect(cancelPosts()).toHaveLength(1);
  expect(cancelPosts()[0][1]).toMatchObject({ locationId: 'store-location', expectedSessionGeneration: 1, body: '{}' });
  expect(messages()).toContain('Order cancelled'); expect(byLabel('Cancel order')).toBeUndefined();
  expect(byLabel('Help')).toBeUndefined(); expect(byLabel('Order Chat')).toBeUndefined();
});

test('a backend conflict refreshes immediately, shows the real error, and overrides a stale eligible order', async () => {
  server.orderOverrides = { cancel_allowed_until: futureDeadline() };
  server.cancelResponse = { ok: false, status: 409, json: async () => ({ errors: [{ message: 'The kitchen has started preparing your order.' }] }) };
  await mount(); await tap('Cancel order'); const before = gets(ORDER_PATH);
  server.status = 'PREPARING';
  await tap('Yes, cancel order');
  expect(gets(ORDER_PATH)).toBe(before + 1);
  expect(messages()).toContain('The kitchen has started preparing your order.');
  expect(messages()).not.toContain('Order cancelled'); expect(byLabel('Cancel order')).toBeUndefined();
  expect(byLabel('Help')).toBeDefined(); expect(byLabel('Order Chat')).toBeDefined();
});

test.each(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'])(
  '%s with no cancellation deadline matches the website hidden action row', async status => {
    server.status = status; server.orderOverrides = { cancel_allowed_until: null };
    await mount(); expect(byLabel('Cancel order')).toBeUndefined(); expect(byLabel('Order Chat')).toBeUndefined(); expect(byLabel('Help')).toBeUndefined();
  });

test('a retryable cancellation error remains in the website confirmation modal without fabricating cancellation', async () => {
  server.orderOverrides = { cancel_allowed_until: futureDeadline() };
  server.cancelResponse = { ok: false, status: 503, json: async () => ({ errors: [{ message: 'Please try again later' }] }) };
  await mount(); await tap('Cancel order'); await tap('Yes, cancel order');
  expect(messages()).toContain('Cancel this order?'); expect(messages()).toContain('Please try again later');
  expect(messages()).not.toContain('Order cancelled'); expect(byLabel('Keep order').props.disabled).toBe(false);
  await tap('Keep order'); expect(renderer.root.findAllByType('Modal')).toHaveLength(0);
});

test('double confirmation and reopening during a pending cancellation cannot duplicate the POST', async () => {
  let resolve; server.cancelResponse = new Promise(r => { resolve = r; });
  server.orderOverrides = { cancel_allowed_until: futureDeadline() };
  await mount(); await tap('Cancel order');
  const confirm = byLabel('Yes, cancel order').props.onPress;
  await act(async () => { confirm(); confirm(); });
  expect(cancelPosts()).toHaveLength(1); expect(byLabel('Yes, cancel order').props.disabled).toBe(true);
  expect(byLabel('Keep order').props.disabled).toBe(true);
  await tap('Keep order'); expect(messages()).toContain('Cancel this order?');
  await act(async () => resolve({ ok: false, status: 503, json: async () => ({ errors: [{ message: 'Try again later' }] }) }));
  expect(messages()).toContain('Try again later'); expect(messages()).not.toContain('Order cancelled');
});

test('foreground rechecks an expired deadline even if the deadline callback was suspended', async () => {
  server.orderOverrides = { cancel_allowed_until: futureDeadline() };
  await mountLive(); expect(byLabel('Cancel order')).toBeDefined();
  jest.setSystemTime(Date.now() + 130_000);
  await act(async () => { for (const listener of [...mockAppStateListeners]) listener('active'); });
  expect(byLabel('Cancel order')).toBeUndefined(); expect(byLabel('Help')).toBeDefined();
});

test('Help uses the actual store telephone and switches to the same chat modal', async () => {
  server.status = 'READY'; server.orderOverrides = { location_phone: '+1 (519) 555-1234' };
  await mount(); await tap('Help');
  expect(messages()).toContain('Your order is already prepared and can no longer be cancelled here. To request a cancellation, please contact us.');
  await tap('Contact us \u00b7 +1 (519) 555-1234'); expect(mockOpenURL).toHaveBeenCalledWith('tel:+15195551234');
  await tap('Chat with us');
  expect(messages()).toContain('Order Chat'); expect(messages()).not.toContain('Need help with this order?');
  expect(renderer.root.findAllByType('Modal')).toHaveLength(1);
  await tap('Close chat'); expect(renderer.root.findAllByType('Modal')).toHaveLength(0);
  expect(apiFetch.mock.calls.some(([path]) => path.includes('support/tickets'))).toBe(false);
});

test('Help without a phone keeps chat available and describes preparation', async () => {
  server.status = 'PREPARING'; await mount(); await tap('Help');
  expect(messages()).toContain('Store phone is not available. You can chat with us here instead.');
  expect(messages().join(' ')).toContain('Cancellation might not be possible');
  expect(byLabel('Contact us \u00b7 +1 (519) 555-1234')).toBeUndefined(); expect(byLabel('Chat with us')).toBeDefined();
  await tap('Close'); expect(renderer.root.findAllByType('Modal')).toHaveLength(0);
});

test('chat opens, sorts history, sends once, receives realtime messages, and closes with native back', async () => {
  server.messages = [
    { id: 'new', sender_surface: 'KDS', message_body: 'Preparing now', created_at: '2026-10-20T15:01:00Z' },
    { id: 'old', sender_surface: 'CUSTOMER', message_body: 'Hello', created_at: '2026-10-20T15:00:00Z' },
  ];
  const socket = await mountLive();
  expect(messages()).not.toContain('Preparing now'); // no always-visible conversation
  await tap('Order Chat');
  expect(messages().indexOf('Hello')).toBeLessThan(messages().indexOf('Preparing now'));
  await typeMessage('Thank you'); const send = byLabel('Send').props.onPress;
  await act(async () => { send(); send(); });
  const posts = apiFetch.mock.calls.filter(([path, init]) => path === CHAT_PATH && init?.method === 'POST');
  expect(posts).toHaveLength(1); expect(posts[0][1].locationId).toBe('store-location');
  expect(renderer.root.findByType('TextInput').props.value).toBe('');
  server.messages.push({ id: 'staff', sender_surface: 'KDS', message_body: 'See you soon', created_at: new Date().toISOString() });
  await act(async () => socket.emitEvent('chat.message')); await advance(REFRESH_COALESCE_MS);
  expect(messages()).toContain('See you soon');
  await act(async () => renderer.root.findByType('Modal').props.onRequestClose());
  expect(renderer.root.findAllByType('Modal')).toHaveLength(0);
});

test('quick messages populate the draft, empty sends are disabled, and closed conversations cannot send', async () => {
  await mount(); await tap('Order Chat'); expect(byLabel('Send').props.disabled).toBe(true);
  await tap('Where is my order?'); expect(renderer.root.findByType('TextInput').props.value).toBe('Where is my order?');
  await tap('Send'); expect(messages()).toContain('Where is my order?');
  server.closed = true;
  await tap('Close chat'); await tap('Order Chat');
  expect(messages()).toContain('Order Chat (closed)');
  expect(renderer.root.findAllByType('TextInput')).toHaveLength(0); expect(byLabel('Send')).toBeUndefined();
});

test.each(['PICKED_UP', 'DELIVERED', 'CANCELLED', 'NO_SHOW_PICKUP', 'NO_SHOW_DELIVERY', 'NO_PIN_DELIVERY'])(
  '%s closes active modals and exposes feedback only for supported completed statuses', async status => {
    const socket = await mountLive(); await tap('Order Chat'); server.status = status;
    await act(async () => socket.emitEvent('order.status_changed', { to_status: status })); await advance(REFRESH_COALESCE_MS);
    expect(byLabel('Cancel order')).toBeUndefined(); expect(byLabel('Order Chat')).toBeUndefined();
    expect(renderer.root.findAllByType('Modal')).toHaveLength(0);
    const completed = status === 'PICKED_UP' || status === 'DELIVERED';
    expect(Boolean(byLabel('Help'))).toBe(completed); expect(byLabel('Rate your Order')).toBeUndefined(); // Fixture has no items, matching website review guard.
  });

test.each(['account', 'order', 'blur'])('%s switching dismisses chat and never exposes the old draft', async change => {
  await mount(); await tap('Order Chat'); await typeMessage('Private draft');
  if (change === 'account') { mockGeneration++; mockSession = { ...mockSession, user: { id: 'other', role: 'CUSTOMER' } }; }
  if (change === 'order') mockOrderId = 'other-order';
  if (change === 'blur') mockFocused = false;
  await act(async () => renderer.update(React.createElement(Screen)));
  expect(renderer.root.findAllByType('Modal')).toHaveLength(0);
  expect(messages()).not.toContain('Private draft');
  expect(byLabel('Order Chat')).toBeUndefined();
});

test.each(['account', 'order', 'blur'])('%s switch invalidates a pending cancellation and its old confirmation callback', async change => {
  let resolve; server.cancelResponse = new Promise(r => { resolve = r; });
  server.orderOverrides = { cancel_allowed_until: futureDeadline() };
  await mount(); await tap('Cancel order'); const oldConfirm = byLabel('Yes, cancel order').props.onPress;
  await act(async () => { oldConfirm(); }); expect(cancelPosts()).toHaveLength(1);
  if (change === 'account') { mockGeneration++; mockSession = { ...mockSession, user: { id: 'other', role: 'CUSTOMER' } }; }
  if (change === 'order') mockOrderId = 'other-order';
  if (change === 'blur') mockFocused = false;
  await act(async () => renderer.update(React.createElement(Screen)));
  const before = gets(ORDER_PATH);
  await act(async () => resolve({ ok: false, status: 409, json: async () => ({ errors: [{ message: 'Private old error' }] }) }));
  await act(async () => oldConfirm());
  expect(cancelPosts()).toHaveLength(1); expect(gets(ORDER_PATH)).toBe(before);
  expect(messages()).not.toContain('Private old error'); expect(renderer.root.findAllByType('Modal')).toHaveLength(0);
});

test('returning to a focused screen rechecks the original deadline and cleans up foreground listeners', async () => {
  server.orderOverrides = { cancel_allowed_until: futureDeadline() };
  await mountLive(); expect(byLabel('Cancel order')).toBeDefined();
  mockFocused = false; await act(async () => renderer.update(React.createElement(Screen)));
  jest.setSystemTime(Date.now() + 130_000);
  mockFocused = true; await act(async () => renderer.update(React.createElement(Screen)));
  expect(byLabel('Cancel order')).toBeUndefined(); expect(byLabel('Help')).toBeDefined();
  await act(async () => renderer.unmount()); renderer = null;
  expect(mockAppStateListeners.size).toBe(0);
});

test('KDS preparation during token refresh prevents a retry of the cancellation POST', async () => {
  const { withSilentRefresh } = require('../src/context/session');
  server.orderOverrides = { cancel_allowed_until: futureDeadline() };
  const socket = await mountLive(); await tap('Cancel order');
  let retry, resolveRefresh;
  withSilentRefresh.mockImplementationOnce(async call => {
    retry = call;
    return new Promise(resolve => { resolveRefresh = resolve; });
  });
  await act(async () => byLabel('Yes, cancel order').props.onPress());
  server.status = 'PREPARING';
  await act(async () => socket.emitEvent('order.status_changed')); await advance(REFRESH_COALESCE_MS);
  expect(() => retry()).toThrow('Cancellation is no longer available');
  expect(cancelPosts()).toHaveLength(0); expect(byLabel('Cancel order')).toBeUndefined();
  await act(async () => resolveRefresh({ ok: false, status: 409, json: async () => ({ errors: [{ message: 'Already preparing' }] }) }));
});

test('cancellation.decided follows the website realtime refresh path', async () => {
  const socket = await mountLive(); const before = gets(ORDER_PATH); server.status = 'CANCELLED';
  await act(async () => socket.emitEvent('cancellation.decided')); await advance(REFRESH_COALESCE_MS);
  expect(gets(ORDER_PATH)).toBe(before + 1); expect(messages()).toContain('Order cancelled'); expect(byLabel('Order Chat')).toBeUndefined();
});

test('history matches website events, including add-items details; absent events do not invent a timeline', async () => {
  server.orderOverrides = { status_events: [
    { id: 'placed', to_status: 'PLACED', created_at: '2026-10-19T10:00:00Z', reason_text: 'Order submitted' },
    { id: 'added', to_status: 'PREPARING', event_type: 'CHANGE_REQUEST_APPROVED', reason_text: 'Add-items request abc approved (+450 cents)', created_at: '2026-10-19T10:01:00Z' },
  ] };
  await mount(); expect(messages()).toContain('Item added'); expect(messages()).toContain('Additional item - $4.50');
  await tap('View all status updates'); expect(messages()).toContain('Order submitted');
  server.orderOverrides = { status_events: [] }; await refreshOrder();
  expect(byLabel('View all status updates')).toBeUndefined(); expect(messages()).not.toContain('Order status');
});
