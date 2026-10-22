const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { createHmac } = require('node:crypto');
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const root = path.resolve(__dirname, '../../..');
const web = path.join(root, 'apps/web');
const TEST_SECRET = 'isolated-next-routing-secret';
const IP = '198.51.100.25';
const signature = createHmac('sha256', TEST_SECRET).update(IP).digest('hex');

async function startNext(target, original = false, production = false) {
  // Keep fixture and dependencies on the same Windows drive (Next's dev entry paths are relative).
  const fixtureRoot = path.dirname(root);
  const dir = fs.mkdtempSync(path.join(fixtureRoot, '.w4u-proxy-routing-'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  const cleanup = () => {
    if (path.dirname(path.resolve(dir)) !== fixtureRoot || !path.basename(dir).startsWith('.w4u-proxy-routing-')) throw new Error('Unexpected fixture cleanup target');
    if (!fs.lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()) throw new Error('Expected a test junction');
    fs.unlinkSync(path.join(dir, 'node_modules'));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  const copy = relative => { const dest = path.join(dir, relative); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(web, relative), dest); };
  for (const file of [
    'src/app/api/v1/auth/refresh/restore/route.ts', 'src/lib/types.ts',
    'src/app/api/v1/[...path]/route.ts', 'src/lib/api-proxy-body.ts', 'src/lib/server-station-gate-headers.ts',
    'src/lib/server-station-login-proxy.ts', 'src/lib/env.ts',
    'src/app/api/station/proxy/route.ts', 'src/app/api/station/kds-login/route.ts', 'src/app/api/station/pos-login/route.ts',
    'src/app/api/catalog/menu/route.ts', 'src/app/api/catalog/wing-flavours/route.ts',
    'src/lib/catalog/server-catalog.ts', 'src/lib/catalog/catalog-route-params.ts', 'src/lib/catalog/cache-tags.ts',
  ]) copy(file);
  fs.writeFileSync(path.join(dir, 'next.config.ts'), original
    ? fs.readFileSync(path.join(__dirname, 'fixtures/next.config.reviewed.ts'))
    : fs.readFileSync(path.join(web, 'next.config.ts')));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'isolated-routing-test', private: true }));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'], '@wings4u/contracts': [path.join(root, 'packages/contracts/src')] }, jsx: 'preserve' } }));
  fs.writeFileSync(path.join(dir, 'src/app/layout.tsx'), 'export default function Layout({children}: {children: React.ReactNode}) {return <html><body>{children}</body></html>}');
  fs.mkdirSync(path.join(dir, 'public/uploads/menu'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'public/uploads/menu/existing.png'), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(dir, 'src/app/page.tsx'), 'export default function Page() {return <p>Isolated routing fixture</p>}');
  const childEnv = {
    ...process.env, NODE_ENV: production ? 'production' : 'development', VERCEL: '1', NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/forbidden', DIRECT_URL: 'postgresql://test:test@127.0.0.1:1/forbidden', REDIS_URL: '',
    API_PROXY_TARGET: target, INTERNAL_API_URL: target, JWT_SECRET: TEST_SECRET,
  };
  if (production) {
    try { execFileSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build', dir], { cwd: dir, env: childEnv, stdio: 'pipe', timeout: 120000 }); }
    catch (error) { cleanup(); throw error; }
  }
  const child = fork(path.join(__dirname, 'next-proxy-server.cjs'), [dir, production ? 'production' : 'development'], { cwd: dir, silent: true, env: childEnv });
  let log = ''; const record = data => { log = (log + data.toString()).slice(-6000); };
  child.stdout.on('data', record); child.stderr.on('data', record);
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Next startup timed out: ' + log)), 60000);
    child.once('message', message => { clearTimeout(timeout); message.error ? reject(new Error(message.error + log)) : resolve(message); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Next startup exited ' + code + ': ' + log)); });
  }).catch(error => { child.kill(); throw error; });
  return { base: 'http://127.0.0.1:' + ready.port, log: () => log, stop: async () => {
    const exited = once(child, 'exit'); child.send('stop');
    const timeout = setTimeout(() => child.kill(), 10000);
    await exited; clearTimeout(timeout);
    // Remove only the test-created junction first, never traverse the shared node_modules target.
    cleanup();
  } };
}

