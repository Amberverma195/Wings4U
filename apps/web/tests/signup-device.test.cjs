jest.mock('@/lib/env', () => ({ getPublicApiBase: () => '' }));
const originalFetch = global.fetch;
let storage, device;
const key = 'w4u_signup_device_id';
const ttl = 180 * 24 * 60 * 60 * 1000;
beforeEach(() => {
  jest.resetModules(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-23T16:00:00Z'));
  storage = new Map();
  global.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) } };
  device = require('../src/lib/signup-device');
  global.fetch = jest.fn(async () => ({ ok: true }));
});
afterEach(() => { delete global.window; global.fetch = originalFetch; jest.useRealTimers(); });

test('creates only on demand with an explicit fixed 180-day deadline', () => {
  expect(storage.size).toBe(0);
  const id = device.getSignupDeviceId();
  expect(JSON.parse(storage.get(key))).toEqual({ id, createdAt: Date.now(), expiresAt: Date.now()+ttl });
});
test('reuses a valid identifier just before expiry without extending its retention', () => {
  const id = device.getSignupDeviceId(), record = storage.get(key);
  jest.advanceTimersByTime(ttl-1);
  expect(device.getSignupDeviceId()).toBe(id); expect(storage.get(key)).toBe(record);
});
test.each([ttl,ttl+1])('replaces an expired identifier at age %i', age => {
  const id = device.getSignupDeviceId(); jest.advanceTimersByTime(age);
  expect(device.getSignupDeviceId()).not.toBe(id);
  expect(JSON.parse(storage.get(key)).createdAt).toBe(Date.now());
});
test.each(['legacy-device-identifier', '{invalid json', JSON.stringify({id:'legacy-device-identifier'}), 'null'])('discards legacy/malformed state on browser load (%s)', raw => {
  storage.set(key,raw); jest.resetModules(); device=require('../src/lib/signup-device');
  expect(storage.has(key)).toBe(false); expect(device.getSignupDeviceId()).not.toBe(raw);
});
test('cleans expired state on load without generating a replacement until signup', () => {
  device.getSignupDeviceId(); jest.advanceTimersByTime(ttl); jest.resetModules();
  require('../src/lib/signup-device'); expect(storage.has(key)).toBe(false);
});
test.each(['future','extended','invalid'])('rejects corrupted %s timestamps', type => {
  const record={id:'existing-device-identifier',createdAt:Date.now(),expiresAt:Date.now()+ttl};
  if(type==='future') {record.createdAt+=1000;record.expiresAt+=1000;}
  if(type==='extended') record.expiresAt+=ttl;
  if(type==='invalid') record.createdAt='unknown';
  storage.set(key,JSON.stringify(record)); expect(device.getSignupDeviceId()).not.toBe(record.id);
});
test('storage denial and SSR do not prevent requests', async () => {
  window.localStorage.getItem=()=>{throw new Error('denied');};
  expect(device.getSignupDeviceId()).toBeUndefined();
  const {apiFetch}=require('../src/lib/api'); await apiFetch('/api/v1/auth/signup',{method:'POST'});
  expect(fetch.mock.calls[0][1].headers.has('X-W4U-Signup-Device')).toBe(false);
  delete global.window; expect(device.getSignupDeviceId()).toBeUndefined();
});
test('signup uses the new ID header after expiry; unrelated calls never mint one', async () => {
  const {apiFetch}=require('../src/lib/api');
  await apiFetch('/api/v1/auth/session'); expect(storage.size).toBe(0);
  await apiFetch('/api/v1/auth/signup',{method:'POST'});
  const before=fetch.mock.calls[1][1].headers.get('X-W4U-Signup-Device');
  expect(before).toBe(JSON.parse(storage.get(key)).id);
  jest.advanceTimersByTime(ttl);
  await apiFetch('/api/v1/auth/signup',{method:'POST'});
  expect(fetch.mock.calls[2][1].headers.get('X-W4U-Signup-Device')).not.toBe(before);
});
