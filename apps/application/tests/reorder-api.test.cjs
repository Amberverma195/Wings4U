jest.mock('../src/lib/env', () => ({ getApiBase: () => 'https://offline.invalid' }));
jest.mock('../src/lib/token-store', () => ({ getAccessToken: jest.fn(async () => 'secure-token') }));
const { apiFetch } = require('../src/lib/api');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
test('native reorder transport sends the original order location header with authenticated preview POST', async () => {
  global.fetch = jest.fn(async () => ({ ok: true }));
  await apiFetch('/api/v1/orders/past/reorder', { method: 'POST', locationId: 'original-store' });
  const [url, request] = global.fetch.mock.calls[0];
  expect(url).toBe('https://offline.invalid/api/v1/orders/past/reorder');
  expect(request.method).toBe('POST');
  expect(request.headers.get('X-Location-Id')).toBe('original-store');
  expect(request.headers.get('Authorization')).toBe('Bearer secure-token');
  expect(request.credentials).toBe('omit');
});
