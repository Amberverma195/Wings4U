const configure = require('../app.config');
const { validateApiOrigin } = require('../config/api-origin.cjs');
const config = require('../app.json').expo;
const original = process.env;
beforeEach(() => { process.env = { ...original, NODE_ENV: 'test' }; for (const key of ['EAS_BUILD_PROFILE', 'MOBILE_APP_ENV', 'EXPO_PUBLIC_API_ORIGIN', 'EXPO_PUBLIC_REALTIME_ORIGIN']) delete process.env[key]; });
afterEach(() => { process.env = original; });
test('local development retains the configured LAN workflow', () => {
  expect(configure({ config }).extra.apiOrigin).toBe('http://10.0.0.192:3001');
});
test('EAS development retains LAN access even when the build tooling sets NODE_ENV=production', () => {
  process.env.EAS_BUILD_PROFILE = 'development'; process.env.NODE_ENV = 'production';
  expect(configure({ config }).extra.apiOrigin).toBe('http://10.0.0.192:3001');
});
test.each(['production', 'preview'])('EAS %s requires explicit public API configuration', profile => {
  process.env.EAS_BUILD_PROFILE = profile;
  expect(() => configure({ config })).toThrow('EXPO_PUBLIC_API_ORIGIN');
  process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com/';
  expect(configure({ config }).extra.apiOrigin).toBe('https://api.example.com');
});
test.each(['http://10.0.0.192:3001', 'https://127.0.0.1', 'https://localhost', 'https://api.internal', 'https://user:pass@example.com', 'https://example.com/api'])('release rejects %s', origin => {
  expect(() => validateApiOrigin(origin, true)).toThrow();
});
test('production export also requires configuration without an EAS profile', () => {
  process.env.NODE_ENV = 'production'; expect(() => configure({ config })).toThrow('EXPO_PUBLIC_API_ORIGIN');
});
test.each(['production', 'preview'])('EAS %s rejects a development override even with a public origin', profile => {
  process.env.EAS_BUILD_PROFILE = profile;
  process.env.MOBILE_APP_ENV = 'development';
  expect(() => configure({ config })).toThrow('conflicts with this release build');
  process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com';
  expect(() => configure({ config })).toThrow('conflicts with this release build');
});
test('production export rejects a development override without an EAS profile', () => {
  process.env.NODE_ENV = 'production'; process.env.MOBILE_APP_ENV = 'development';
  expect(() => configure({ config })).toThrow('conflicts with this release build');
});
test.each([
  'https://10.0.0.192', 'https://172.16.0.1', 'https://192.168.1.1', 'https://169.254.1.1',
  'https://[::1]', 'https://[fd00::1]', 'https://2130706433', 'https://0x7f000001',
  'https://api.localhost.', 'https://api.local', 'https://api.lan', 'https://api.corp',
  'https://api.home.arpa', 'https://api.localdomain', 'https://api.intranet',
  'https://example.com?token=x', 'https://example.com#fragment',
])('release rejects non-public or non-origin configuration %s before bundling', origin => {
  process.env.EAS_BUILD_PROFILE = 'production'; process.env.EXPO_PUBLIC_API_ORIGIN = origin;
  expect(() => configure({ config })).toThrow();
});
test('explicit local LAN configuration and development overrides remain supported', () => {
  process.env.MOBILE_APP_ENV = 'development'; process.env.EXPO_PUBLIC_API_ORIGIN = 'http://192.168.1.50:3001';
  expect(configure({ config }).extra.apiOrigin).toBe('http://192.168.1.50:3001');
});
