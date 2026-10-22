jest.mock('server-only', () => ({}), { virtual: true });
const { createHmac } = require('crypto');
const { buildSignedClientIpHeaders } = require('../src/lib/server-station-gate-headers');
const { validCatalogQuery, normalizeCatalogScheduledFor } = require('../src/lib/catalog/catalog-route-params');
const { GET: proxy } = require('../src/app/api/v1/[...path]/route');
const { GET: menu } = require('../src/app/api/catalog/menu/route');
const { GET: flavours } = require('../src/app/api/catalog/wing-flavours/route');
const { CatalogRateLimitError } = require('../src/lib/catalog/server-catalog');
const realFetch = global.fetch;
const previous = { VERCEL: process.env.VERCEL, JWT_SECRET: process.env.JWT_SECRET, API_PROXY_TARGET: process.env.API_PROXY_TARGET };
beforeEach(() => { process.env.VERCEL = '1'; process.env.JWT_SECRET = 'proxy-test-secret'; process.env.API_PROXY_TARGET = 'https://api.example.test'; global.fetch = jest.fn(); });
afterEach(() => { global.fetch = realFetch; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
test('only signs validated Vercel ingress IPs, with no arbitrary-header fallback', () => {
  const headers = new Headers({ 'x-vercel-forwarded-for': '2001:db8::1', 'x-forwarded-for': '1.2.3.4', 'x-w4u-client-ip': '5.6.7.8' });
  expect(buildSignedClientIpHeaders(headers)).toEqual({ 'x-w4u-client-ip': '2001:db8::1', 'x-w4u-client-ip-signature': createHmac('sha256', 'proxy-test-secret').update('2001:db8::1').digest('hex') });
  expect(buildSignedClientIpHeaders(new Headers({ 'x-real-ip': '1.2.3.4' }))).toEqual({});
  delete process.env.VERCEL; expect(buildSignedClientIpHeaders(headers)).toEqual({});
});
test('proxy overwrites spoofed signatures and preserves auth, idempotency, cookies and Retry-After', async () => {
  const headers = new Headers({ 'retry-after': '30', 'content-type': 'application/json' });
  headers.getSetCookie = () => ['refresh_token=rotated; HttpOnly; Secure'];
  global.fetch.mockResolvedValue({ status: 429, headers, body: null });
  const result = await proxy(new Request('https://web.example.test/api/v1/auth/refresh', { method: 'POST', headers: {
    'x-vercel-forwarded-for': '198.51.100.1', 'x-w4u-client-ip': 'attacker', 'x-w4u-client-ip-signature': 'fake', 'x-w4u-catalog-server': 'fake',
    'idempotency-key': 'checkout-key', cookie: 'refresh_token=old', 'x-csrf-token': 'csrf', 'content-type': 'application/json' }, body: '{}' }));
  const sent = global.fetch.mock.calls[0][1].headers;
  expect(sent.get('x-w4u-client-ip')).toBe('198.51.100.1'); expect(sent.get('x-w4u-catalog-server')).toBeNull();
  expect(sent.get('idempotency-key')).toBe('checkout-key'); expect(sent.get('cookie')).toBe('refresh_token=old');
  expect(result.status).toBe(429); expect(result.headers.get('retry-after')).toBe('30');
  expect(result.headers.get('set-cookie')).toContain('HttpOnly');
});
test('rejects duplicate and unknown catalog params and malformed dates before upstream requests', async () => {
  expect(validCatalogQuery(new URLSearchParams('location_id=a&location_id=b'), ['location_id'])).toBe(false);
  expect(normalizeCatalogScheduledFor('2026')).toEqual({ ok: false });
  for (const query of ['location_id=../bad&fulfillment_type=PICKUP', 'location_id=LON01&fulfillment_type=PICKUP&junk=1', 'location_id=LON01&location_id=LON02&fulfillment_type=PICKUP']) {
    expect((await menu(new Request('https://web.test/api/catalog/menu?' + query))).status).toBe(400);
  }
  expect(global.fetch).not.toHaveBeenCalled();
});
test('normal catalog fetches preserve server signatures and canonical minute keys, and upstream 429 stays 429', async () => {
  global.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { categories: [] } }), { status: 200 }));
  const result = await menu(new Request('https://web.test/api/catalog/menu?location_id=LON01&fulfillment_type=PICKUP'));
  expect(result.status).toBe(200);
  expect(global.fetch.mock.calls[0][1]).toMatchObject({ cache: 'force-cache', headers: { 'x-w4u-catalog-server': expect.any(String) }, next: { revalidate: 30 } });
  global.fetch.mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '45' } }));
  for (const call of [menu, flavours]) {
    const limited = await call(new Request('https://web.test/api/catalog/menu?location_id=LON01' + (call === menu ? '&fulfillment_type=PICKUP' : '')));
    expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('45');
  }
});
