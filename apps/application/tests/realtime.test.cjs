jest.mock('../src/lib/env', () => ({ getRealtimeOrigin: jest.fn(() => 'https://api.example.com/api') }));
jest.mock('../src/lib/token-store', () => ({ getAccessToken: jest.fn(async () => 'native-token') }));
jest.mock('socket.io-client', () => ({ io: jest.fn() }));
const { EventEmitter } = require('node:events');
const { io } = require('socket.io-client');
const { getAccessToken } = require('../src/lib/token-store');
const { createOrdersSocket, subscribeToChannels } = require('../src/lib/realtime');

beforeEach(() => jest.clearAllMocks());

test('connects to the gateway origin over websocket with native handshake and Bearer credentials', async () => {
  const socket = {};
  io.mockReturnValue(socket);
  expect(await createOrdersSocket()).toBe(socket);
  expect(io).toHaveBeenCalledWith('https://api.example.com', expect.objectContaining({
    path: '/ws', transports: ['websocket'], autoConnect: false,
    auth: { token: 'native-token' }, extraHeaders: { Authorization: 'Bearer native-token' },
  }));
});

test('does not send an empty Bearer header when signed out', async () => {
  getAccessToken.mockResolvedValueOnce(null);
  await createOrdersSocket();
  expect(io.mock.calls[0][1].auth).toBeUndefined();
  expect(io.mock.calls[0][1].extraHeaders).toBeUndefined();
});

test('resubscribes to order and chat after reconnect and removes subscriptions on cleanup', () => {
  const socket = new EventEmitter();
  socket.connected = false;
  const channels = ['order:123', 'chat:123'];
  const subscribe = jest.fn(({ channel }, ack) => ack({ subscribed: true, channel }));
  const unsubscribe = jest.fn();
  socket.on('subscribe', subscribe);
  socket.on('unsubscribe', unsubscribe);
  const onSubscribed = jest.fn();
  const cleanup = subscribeToChannels(socket, channels, { onSubscribed });
  expect(subscribe).not.toHaveBeenCalled();
  socket.emit('connect');
  socket.emit('connect');
  expect(subscribe.mock.calls.map(([data]) => data.channel)).toEqual([...channels, ...channels]);
  expect(onSubscribed).toHaveBeenCalledTimes(4);
  cleanup();
  socket.emit('connect');
  expect(subscribe).toHaveBeenCalledTimes(4);
  expect(unsubscribe.mock.calls.map(([data]) => data.channel)).toEqual(channels);
  expect(socket.listenerCount('connect_error')).toBe(0);
});
