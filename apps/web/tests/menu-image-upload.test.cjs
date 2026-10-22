const { menuImageFileError, menuImageUploadError, MAX_MENU_IMAGE_BYTES, MENU_IMAGE_SIZE_MESSAGE } = require('../src/lib/menu-image-upload');
const { boundedProxyBody, MAX_API_PROXY_BODY_BYTES } = require('../src/lib/api-proxy-body');
test('menu and builder upload pickers share the inclusive 4 MiB image limit', () => {
  expect(menuImageFileError({ size: MAX_MENU_IMAGE_BYTES, type: 'image/png' })).toBeNull();
  expect(menuImageFileError({ size: MAX_MENU_IMAGE_BYTES + 1, type: 'image/png' })).toBe(MENU_IMAGE_SIZE_MESSAGE);
  expect(menuImageFileError({ size: 10, type: 'text/plain' })).toMatch(/PNG, JPEG or WebP/);
});
test('plain platform 413 and API failures become useful upload messages', async () => {
  await expect(menuImageUploadError(new Response('FUNCTION_PAYLOAD_TOO_LARGE', { status: 413 }))).resolves.toBe(MENU_IMAGE_SIZE_MESSAGE);
  await expect(menuImageUploadError(new Response(JSON.stringify({ errors: [{ message: 'Forbidden' }] }), { status: 403 }))).resolves.toBe('Forbidden');
});
test('streaming proxy enforces its bound even without Content-Length', async () => {
  const chunk = new Uint8Array(65536);
  let count = 0;
  const body = new ReadableStream({ pull(controller) { if (++count < 70) controller.enqueue(chunk); else controller.close(); } });
  await expect(new Response(boundedProxyBody(body)).arrayBuffer()).rejects.toThrow();
  expect(count * chunk.length).toBeGreaterThan(MAX_API_PROXY_BODY_BYTES);
  expect(count).toBeLessThan(70);
});

jest.mock('server-only', () => ({}), { virtual: true });
test('same-origin upstream misconfiguration returns 502 instead of proxying into itself', async () => {
  const previous = process.env.API_PROXY_TARGET, originalFetch = global.fetch;
  process.env.API_PROXY_TARGET = 'https://web.example.test'; global.fetch = jest.fn();
  try {
    const { GET } = require('../src/app/api/v1/[...path]/route');
    const result = await GET(new Request('https://web.example.test/api/v1/auth/session'));
    expect(result.status).toBe(502); expect((await result.json()).errors[0].code).toBe('PROXY_CONFIGURATION_ERROR');
    expect(global.fetch).not.toHaveBeenCalled();
  } finally { if (previous === undefined) delete process.env.API_PROXY_TARGET; else process.env.API_PROXY_TARGET = previous; global.fetch = originalFetch; }
});
