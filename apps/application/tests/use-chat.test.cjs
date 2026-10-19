const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockDisk = new Map();
let mockSession;
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
function Probe() { latest = useChat('order-1'); return null; }
const posts = () => apiFetch.mock.calls.filter(([path, init]) => path === CHAT_PATH && init?.method === 'POST');
const chatGets = () => apiFetch.mock.calls.filter(([path, init]) => path === CHAT_PATH && !init?.method);
const refreshes = () => apiFetch.mock.calls.filter(([path]) => path === '/api/v1/auth/refresh');

beforeEach(async () => {
  mockDisk.clear();
  await tokens.setSessionTokens('access-1', 'refresh-1');
  jest.clearAllMocks();
  mockSession = { refresh: jest.fn(async () => true), clear: jest.fn() };
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
    'Chat is closed for this order (HTTP 422 · VALIDATION_FAILED · ref req-9)'],
  [429, { errors: [{ code: 'RATE_LIMITED', message: 'Slow down' }] }, 'Slow down (HTTP 429 · RATE_LIMITED)'],
  [500, null, 'Message was not sent. (HTTP 500)'],
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
  expect((await send('Hello')).message).toContain('HTTP 401');
  expect(mockSession.clear).toHaveBeenCalledTimes(1);
  expect(posts()).toHaveLength(1);
  expect(chatGets()).toHaveLength(1);
});
