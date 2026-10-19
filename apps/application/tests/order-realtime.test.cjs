const { createFakeSocket } = require('./fake-socket.cjs');
const {
  startOrderRealtime, ORDER_REFRESH_EVENTS, CHAT_REFRESH_EVENTS, SUBSCRIBE_ACK_TIMEOUT_MS,
  MAX_RECOVERY_ATTEMPTS, MAX_CONNECTS_WITHOUT_LIVE, RECOVERY_BASE_DELAY_MS, REFRESH_COALESCE_MS,
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

test('resume refetches a live order without reconnecting', () => {
  const { fake, options, handle } = startLive();
  handle.resume();
  expect(options.onOrderChanged).toHaveBeenCalledTimes(1);
  expect(options.onChatChanged).toHaveBeenCalledTimes(1);
  expect(fake.socket.connect).toHaveBeenCalledTimes(1);
});

test('repeated foreground events cannot shortcut an in-progress authentication backoff', async () => {
  const { fake, options, handle } = start();
  fake.serverConnect();
  fake.serverDisconnect('io server disconnect');
  for (let i = 0; i < 20; i += 1) handle.resume();
  await jest.advanceTimersByTimeAsync(RECOVERY_BASE_DELAY_MS - 1);
  expect(options.refreshSession).not.toHaveBeenCalled();
  expect(fake.socket.connect).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(options.refreshSession).toHaveBeenCalledTimes(1);
  expect(fake.socket.connect).toHaveBeenCalledTimes(2);
});

test('after recovery is exhausted, resume restarts it once with fresh credentials', async () => {
  const { fake, statuses, options, handle } = start();
  fake.serverConnect();
  for (let attempt = 0; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
    fake.serverDisconnect('io server disconnect');
    await jest.advanceTimersByTimeAsync(60_000);
    fake.serverConnect();
  }
  fake.serverDisconnect('io server disconnect');
  expect(statuses.at(-1)).toBe('unavailable');
  const refreshes = options.refreshSession.mock.calls.length;
  const connects = fake.socket.connect.mock.calls.length;

  handle.resume();
  await jest.advanceTimersByTimeAsync(0);
  expect(statuses.at(-1)).toBe('connecting');
  expect(options.refreshSession).toHaveBeenCalledTimes(refreshes + 1);
  expect(fake.socket.connect).toHaveBeenCalledTimes(connects + 1);
  fake.serverConnect();
  fake.ackAll();
  expect(statuses.at(-1)).toBe('live');
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

test('a socket that could not be created is created again by resume and can go live', () => {
  const fake = createFakeSocket();
  const createSocket = jest.fn()
    .mockImplementationOnce(() => { throw new Error('origin missing'); })
    .mockImplementationOnce(() => { throw new Error('still missing'); })
    .mockImplementation(() => fake.socket);
  const statuses = [];
  const onOrderChanged = jest.fn();
  const handle = startOrderRealtime({
    orderId: 'order-1', createSocket, refreshSession: jest.fn(),
    onStatus: status => statuses.push(status), onOrderChanged, onChatChanged: jest.fn(),
  });
  expect(statuses).toEqual(['unavailable']);

  handle.resume();
  expect(createSocket).toHaveBeenCalledTimes(2);
  expect(statuses).toEqual(['unavailable']);

  handle.resume();
  expect(createSocket).toHaveBeenCalledTimes(3);
  expect(fake.socket.connect).toHaveBeenCalledTimes(1);
  fake.serverConnect();
  fake.ackAll();
  expect(statuses).toEqual(['unavailable', 'connecting', 'live']);
  expect(onOrderChanged).toHaveBeenCalledTimes(1);

  handle.stop();
  expect(fake.listenerCount()).toBe(0);
});

test('stop before any socket exists is safe', () => {
  const handle = startOrderRealtime({
    orderId: 'order-1', createSocket: () => { throw new Error('origin missing'); }, refreshSession: jest.fn(),
    onStatus: jest.fn(), onOrderChanged: jest.fn(), onChatChanged: jest.fn(),
  });
  handle.stop();
  expect(() => handle.resume()).not.toThrow();
});

describe('transport reconnection versus bounded recovery', () => {
  test('a long network outage never stops socket.io reconnection and recovers when the network returns', async () => {
    const { fake, statuses, options } = start();
    for (let i = 0; i < 200; i += 1) {
      fake.connectError();
      await jest.advanceTimersByTimeAsync(5_000);
    }
    expect(statuses.at(-1)).toBe('unavailable');
    expect(fake.socket.disconnect).not.toHaveBeenCalled();
    expect(options.refreshSession).not.toHaveBeenCalled();

    fake.serverConnect();
    fake.ackAll();
    expect(statuses.at(-1)).toBe('live');
  });

  test('intermittent drops after going live keep recovering indefinitely', () => {
    const { fake, statuses } = start();
    for (let i = 0; i < 3 * MAX_CONNECTS_WITHOUT_LIVE; i += 1) {
      fake.serverConnect();
      fake.ackAll();
      expect(statuses.at(-1)).toBe('live');
      fake.serverDisconnect('transport close');
    }
    expect(fake.socket.disconnect).not.toHaveBeenCalled();
  });

  test('connections that open but never go live stop socket.io reconnection after a bounded number', async () => {
    const { fake, statuses, options, handle } = start();
    for (let i = 1; i < MAX_CONNECTS_WITHOUT_LIVE; i += 1) {
      fake.serverConnect();
      fake.serverDisconnect('transport close');
      expect(fake.socket.disconnect).not.toHaveBeenCalled();
    }
    fake.serverConnect();
    fake.serverDisconnect('transport close');
    expect(fake.socket.disconnect).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('unavailable');

    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(fake.socket.connect).toHaveBeenCalledTimes(1);
    expect(options.refreshSession).not.toHaveBeenCalled();

    handle.resume();
    await jest.advanceTimersByTimeAsync(0);
    expect(fake.socket.connect).toHaveBeenCalledTimes(2);
    fake.serverConnect();
    fake.ackAll();
    expect(statuses.at(-1)).toBe('live');
  });
});
