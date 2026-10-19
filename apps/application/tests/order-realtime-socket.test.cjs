/**
 * Drives the order realtime controller with the real socket.io client against
 * a real in-process socket.io server on loopback, to pin down the transport
 * semantics the controller relies on (fake sockets cannot prove those).
 */
const http = require('node:http');
const { Server } = require('socket.io');
const { io } = require('socket.io-client');
const { startOrderRealtime, MAX_CONNECTS_WITHOUT_LIVE } = require('../src/lib/order-realtime');

jest.setTimeout(20_000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(10);
  }
}

let servers, handles;
async function startServer(port = 0, onConnection) {
  const httpServer = http.createServer();
  const server = new Server(httpServer, { path: '/ws' });
  const state = { server, connections: 0, tokens: [] };
  server.on('connection', socket => {
    state.connections += 1;
    state.tokens.push(socket.handshake.auth.token);
    onConnection(socket);
  });
  await new Promise(resolve => httpServer.listen(port, '127.0.0.1', resolve));
  state.port = httpServer.address().port;
  servers.push(state);
  return state;
}
const stopServer = state => new Promise(resolve => state.server.close(() => resolve()));
const acceptSubscriptions = socket => socket.on('subscribe', ({ channel }, ack) => ack({ subscribed: true, channel }));

// Same transport and auth options as createOrdersSocket, with short delays to keep the test fast.
const clientFor = port => () => io(`http://127.0.0.1:${port}`, {
  path: '/ws', transports: ['websocket'], autoConnect: false, forceNew: true,
  auth: callback => callback({ token: 'native-token' }),
  reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 20, reconnectionDelayMax: 60,
});

function startController(port) {
  const statuses = [];
  const options = {
    orderId: 'order-1', createSocket: clientFor(port), refreshSession: jest.fn(async () => true),
    onStatus: status => statuses.push(status), onOrderChanged: jest.fn(), onChatChanged: jest.fn(),
  };
  const handle = startOrderRealtime(options);
  handles.push(handle);
  return { statuses, options, handle, status: () => statuses.at(-1) };
}

beforeEach(() => { servers = []; handles = []; });
afterEach(async () => {
  for (const handle of handles) handle.stop();
  for (const state of servers) await stopServer(state);
});

test('an outage with the API unreachable keeps reconnecting until the server is back, then goes live', async () => {
  const probe = await startServer(0, () => undefined);
  const { port } = probe;
  await stopServer(probe);
  servers = [];

  const controller = startController(port);
  await waitFor(() => controller.status() === 'unavailable', 'connection errors');
  await sleep(300);
  expect(controller.options.refreshSession).not.toHaveBeenCalled();

  const restored = await startServer(port, acceptSubscriptions);
  await waitFor(() => controller.status() === 'live', 'recovery after outage');
  expect(restored.tokens).toEqual(['native-token']);
  expect(controller.options.onOrderChanged).toHaveBeenCalledTimes(1);
});

test('a server that keeps dropping connections before they go live is retried a bounded number of times', async () => {
  let refuse = true;
  const server = await startServer(0, socket => {
    if (refuse) socket.conn.close();
    else acceptSubscriptions(socket);
  });
  const controller = startController(server.port);

  await waitFor(() => controller.status() === 'unavailable', 'bounded recovery');
  expect(server.connections).toBe(MAX_CONNECTS_WITHOUT_LIVE);
  await sleep(500);
  expect(server.connections).toBe(MAX_CONNECTS_WITHOUT_LIVE);

  refuse = false;
  controller.handle.resume();
  await waitFor(() => controller.status() === 'live', 'resume');
  expect(server.connections).toBe(MAX_CONNECTS_WITHOUT_LIVE + 1);
  expect(controller.options.refreshSession).toHaveBeenCalledTimes(1);
});

describe('WebSocket-only transport decision', () => {
  // A server limited to long-polling stands in for a network that blocks WebSocket upgrades.
  async function pollingOnlyServer() {
    const httpServer = http.createServer();
    const server = new Server(httpServer, { path: '/ws', transports: ['polling'] });
    server.on('connection', acceptSubscriptions);
    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const state = { server, port: httpServer.address().port };
    servers.push(state);
    return state;
  }
  const outcome = (port, options) => new Promise(resolve => {
    const client = io(`http://127.0.0.1:${port}`, { path: '/ws', forceNew: true, reconnection: false, ...options });
    client.once('connect', () => { resolve(client.io.engine.transport.name); client.disconnect(); });
    client.once('connect_error', () => { resolve('connect_error'); client.disconnect(); });
  });

  test('the mobile client cannot connect when WebSockets are blocked and reports live updates unavailable', async () => {
    const { port } = await pollingOnlyServer();
    expect(await outcome(port, { transports: ['websocket'] })).toBe('connect_error');
    const controller = startController(port);
    await waitFor(() => controller.status() === 'unavailable', 'unavailable on blocked WebSockets');
  });

  test('listing polling as a second transport does not fall back without tryAllTransports', async () => {
    const { port } = await pollingOnlyServer();
    expect(await outcome(port, { transports: ['websocket', 'polling'] })).toBe('connect_error');
    expect(await outcome(port, { transports: ['websocket', 'polling'], tryAllTransports: true })).toBe('polling');
  });
});

test('a live connection dropped by the transport reconnects by itself and resubscribes', async () => {
  const server = await startServer(0, acceptSubscriptions);
  const controller = startController(server.port);
  await waitFor(() => controller.status() === 'live', 'initial subscription');

  for (const socket of server.server.sockets.sockets.values()) socket.conn.close();
  await waitFor(() => server.connections === 2 && controller.status() === 'live', 'transport reconnect');
  expect(controller.options.refreshSession).not.toHaveBeenCalled();
  expect(controller.options.onOrderChanged).toHaveBeenCalledTimes(2);
});
