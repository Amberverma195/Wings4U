let mockGeneration = 1;
jest.mock('../src/lib/auth-events', () => ({ getAuthSessionGeneration: () => mockGeneration }));
jest.mock('../src/lib/api', () => ({ apiFetch: jest.fn(), getRetryAfterSeconds: () => 30 }));
let api, fetch;
const state = { items: [], fulfillmentType: 'PICKUP', locationTimezone: 'America/Toronto', scheduledFor: null,
  driverTipPercent: 'none', ownerId: 'customer-a' };
const snapshot = revision => ({ items: [], fulfillment_type: 'PICKUP', location_timezone: 'America/Toronto',
  scheduled_for: null, driver_tip_percent: 'none', is_guest: false, expires_at: null, revision });
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => ({ data: value }) });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => { jest.useFakeTimers(); jest.resetModules(); mockGeneration = 1;
  api = require('../src/lib/saved-cart-api'); fetch = require('../src/lib/api').apiFetch; });
afterEach(() => { api.cancelDeferredSavedCartWrite(); jest.clearAllTimers(); jest.useRealTimers(); });

test.each([401, 409, 429, 503])('HTTP %i is a recoverable read failure, not an empty saved cart', async status => {
  fetch.mockResolvedValue(response(null, status));
  await expect(api.fetchSavedCart('store', 'customer-a')).rejects.toMatchObject({ status });
});

test('network errors and malformed responses differ from a successful empty or expired cart', async () => {
  fetch.mockRejectedValueOnce(new Error('offline'));
  await expect(api.fetchSavedCart('store')).rejects.toMatchObject({ status: 0 });
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ unexpected: true }) });
  await expect(api.fetchSavedCart('store')).rejects.toMatchObject({ status: 502 });
  fetch.mockResolvedValueOnce(response(snapshot(null))).mockResolvedValueOnce(response({ ...snapshot('expired'), expired: true }));
  await expect(api.fetchSavedCart('store')).resolves.toMatchObject({ items: [] });
  await expect(api.fetchSavedCart('store')).resolves.toMatchObject({ expired: true });
});

test('slow replacement saves are serialized, coalesced and use the previous acknowledgement revision', async () => {
  fetch.mockResolvedValueOnce(response(snapshot('r0'))); await api.fetchSavedCart('store', 'customer-a'); fetch.mockClear();
  let finish;
  fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(response(snapshot('r2')));
  const first = api.putSavedCart('store', { ...state, driverTipPercent: '10' });
  const superseded = api.putSavedCart('store', { ...state, driverTipPercent: '15' });
  const newest = api.putSavedCart('store', { ...state, driverTipPercent: '20' });
  await expect(superseded).resolves.toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
  finish(response(snapshot('r1'))); await first; await newest;
  expect(fetch).toHaveBeenCalledTimes(2);
  const bodies = fetch.mock.calls.map(call => JSON.parse(call[1].body));
  expect(bodies[0]).toMatchObject({ expected_revision: 'r0', driver_tip_percent: '10' });
  expect(bodies[1]).toMatchObject({ expected_revision: 'r1', driver_tip_percent: '20' });
  expect(fetch.mock.calls[1][1].headers['X-Cart-Owner']).toBe('user:customer-a');
});

test('clearing waits for an in-flight save and cancels pending replacements', async () => {
  let finish; fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(response({ cleared: true }));
  const first = api.putSavedCart('store', state);
  const pending = api.putSavedCart('store', { ...state, driverTipPercent: '15' });
  const deleted = api.deleteSavedCart('store', 'customer-a');
  await expect(pending).resolves.toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
  finish(response(snapshot('r1'))); await first; await deleted;
  expect(fetch.mock.calls.map(call => call[1].method)).toEqual(['PUT', 'DELETE']);
});

test('an explicit empty save supersedes an already-started save using its committed revision', async () => {
  fetch.mockResolvedValueOnce(response(snapshot('r0'))); await api.fetchSavedCart('store', 'customer-a'); fetch.mockClear();
  let finish; fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(response(snapshot('empty')));
  const first = api.putSavedCart('store', { ...state, driverTipPercent: '20' });
  api.cancelDeferredSavedCartWrite(); const cleared = api.putSavedCart('store', state);
  finish(response(snapshot('r1'))); await first; await cleared;
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ expected_revision: 'r1', items: [] });
});

test('queued saves from an old session never execute after logout', async () => {
  let finish; fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = api.putSavedCart('store', state);
  const queued = api.putSavedCart('store', { ...state, driverTipPercent: '20' });
  mockGeneration++; finish(response(snapshot('old')));
  await expect(first).resolves.toBeNull(); await expect(queued).resolves.toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
});

test('a stalled read aborts with a recoverable failure', async () => {
  fetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
  const expected = expect(api.fetchSavedCart('store')).rejects.toMatchObject({ status: 0 });
  await jest.advanceTimersByTimeAsync(10000); await expected; await flush();
});
