const { createFakeSocket } = require('./fake-socket.cjs');
const {
  startOrderRealtime, ORDER_REFRESH_EVENTS, CHAT_REFRESH_EVENTS, SUBSCRIBE_ACK_TIMEOUT_MS,
  MAX_RECOVERY_ATTEMPTS, RECOVERY_BASE_DELAY_MS, REFRESH_COALESCE_MS,
} = require('../src/lib/order-realtime');

const ORDER = 'order:order-1';
const CHAT = 'chat:order-1';

function start(overrides = {}) {
  const fake = createFakeSocket();
  const statuses = [];
  const options = {
    orderId: 'order-1',
    createSocket: jest.fn(() => fake.socket),
    refreshSession: jest.fn(async () => true),
    onStatus: jest.fn(status => statuses.push(status)),
    onOrderChanged: jest.fn(),
    onChatChanged: jest.fn(),
    ...overrides,
  };
  const handle = startOrderRealtime(options);
  return { fake, statuses, options, handle };
}

function startLive(overrides) {
  const started = start(overrides);
  started.fake.serverConnect();
  started.fake.ackAll();
  started.options.onOrderChanged.mockClear();
  started.options.onChatChanged.mockClear();
  return started;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('reports live only after both order and chat acknowledgements, then refetches once', () => {
  const { fake, statuses, options } = start();
  expect(fake.socket.connect).toHaveBeenCalledTimes(1);
  expect(statuses).toEqual(['connecting']);

  fake.serverConnect();
  expect(fake.pendingChannels()).toEqual([ORDER, CHAT]);
  fake.ack(ORDER);
  expect(statuses).toEqual(['connecting']);
  expect(options.onOrderChanged).not.toHaveBeenCalled();

  fake.ack(CHAT);
  expect(statuses).toEqual(['connecting', 'live']);
  expect(options.onOrderChanged).toHaveBeenCalledTimes(1);
  expect(options.onChatChanged).toHaveBeenCalledTimes(1);
});

test('coalesces the KDS accept burst into one authoritative order refetch', async () => {
  const { fake, options } = startLive();
  fake.emitEvent('order.accepted', { to_status: 'ACCEPTED' });
  fake.emitEvent('order.status_changed', { to_status: 'PREPARING' });
  expect(options.onOrderChanged).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(REFRESH_COALESCE_MS);
  expect(options.onOrderChanged).toHaveBeenCalledTimes(1);

  for (const event of ORDER_REFRESH_EVENTS) {
    fake.emitEvent(event);
    await jest.advanceTimersByTimeAsync(REFRESH_COALESCE_MS);
  }
  expect(options.onOrderChanged).toHaveBeenCalledTimes(1 + ORDER_REFRESH_EVENTS.length);
  for (const event of CHAT_REFRESH_EVENTS) {
    fake.emitEvent(event);
    await jest.advanceTimersByTimeAsync(REFRESH_COALESCE_MS);
  }
  expect(options.onChatChanged).toHaveBeenCalledTimes(CHAT_REFRESH_EVENTS.length);
});

test.each([
  'Insufficient permissions - order owner required',
  'Order not found',
  'Invalid order id',
])('permanent denial "%s" is unavailable and never retried', async error => {
  const { fake, statuses, options } = start();
  fake.serverConnect();
  fake.ack(ORDER, { subscribed: false, channel: ORDER, error });
  expect(statuses.at(-1)).toBe('unavailable');
  fake.ack(CHAT);
  expect(statuses.at(-1)).toBe('unavailable');

  await jest.advanceTimersByTimeAsync(10 * 60_000);
  expect(fake.socket.connect).toHaveBeenCalledTimes(1);
  expect(fake.socket.timeout).toHaveBeenCalledTimes(2);
  expect(options.refreshSession).not.toHaveBeenCalled();
  expect(options.onOrderChanged).not.toHaveBeenCalled();
});

test('a missing acknowledgement times out and recovers on a fresh connection with refreshed credentials', async () => {
  const { fake, statuses, options } = start();
  fake.serverConnect();
  fake.ack(ORDER);

  await jest.advanceTimersByTimeAsync(SUBSCRIBE_ACK_TIMEOUT_MS);
  expect(fake.socket.disconnect).toHaveBeenCalledTimes(1);
  expect(statuses.at(-1)).toBe('connecting');
  expect(options.refreshSession).not.toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(RECOVERY_BASE_DELAY_MS);
  expect(options.refreshSession).toHaveBeenCalledTimes(1);
  expect(fake.socket.connect).toHaveBeenCalledTimes(2);

  fake.serverConnect();
  fake.ackAll();
  expect(statuses.at(-1)).toBe('live');
  expect(options.onOrderChanged).toHaveBeenCalledTimes(1);
});

test('rejected credentials refresh the session before each reconnect, with capped backoff that stops', async () => {
  const { fake, statuses, options } = start();
  const sequence = [];
  options.refreshSession.mockImplementation(async () => { sequence.push('refresh'); return true; });
  fake.socket.connect.mockImplementation(() => sequence.push('connect'));
  fake.serverConnect();
  fake.serverDisconnect('io server disconnect');

  for (let attempt = 0; attempt < MAX_RECOVERY_ATTEMPTS; attempt += 1) {
    const delay = RECOVERY_BASE_DELAY_MS * 2 ** attempt;
    await jest.advanceTimersByTimeAsync(delay - 1);
    expect(options.refreshSession).toHaveBeenCalledTimes(attempt);
    await jest.advanceTimersByTimeAsync(1);
    expect(options.refreshSession).toHaveBeenCalledTimes(attempt + 1);
    fake.serverConnect();
    fake.serverDisconnect('io server disconnect');
  }

  expect(statuses.at(-1)).toBe('unavailable');
  await jest.advanceTimersByTimeAsync(60 * 60_000);
  expect(options.refreshSession).toHaveBeenCalledTimes(MAX_RECOVERY_ATTEMPTS);
  expect(sequence).toEqual(Array.from({ length: MAX_RECOVERY_ATTEMPTS }, () => ['refresh', 'connect']).flat());
});

test('a failed session refresh still reconnects so the gateway decides', async () => {
  const { fake, options } = start({ refreshSession: jest.fn(async () => { throw new Error('offline'); }) });
  fake.serverConnect();
  fake.serverDisconnect('io server disconnect');
  await jest.advanceTimersByTimeAsync(RECOVERY_BASE_DELAY_MS);
  expect(options.refreshSession).toHaveBeenCalledTimes(1);
  expect(fake.socket.connect).toHaveBeenCalledTimes(2);
});

test('transport drops use socket.io reconnection, then resubscribe and refetch missed events', async () => {
  const { fake, statuses, options } = startLive();
  fake.serverDisconnect('transport close');
  expect(statuses.at(-1)).toBe('connecting');

  await jest.advanceTimersByTimeAsync(60_000);
  expect(fake.socket.connect).toHaveBeenCalledTimes(1);
  expect(options.refreshSession).not.toHaveBeenCalled();

  fake.serverConnect();
  expect(fake.pendingChannels()).toEqual([ORDER, CHAT]);
  fake.ackAll();
  expect(statuses.at(-1)).toBe('live');
  expect(options.onOrderChanged).toHaveBeenCalledTimes(1);
  expect(options.onChatChanged).toHaveBeenCalledTimes(1);
});

test('acknowledgements cut short by a dropped connection are not treated as failures', async () => {
  const { fake, statuses } = start();
  fake.serverConnect();
  fake.serverDisconnect('ping timeout');
  await jest.advanceTimersByTimeAsync(SUBSCRIBE_ACK_TIMEOUT_MS * 2);
  expect(fake.socket.disconnect).not.toHaveBeenCalled();
  fake.serverConnect();
  fake.ackAll();
  expect(statuses.at(-1)).toBe('live');
});

test('a transient subscription failure retries on the same connection', async () => {
  const { fake, statuses } = start();
  fake.serverConnect();
  fake.ack(ORDER, { subscribed: false, channel: ORDER, error: 'Subscription temporarily unavailable' });
  fake.ack(CHAT);
  expect(statuses.at(-1)).toBe('connecting');

  await jest.advanceTimersByTimeAsync(RECOVERY_BASE_DELAY_MS);
  expect(fake.socket.timeout).toHaveBeenCalledTimes(4);
  fake.ackAll();
  expect(statuses.at(-1)).toBe('live');
  expect(fake.socket.connect).toHaveBeenCalledTimes(1);
});

test('repeated connection errors show unavailable while socket.io keeps retrying', () => {
  const { fake, statuses } = start();
  fake.connectError();
  fake.connectError();
  expect(statuses.at(-1)).toBe('connecting');
  fake.connectError();
  expect(statuses.at(-1)).toBe('unavailable');

  fake.serverConnect();
  fake.ackAll();
  expect(statuses.at(-1)).toBe('live');
});

test('resume refetches a live order, or reconnects immediately with fresh credentials', async () => {
  const { fake, options, handle } = startLive();
  handle.resume();
  expect(options.onOrderChanged).toHaveBeenCalledTimes(1);
  expect(options.onChatChanged).toHaveBeenCalledTimes(1);
  expect(fake.socket.connect).toHaveBeenCalledTimes(1);

  fake.serverDisconnect('io server disconnect');
  handle.resume();
  await jest.advanceTimersByTimeAsync(0);
  expect(options.refreshSession).toHaveBeenCalledTimes(1);
  expect(fake.socket.connect).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(fake.socket.connect).toHaveBeenCalledTimes(2);
});

test('stop removes every listener once, disconnects, and ignores late acknowledgements and events', async () => {
  const { fake, statuses, options, handle } = start();
  fake.serverConnect();
  const registered = fake.listenerCount();
  expect(registered).toBe(3 + ORDER_REFRESH_EVENTS.length + CHAT_REFRESH_EVENTS.length);
  fake.emitEvent('order.status_changed');

  handle.stop();
  handle.stop();
  expect(fake.listenerCount()).toBe(0);
  expect(fake.socket.off).toHaveBeenCalledTimes(registered);
  expect(fake.socket.disconnect).toHaveBeenCalledTimes(1);

  await jest.advanceTimersByTimeAsync(10 * 60_000);
  expect(statuses).toEqual(['connecting']);
  expect(options.onOrderChanged).not.toHaveBeenCalled();
  expect(fake.socket.connect).toHaveBeenCalledTimes(1);
});

test('a socket that cannot be created reports unavailable', () => {
  const onStatus = jest.fn();
  const handle = startOrderRealtime({
    orderId: 'order-1', createSocket: () => { throw new Error('origin missing'); }, refreshSession: jest.fn(),
    onStatus, onOrderChanged: jest.fn(), onChatChanged: jest.fn(),
  });
  expect(onStatus).toHaveBeenCalledWith('unavailable');
  expect(() => { handle.resume(); handle.stop(); }).not.toThrow();
});
