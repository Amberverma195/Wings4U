const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockDisk = new Map();
let mockSession, mockOrderId = 'order-1', mockLocation = 'order-location', mockStatus = 'PLACED';
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async key => mockDisk.get(key) ?? null),
  setItemAsync: jest.fn(async (key, value) => { mockDisk.set(key, value); }),
  deleteItemAsync: jest.fn(async key => { mockDisk.delete(key); }),
}), { virtual: true });
jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('../src/lib/env', () => ({ DEFAULT_LOCATION_ID: 'store', getApiBase: () => 'https://api.example.com' }));
jest.mock('../src/lib/api', () => ({ ...jest.requireActual('../src/lib/api'), apiFetch: jest.fn() }));
jest.mock('../src/context/session', () => ({ ...jest.requireActual('../src/context/session'), useSession: () => mockSession }));
const tokens = require('../src/lib/token-store');
const { apiFetch } = require('../src/lib/api');
const { useChat } = require('../src/hooks/use-chat');

const CHAT_PATH = '/api/v1/orders/order-1/chat';
const json = (data, status = 200, extra = {}) => ({ ok: status < 400, status, json: async () => ({ data, ...extra }) });
const chat = messages => json({ messages, conversation_id: 'conversation', is_closed: false });
let latest, renderer, postResponses, refreshResponse;
function Probe() { latest = useChat(mockOrderId, mockLocation, mockStatus); return null; }
const posts = () => apiFetch.mock.calls.filter(([path, init]) => path === CHAT_PATH && init?.method === 'POST');
const chatGets = () => apiFetch.mock.calls.filter(([path, init]) => path === CHAT_PATH && !init?.method);
const refreshes = () => apiFetch.mock.calls.filter(([path]) => path === '/api/v1/auth/refresh');

beforeEach(async () => {
  mockDisk.clear();
  await tokens.setSessionTokens('access-1', 'refresh-1');
  jest.clearAllMocks();
  mockOrderId = 'order-1'; mockLocation = 'order-location'; mockStatus = 'PLACED';
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer', role: 'CUSTOMER' }, refresh: jest.fn(async () => true), clear: jest.fn() };
  postResponses = [];
  refreshResponse = json({ refreshed: true, access_token: 'access-2', refresh_token: 'refresh-2' });
  apiFetch.mockImplementation(async (path, init) => {
    if (path === CHAT_PATH && init?.method === 'POST') return postResponses.shift() ?? json({ id: 'message' }, 201);
    if (path === CHAT_PATH) return chat([]);
    if (path === '/api/v1/auth/refresh') return refreshResponse;
    throw new Error(`Unexpected request ${path}`);
  });
  await act(async () => { renderer = create(React.createElement(Probe)); });
});
afterEach(async () => { await act(async () => renderer.unmount()); });

const send = async body => {
  let outcome;
  await act(async () => { outcome = await latest.sendMessage(body).then(() => 'sent', error => error); });
  return outcome;
};

test('a created message resolves and refetches the conversation', async () => {
  expect(await send('Where is my order?')).toBe('sent');
  expect(JSON.parse(posts()[0][1].body)).toEqual({ message_body: 'Where is my order?' });
  expect(chatGets()).toHaveLength(2);
  expect(latest.error).toBeNull();
});

test.each([
  [422, { errors: [{ code: 'VALIDATION_FAILED', message: 'Chat is closed for this order' }], meta: { request_id: 'req-9' } },
    'Chat is closed for this order'],
  [429, { errors: [{ code: 'RATE_LIMITED', message: 'Slow down' }] }, 'Slow down'],
  [500, null, 'Send failed (500)'],
])('HTTP %s is reported as a failure and never as sent', async (status, body, message) => {
  postResponses.push({ ok: false, status, json: async () => { if (!body) throw new SyntaxError('Unexpected token <'); return body; } });
  expect((await send('Hello')).message).toBe(message);
  expect(latest.error).toBe(message);
  expect(chatGets()).toHaveLength(1);
  expect(posts()).toHaveLength(1);
});

test('a network failure rejects without refetching', async () => {
  postResponses.push(Promise.reject(new TypeError('Network request failed')));
  expect((await send('Hello')).message).toBe('Network request failed');
  expect(chatGets()).toHaveLength(1);
});

test('an expired token is refreshed silently and the message is sent exactly once more', async () => {
  postResponses.push(json(null, 401));
  expect(await send('Hello')).toBe('sent');
  expect(refreshes()).toHaveLength(1);
  expect(mockSession.refresh).toHaveBeenCalledTimes(1);
  expect(posts()).toHaveLength(2);
  expect(await tokens.getAccessToken()).toBe('access-2');
  expect(chatGets()).toHaveLength(2);
});

test('a definitive refresh failure clears the session and the message is not reported as sent', async () => {
  postResponses.push(json(null, 401));
  refreshResponse = json({ refreshed: false }, 401);
  expect((await send('Hello')).message).toBe('Send failed (401)');
  expect(mockSession.clear).toHaveBeenCalledTimes(1);
  expect(posts()).toHaveLength(1);
  expect(chatGets()).toHaveLength(1);
});

const rerender = () => act(async () => renderer.update(React.createElement(Probe)));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('every GET and POST uses the order location and generation guard', async () => {
  await send('Hello');
  for (const [path, init] of apiFetch.mock.calls.filter(([path]) => path === CHAT_PATH)) {
    expect(init.locationId).toBe('order-location');
    expect(init.expectedSessionGeneration).toBe(tokens.getSessionGeneration());
  }
});

