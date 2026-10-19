jest.mock('../src/lib/env', () => ({ getRealtimeOrigin: jest.fn(() => 'https://api.example.com') }));
jest.mock('../src/lib/token-store', () => ({ getAccessToken: jest.fn() }));
jest.mock('socket.io-client', () => ({ io: jest.fn(() => ({})) }));
const { io } = require('socket.io-client');
const { getAccessToken } = require('../src/lib/token-store');
const { createOrdersSocket } = require('../src/lib/realtime');

const handshake = auth => new Promise(resolve => auth(resolve));

beforeEach(() => jest.clearAllMocks());

test('connects to the /ws gateway over websocket with the token only in the handshake auth payload', () => {
  createOrdersSocket();
  const [origin, options] = io.mock.calls[0];
  expect(origin).toBe('https://api.example.com');
  expect(options).toMatchObject({
    path: '/ws', transports: ['websocket'], autoConnect: false, forceNew: true,
    reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 500, reconnectionDelayMax: 5000,
  });
  expect(options.tryAllTransports).toBeUndefined();
  expect(options.extraHeaders).toBeUndefined();
  expect(options.query).toBeUndefined();
  expect(options.withCredentials).toBeUndefined();
  expect(typeof options.auth).toBe('function');
});

test('every connect and reconnect reads the current token, so a refreshed token replaces an expired one', async () => {
  createOrdersSocket();
  const { auth } = io.mock.calls[0][1];
  getAccessToken.mockResolvedValueOnce('expired-token').mockResolvedValueOnce('refreshed-token');
  await expect(handshake(auth)).resolves.toEqual({ token: 'expired-token' });
  await expect(handshake(auth)).resolves.toEqual({ token: 'refreshed-token' });
});

test.each([
  ['signed out', () => getAccessToken.mockResolvedValueOnce(null)],
  ['session changed during lookup', () => getAccessToken.mockRejectedValueOnce(new Error('Your session changed.'))],
])('%s sends no credentials', async (_label, arrange) => {
  createOrdersSocket();
  arrange();
  await expect(handshake(io.mock.calls[0][1].auth)).resolves.toEqual({});
});
