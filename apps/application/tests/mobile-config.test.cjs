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