test('installed Next routing, signed REST forwarding, uploads and dedicated station routes', { timeout: 240000 }, async t => {
  const records = [];
  const module = await Test.createTestingModule({}).compile();
  const nest = module.createNestApplication();
  nest.use(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const row = { path: req.url, method: req.method, headers: req.headers, bytes };
      records.push(row);
      if (req.url.includes('/admin/menu/') && req.method === 'POST' && req.headers.authorization !== 'Bearer test-admin') return res.status(401).json({ errors: [{ message: 'Unauthorized' }] });
      if (req.url.includes('limited')) { res.setHeader('Retry-After', '37'); return res.status(429).json({ errors: [{ code: 'RATE_LIMITED' }] }); }
      if (req.url.includes('redirect')) { res.setHeader('Location', '/account/support'); return res.status(307).end(); }
      if (req.url.includes('/auth/login') || req.url.includes('/auth/refresh')) {
        res.setHeader('Set-Cookie', ['access_token=test-access; Path=/; HttpOnly; Secure; SameSite=None', 'refresh_token=test-refresh; Path=/api/v1/auth/refresh; HttpOnly; Secure; SameSite=None', 'csrf_token=test-csrf; Path=/; Secure; SameSite=None']);
      }
      if (req.url.startsWith('/api/v1/menu')) return res.json({ data: { categories: [], items: [] } });
      if (req.url.includes('/image') || req.url.includes('/builder-image')) return res.status(201).json({ data: { image_url: '/uploads/menu/existing.png', received_bytes: bytes.length } });
      res.status(201).json({ data: { method: req.method, path: req.url, received_bytes: bytes.length } });
    } catch { if (!res.headersSent) res.status(400).end(); }
  });
  await nest.listen(0, '127.0.0.1');
  const target = await nest.getUrl();
  let server;
  const send = async (pathname, options = {}) => { const res = await fetch(server.base + pathname, { ...options, redirect: 'manual', headers: {
    'x-vercel-forwarded-for': IP, 'x-forwarded-for': '192.0.2.99', 'x-w4u-client-ip': '192.0.2.123', 'x-w4u-client-ip-signature': 'forged', 'x-w4u-catalog-server': 'forged', ...options.headers,
  } }); if (res.status === 500) throw new Error('Next handler failed: ' + server.log()); return res; };
  try {
    server = await startNext(target, true);
    await t.test('reviewed config bypasses the dynamic signing handler for login and cart', async () => {
      for (const pathname of ['/api/v1/auth/login', '/api/v1/cart/quote']) {
        const res = await send(pathname, { method: 'POST', body: '{}' }); assert.equal(res.status, 201);
        const row = records.at(-1); assert.equal(row.path, pathname); assert.equal(row.headers['x-w4u-client-ip-signature'], 'forged');
      }
    });
    await server.stop(); server = null; server = await startNext(target);
    await t.test('login, signup, reset and silent refresh use the signing handler with first-party cookies', async () => {
      for (const pathname of ['/api/v1/auth/login', '/api/v1/auth/signup', '/api/v1/auth/password-reset/request', '/api/v1/auth/password-reset/confirm', '/api/v1/auth/refresh']) {
        const body = JSON.stringify({ purpose: 'routing-test' });
        const res = await send(pathname, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'refresh_token=test-old', 'x-csrf-token': 'test-csrf', 'x-w4u-signup-device': 'test-device' }, body });
        assert.equal(res.status, 201);
        const row = records.at(-1); assert.equal(row.headers['x-w4u-client-ip'], IP); assert.equal(row.headers['x-w4u-client-ip-signature'], signature);
        assert.equal(row.headers['x-w4u-catalog-server'], undefined); assert.equal(row.headers['x-forwarded-for'], undefined);
        assert.equal(row.headers.cookie, 'refresh_token=test-old'); assert.equal(row.headers['x-csrf-token'], 'test-csrf');
        assert.equal(row.headers['x-w4u-signup-device'], 'test-device'); assert.equal(row.bytes.toString(), body);
        if (pathname.endsWith('/login') || pathname.endsWith('/refresh')) {
          const cookies = res.headers.getSetCookie(); assert.equal(cookies.length, 3);
          assert(cookies.some(value => value.includes('refresh_token=test-refresh; Path=/api/v1/auth/refresh; HttpOnly; Secure; SameSite=None')));
        }
      }
    });
    await t.test('cart, saved-cart and checkout preserve methods, query, body and application headers', async () => {
      for (const [pathname, method] of [['/api/v1/cart/quote?test=one&test=two', 'POST'], ['/api/v1/cart/me', 'PUT'], ['/api/v1/checkout', 'POST']]) {
        const body = JSON.stringify({ items: [{ menu_item_id: 'test-item', quantity: 2 }] });
        const res = await send(pathname, { method, body, headers: { 'content-type': 'application/json', cookie: 'w4u_guest_cart=test-guest; access_token=test-access', 'x-location-id': 'test-location', authorization: 'Bearer test-customer', 'idempotency-key': 'test-checkout' } });
        assert.equal(res.status, 201); const row = records.at(-1);
        assert.equal(row.path, pathname); assert.equal(row.method, method); assert.equal(row.bytes.toString(), body);
        assert.equal(row.headers['x-location-id'], 'test-location'); assert.equal(row.headers['idempotency-key'], 'test-checkout');
        assert.equal(row.headers.authorization, 'Bearer test-customer'); assert(row.headers.cookie.includes('w4u_guest_cart=test-guest'));
        assert.equal(row.headers['x-w4u-client-ip-signature'], signature);
      }
      const limited = await send('/api/v1/limited'); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '37');
      const redirect = await send('/api/v1/redirect'); assert.equal(redirect.status, 307); assert.equal(redirect.headers.get('location'), '/account/support');
    });
    await t.test('dedicated KDS/POS and own catalog routes are not rewritten into the REST catch-all', async () => {
      for (const surface of ['kds', 'pos']) {
        const res = await send('/api/station/' + surface + '-login', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'x-location-id': 'test-location' } });
        assert.equal(res.status, 201); assert.equal(records.at(-1).path, '/api/v1/' + surface + '/auth/login');
        assert.equal(records.at(-1).headers['x-w4u-client-ip-signature'], signature);
      }
      const res = await send('/api/station/proxy?path=' + encodeURIComponent('/api/v1/kds/orders?status=OPEN'));
      assert.equal(res.status, 201); assert.equal(records.at(-1).path, '/api/v1/kds/orders?status=OPEN');
      const existingImage = await send('/uploads/menu/existing.png');
      assert.equal(existingImage.status, 200); assert.deepEqual(Buffer.from(await existingImage.arrayBuffer()), Buffer.from([137, 80, 78, 71]));
      const restored = await send('/api/v1/auth/refresh/restore?returnTo=/admin/menu', { headers: { cookie: 'refresh_token=test-old; csrf_token=test-csrf' } });
      assert.equal(restored.status, 303); assert.equal(new URL(restored.headers.get('location')).pathname, '/admin/menu');
      assert.equal(restored.headers.getSetCookie().length, 3); assert.equal(records.at(-1).path, '/api/v1/auth/refresh');
      const catalog = await send('/api/catalog/menu?location_id=LON01&fulfillment_type=PICKUP'); assert.equal(catalog.status, 200);
      assert(records.at(-1).path.startsWith('/api/v1/menu?')); assert.notEqual(records.at(-1).headers['x-w4u-catalog-server'], 'forged');
    });
    await t.test('small/boundary multipart bodies stream, oversize is 413, and admin auth headers survive', async () => {
      for (const endpoint of ['items/test-item/image', 'categories/test-category/builder-image']) {
        const form = new FormData(); form.append('image', new Blob([Buffer.alloc(1024)], { type: 'image/png' }), 'test.png');
        const res = await send('/api/v1/admin/menu/' + endpoint, { method: 'POST', body: form, headers: { authorization: 'Bearer test-admin', 'x-location-id': 'test-location', 'x-csrf-token': 'test-csrf' } });
        assert.equal(res.status, 201); const row = records.at(-1); assert(row.headers['content-type'].startsWith('multipart/form-data; boundary='));
        assert(row.bytes.includes(Buffer.from('filename="test.png"'))); assert.equal(row.headers['x-w4u-client-ip-signature'], signature);
      }
      const boundary = new FormData(); boundary.append('image', new Blob([Buffer.alloc(4 * 1024 * 1024)], { type: 'image/png' }), 'boundary.png');
      assert.equal((await send('/api/v1/admin/menu/items/test-item/image', { method: 'POST', body: boundary, headers: { authorization: 'Bearer test-admin' } })).status, 201);
      const oversized = new FormData(); oversized.append('image', new Blob([Buffer.alloc(4 * 1024 * 1024 + 65537)], { type: 'image/png' }), 'too-big.png');
      const res = await send('/api/v1/admin/menu/items/test-item/image', { method: 'POST', body: oversized, headers: { authorization: 'Bearer test-admin' } });
      assert.equal(res.status, 413); assert.equal((await res.json()).errors[0].code, 'PAYLOAD_TOO_LARGE');
      // Chunked requests have no Content-Length; the streaming counter must still return 413.
      const chunked = new ReadableStream({ start(controller) { for (let n = 0; n < 66; n++) controller.enqueue(new Uint8Array(65536)); controller.close(); } });
      const chunkedResponse = await send('/api/v1/cart/quote', { method: 'POST', duplex: 'half', body: chunked });
      assert.equal(chunkedResponse.status, 413);
      const denied = new FormData(); denied.append('image', new Blob(['test'], { type: 'image/png' }), 'denied.png');
      assert.equal((await send('/api/v1/admin/menu/items/test-item/image', { method: 'POST', body: denied })).status, 401);
    });
    await server.stop(); server = null;
    server = await startNext(target, false, true);
    await t.test('production build uses the signing handler for login and cart without external rewrite interception', async () => {
      for (const pathname of ['/api/v1/auth/login', '/api/v1/cart/quote']) {
        const res = await send(pathname, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
        assert.equal(res.status, 201); assert.equal(records.at(-1).headers['x-w4u-client-ip-signature'], signature);
        assert.equal(records.at(-1).headers['x-w4u-catalog-server'], undefined);
      }
    });
  } finally { if (server) await server.stop(); await nest.close(); }
});