test('no chat request is made before the order location is known', async () => {
  await act(async () => renderer.unmount()); apiFetch.mockClear(); mockLocation = null;
  await act(async () => { renderer = create(React.createElement(Probe)); });
  expect(apiFetch).not.toHaveBeenCalled(); expect(latest.messages).toEqual([]);
  mockLocation = 'order-location'; await rerender(); expect(chatGets()).toHaveLength(1);
});

test('empty messages and concurrent sends never create additional POSTs', async () => {
  expect((await send('   ')).message).toBe('Enter a message.'); expect(posts()).toHaveLength(0);
  const pending = deferred(); postResponses.push(pending.promise);
  let first, second;
  await act(async () => {
    first = latest.sendMessage('Hello');
    second = latest.sendMessage('Hello').catch(error => error);
  });
  expect(posts()).toHaveLength(1); expect(latest.sending).toBe(true);
  expect((await second).message).toContain('already being sent');
  await act(async () => { pending.resolve(json({ id: 'sent' })); await first; });
  expect(latest.sending).toBe(false);
});

test('a 429 sets a cooldown and cannot be retried by repeated taps', async () => {
  postResponses.push({ ...json(null, 429, { errors: [{ message: 'Too many messages. Try again in 8s.' }] }), headers: { get: () => '8' } });
  const before = Date.now(); await send('Hello');
  expect(latest.retryAt).toBeGreaterThanOrEqual(before + 8_000);
  await send('Again'); expect(posts()).toHaveLength(1);
});

test('a rate-limit error without server timing does not invent a mobile-only cooldown', async () => {
  postResponses.push(json(null, 429, { errors: [{ message: 'Slow down' }] }));
  expect((await send('Hello')).message).toBe('Slow down'); expect(latest.retryAt).toBeNull();
});

test('rate limits come from the backend rather than a separate local message quota', async () => {
  jest.useFakeTimers();
  try {
    for (let index = 0; index < 6; index++) expect(await send('Message ' + index)).toBe('sent');
    expect(latest.retryAt).toBeNull(); expect(posts()).toHaveLength(6);
    postResponses.push({ ...json(null, 429, { errors: [{ message: 'Too many messages' }] }), headers: { get: () => '2' } });
    await send('Limited'); expect(latest.retryAt).not.toBeNull();
    await send('Do not retry yet'); expect(posts()).toHaveLength(7);
    await act(async () => jest.advanceTimersByTimeAsync(2_001));
    expect(latest.retryAt).toBeNull(); expect(await send('Now allowed')).toBe('sent');
  } finally { jest.useRealTimers(); }
});

test.each(['PICKED_UP', 'DELIVERED', 'CANCELLED', 'NO_SHOW_PICKUP', 'NO_SHOW_DELIVERY', 'NO_PIN_DELIVERY'])(
  'terminal %s blocks sending even through a previously captured callback', async status => {
    const oldSend = latest.sendMessage; mockStatus = status; await rerender();
    await expect(oldSend('Hello')).rejects.toThrow('Chat is closed'); expect(posts()).toHaveLength(0);
  });

test('the server closed flag blocks sending for an otherwise active order', async () => {
  apiFetch.mockResolvedValue(json({ messages: [], conversation_id: 'chat', is_closed: true }));
  await act(async () => latest.refetch()); expect(latest.isClosed).toBe(true);
  expect((await send('Hello')).message).toContain('Chat is closed'); expect(posts()).toHaveLength(0);
});

test.each(['account', 'order', 'location', 'logout'])('%s switch clears messages and ignores a late old conversation response', async change => {
  apiFetch.mockResolvedValue(chat([{ id: 'private', message_body: 'Private message', created_at: '2026-10-20T15:00:00Z' }]));
  await act(async () => latest.refetch()); expect(latest.messages).toHaveLength(1);
  const pending = deferred(); apiFetch.mockReturnValueOnce(pending.promise);
  await act(async () => latest.refetch());
  const oldSend = latest.sendMessage;
  if (change === 'account') { await tokens.setSessionTokens('other-access', 'other-refresh'); mockSession = { ...mockSession, user: { id: 'other' } }; }
  if (change === 'order') mockOrderId = 'order-2';
  if (change === 'location') mockLocation = 'other-location';
  if (change === 'logout') mockSession = { ...mockSession, authenticated: false, user: null };
  apiFetch.mockResolvedValue(chat([])); await rerender();
  await act(async () => pending.resolve(chat([{ id: 'stale', message_body: 'Stale', created_at: '2026-10-20T15:00:00Z' }])));
  expect(latest.messages).toEqual([]); expect(latest.error).toBeNull();
  await expect(oldSend('Old callback')).rejects.toThrow(); expect(posts()).toHaveLength(0);
});

test('a late send failure after switching accounts never contaminates the new chat error state', async () => {
  const pending = deferred(); postResponses.push(pending.promise); let sent;
  await act(async () => { sent = latest.sendMessage('Hello').catch(error => error); });
  await tokens.setSessionTokens('other-access', 'other-refresh'); mockSession = { ...mockSession, user: { id: 'other' } };
  await rerender();
  await act(async () => { pending.resolve(json(null, 500)); await sent; });
  expect(latest.messages).toEqual([]); expect(latest.error).toBeNull(); expect(latest.sending).toBe(false);
});
