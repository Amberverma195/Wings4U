const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }));
jest.mock('../src/lib/env', () => ({ DEFAULT_LOCATION_ID: 'default-location' }));
const { apiJson } = require('../src/lib/api');
const { useMenu } = require('../src/hooks/use-menu');
let result;
let observed = [];
let renderer;
function Probe({ method = 'PICKUP', location = 'store', scheduledFor = null, reloadKey }) {
  result = useMenu(method, location, scheduledFor, reloadKey);
  observed.push(result);
  return null;
}
const render = async (props = {}) => act(async () => {
  renderer = create(React.createElement(Probe, props));
});
beforeEach(() => { jest.resetAllMocks(); apiJson.mockResolvedValue({ data: { categories: [] } }); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('requests the same location, method and schedule parameters as the website', async () => {
  const scheduledFor = '2026-10-15T17:30:00.000Z';
  await render({ method: 'DELIVERY', location: 'LON01', scheduledFor });
  const [path, options] = apiJson.mock.calls[0];
  const url = new URL(path, 'http://localhost');
  expect(url.pathname).toBe('/api/v1/menu');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    location_id: 'LON01', fulfillment_type: 'DELIVERY', scheduled_for: scheduledFor,
  });
  expect(options.locationId).toBe('LON01');
});

test('changing the schedule refetches the menu', async () => {
  await render();
  await act(async () => renderer.update(React.createElement(Probe, { scheduledFor: '2026-10-15T17:30:00.000Z' })));
  expect(apiJson).toHaveBeenCalledTimes(2);
  expect(apiJson.mock.calls[0][0]).not.toContain('scheduled_for');
  expect(apiJson.mock.calls[1][0]).toContain('scheduled_for');
});

test('surfaces missing menu data instead of silently leaving the menu empty', async () => {
  apiJson.mockResolvedValue({ data: null });
  await render();
  expect(result.loading).toBe(false);
  expect(result.error).toBe('Menu response missing data');
});

test('a promotion refresh key reloads the menu and identifies the response without changing order context', async () => {
  await render({ method: 'DELIVERY', location: 'store', scheduledFor: '2026-10-16T16:00:00Z' });
  let resolve;
  apiJson.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await act(async () => renderer.update(React.createElement(Probe, {
    method: 'DELIVERY', location: 'store', scheduledFor: '2026-10-16T16:00:00Z', reloadKey: 'footer-2',
  })));
  expect(result.loading).toBe(true);
  expect(result.loadedReloadKey).not.toBe('footer-2');
  expect(apiJson.mock.calls[1][0]).toContain('fulfillment_type=DELIVERY');
  expect(apiJson.mock.calls[1][0]).toContain('scheduled_for=');
  await act(async () => resolve({ data: { categories: [] } }));
  expect(result.loadedReloadKey).toBe('footer-2');
  expect(result.loading).toBe(false);
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
test('initial failure and retry transition from pending to valid data without extra requests', async () => {
  const first = deferred(); apiJson.mockReturnValueOnce(first.promise); await render();
  expect(result.menu).toBeNull(); expect(result.loading).toBe(true);
  await act(async () => first.reject(new Error('Offline')));
  expect(result.error).toBe('Offline'); expect(result.loading).toBe(false);
  const retry = deferred(); apiJson.mockReturnValueOnce(retry.promise);
  await act(async () => result.refetch()); expect(result.loading).toBe(true); expect(result.error).toBeNull();
  await act(async () => retry.resolve({ data: { categories: [] } }));
  expect(result.menu).toEqual({ categories: [] }); expect(result.loading).toBe(false); expect(apiJson).toHaveBeenCalledTimes(2);
});
test('same-context refresh failure retains valid data and retry success replaces it and clears the error', async () => {
  await render(); const cached = result.menu; const refresh = deferred(); apiJson.mockReturnValueOnce(refresh.promise);
  await act(async () => result.refetch()); expect(result.menu).toBe(cached); expect(result.loading).toBe(true);
  await act(async () => refresh.reject(new Error('Offline')));
  expect(result.menu).toBe(cached); expect(result.error).toBe('Offline');
  const retry = deferred(); apiJson.mockReturnValueOnce(retry.promise); await act(async () => result.refetch());
  expect(result.menu).toBe(cached); expect(result.error).toBeNull();
  const fresh = { categories: [{ id: 'fresh' }] }; await act(async () => retry.resolve({ data: fresh }));
  expect(result.menu).toBe(fresh); expect(result.loading).toBe(false); expect(apiJson).toHaveBeenCalledTimes(3);
});
test.each([{ location: 'other' }, { method: 'DELIVERY' }, { scheduledFor: '2026-10-21T17:00:00Z' }, { reloadKey: 'new-promotion' }])('incompatible context %j hides cached data even before effects and after failure', async props => {
  await render(); const pending = deferred(); apiJson.mockReturnValueOnce(pending.promise); observed = [];
  await act(async () => renderer.update(React.createElement(Probe, props)));
  expect(observed.every(value => value.menu === null && value.loading)).toBe(true);
  await act(async () => pending.reject(new Error('New context offline')));
  expect(result.menu).toBeNull(); expect(result.error).toBe('New context offline');
  expect(apiJson).toHaveBeenCalledTimes(2);
});

test.each(['success', 'failure'])('late old-context %s cannot restore incompatible menu data or error', async outcome => {
  await render(); const old = deferred(); apiJson.mockReturnValueOnce(old.promise);
  await act(async () => result.refetch());
  const current = deferred(); apiJson.mockReturnValueOnce(current.promise);
  await act(async () => renderer.update(React.createElement(Probe, { location: 'new-store' })));
  expect(result.menu).toBeNull(); expect(result.loadedReloadKey).toBeNull();
  const fresh = { categories: [{ id: 'new-store-category' }] };
  await act(async () => current.resolve({ data: fresh }));
  await act(async () => outcome === 'success' ? old.resolve({ data: { categories: [{ id: 'old-store-category' }] } }) : old.reject(new Error('Old store offline')));
  expect(result.menu).toBe(fresh); expect(result.error).toBeNull(); expect(result.loading).toBe(false);
  expect(apiJson).toHaveBeenCalledTimes(3);
});
