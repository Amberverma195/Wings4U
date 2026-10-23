let mockExtra;
const mockPlatform = { OS: 'ios' };
jest.mock('expo-constants', () => ({ __esModule: true, default: { get expoConfig() { return { extra: mockExtra }; } } }));
jest.mock('react-native', () => ({ Platform: mockPlatform }));
const { getApiBase, getRealtimeOrigin, getPrivacyPolicyUrl, getTermsOfServiceUrl } = require('../src/lib/env');
const previousDev = global.__DEV__;
beforeEach(() => { mockExtra = {}; mockPlatform.OS = 'ios'; global.__DEV__ = true; });

test('legal terms use the configured public policy website without query or fragment', () => {
  mockExtra.websiteUrl = 'https://www.wings4ulondon.ca/';
  expect(getTermsOfServiceUrl()).toBe('https://www.wings4ulondon.ca/terms');
});
afterEach(() => { global.__DEV__ = previousDev; });
test('release runtime cannot fall back to a local development origin', () => {
  global.__DEV__ = false;
  expect(() => getApiBase()).toThrow('not configured');
  mockExtra.apiOrigin = 'http://10.0.0.192:3001'; expect(() => getApiBase()).toThrow('public HTTPS');
});
test('release REST and realtime can share the website backend', () => {
  global.__DEV__ = false; mockExtra.apiOrigin = 'https://api.example.com/';
  expect(getApiBase()).toBe('https://api.example.com'); expect(getRealtimeOrigin()).toBe('https://api.example.com');
});
test('local iOS simulator fallback still works', () => {
  global.__DEV__ = true; expect(getApiBase()).toBe('http://127.0.0.1:3001');
});
test('Android emulator retains its development loopback override', () => {
  global.__DEV__ = true; mockPlatform.OS = 'android'; mockExtra.apiOrigin = 'http://192.168.1.50:3001';
  expect(getApiBase()).toBe('http://10.0.2.2:3001');
});
test.each([
  ['a deployed API', 'https://api.example.com'],
  ['a LAN API', 'http://192.168.1.50:3001'],
])('an explicit development origin for %s wins over the Android emulator loopback', (_label, origin) => {
  global.__DEV__ = true; mockPlatform.OS = 'android';
  mockExtra = { environment: 'development', apiOrigin: origin, apiOriginExplicit: true };
  expect(getApiBase()).toBe(origin);
  expect(getRealtimeOrigin()).toBe(origin);
});
test('without an explicit origin the iOS simulator keeps the default LAN origin', () => {
  global.__DEV__ = true; mockExtra = { apiOrigin: 'http://10.0.0.192:3001', apiOriginExplicit: false };
  expect(getApiBase()).toBe('http://10.0.0.192:3001');
});
test('release runtime rejects a realtime origin on a different backend', () => {
  global.__DEV__ = false;
  mockExtra = { environment: 'production', apiOrigin: 'https://api.example.com', realtimeOrigin: 'https://ws.other.example' };
  expect(() => getRealtimeOrigin()).toThrow('does not target the API backend');
  mockExtra.realtimeAliasOf = 'https://other.example';
  expect(() => getRealtimeOrigin()).toThrow('does not target the API backend');
});
test('release runtime accepts the same origin or a declared alias of the API origin', () => {
  global.__DEV__ = false;
  mockExtra = { environment: 'production', apiOrigin: 'https://api.example.com', realtimeOrigin: 'https://api.example.com/' };
  expect(getRealtimeOrigin()).toBe('https://api.example.com');
  mockExtra = { ...mockExtra, realtimeOrigin: 'https://ws.example.com', realtimeAliasOf: 'https://api.example.com' };
  expect(getRealtimeOrigin()).toBe('https://ws.example.com');
});
test('development runtime keeps a local realtime override beside the emulator loopback', () => {
  global.__DEV__ = true; mockPlatform.OS = 'android';
  mockExtra = { apiOrigin: 'http://10.0.0.192:3001', apiOriginExplicit: false, realtimeOrigin: 'http://10.0.2.2:3001' };
  expect(getApiBase()).toBe('http://10.0.2.2:3001');
  expect(getRealtimeOrigin()).toBe('http://10.0.2.2:3001');
});
test('production environment cannot use the Android emulator override', () => {
  global.__DEV__ = true; mockPlatform.OS = 'android';
  mockExtra = { environment: 'production', apiOrigin: 'https://api.example.com' };
  expect(getApiBase()).toBe('https://api.example.com');
});

test('legal URLs never derive their website from the API subdomain', () => {
  global.__DEV__ = false;
  mockExtra = { environment: 'production', apiOrigin: 'https://api.wings4ulondon.ca' };
  const url = getPrivacyPolicyUrl();
  expect(url).toBe('https://www.wings4ulondon.ca/privacy');
  expect(new URL(url).hostname).toBe('www.wings4ulondon.ca');
  expect(new URL(url).pathname).toBe('/privacy');
});

test('getPrivacyPolicyUrl falls back to https://www.wings4ulondon.ca/privacy on lookup failure', () => {
  global.__DEV__ = false;
  mockExtra = { environment: 'production' }; // getApiBase throws because apiOrigin is not configured
  const url = getPrivacyPolicyUrl();
  expect(url).toBe('https://www.wings4ulondon.ca/privacy');
  expect(new URL(url).hostname).toBe('www.wings4ulondon.ca');
  expect(new URL(url).pathname).toBe('/privacy');
});

test('getPrivacyPolicyUrl derives from explicit websiteUrl or privacyPolicyUrl with wings4ulondon.ca', () => {
  mockExtra = { websiteUrl: 'https://www.wings4ulondon.ca' };
  expect(getPrivacyPolicyUrl()).toBe('https://www.wings4ulondon.ca/privacy');

  mockExtra = { privacyPolicyUrl: 'https://www.wings4ulondon.ca/legal/privacy' };
  expect(getPrivacyPolicyUrl()).toBe('https://www.wings4ulondon.ca/privacy');
});

test.each(['https://wings4uapi-production.up.railway.app', 'https://api.wings4ulondon.ca'])('production legal links stay on the website with API %s', apiOrigin => {
  global.__DEV__ = false;
  mockExtra = { environment: 'production', apiOrigin, websiteUrl: 'https://www.wings4ulondon.ca' };
  expect(getPrivacyPolicyUrl()).toBe('https://www.wings4ulondon.ca/privacy');
  expect(getTermsOfServiceUrl()).toBe('https://www.wings4ulondon.ca/terms');
  delete mockExtra.websiteUrl;
  expect(getPrivacyPolicyUrl()).toBe('https://www.wings4ulondon.ca/privacy');
  expect(getTermsOfServiceUrl()).toBe('https://www.wings4ulondon.ca/terms');
});

test('both helpers honor a validated website origin independently of legacy privacy/API extras', () => {
  global.__DEV__ = false;
  mockExtra = { websiteUrl: 'https://preview.wings4ulondon.ca/', privacyPolicyUrl: 'https://wrong.example/privacy', apiOrigin: 'https://wings4uapi-production.up.railway.app' };
  expect(getPrivacyPolicyUrl()).toBe('https://preview.wings4ulondon.ca/privacy');
  expect(getTermsOfServiceUrl()).toBe('https://preview.wings4ulondon.ca/terms');
});