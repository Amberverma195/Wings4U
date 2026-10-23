const configure = require('../app.config');
const { validateApiOrigin } = require('../config/api-origin.cjs');
const config = require('../app.json').expo;
const original = process.env;
beforeEach(() => { process.env = { ...original, NODE_ENV: 'test' }; for (const key of ['EAS_BUILD_PROFILE', 'MOBILE_APP_ENV', 'EXPO_PUBLIC_API_ORIGIN', 'EXPO_PUBLIC_REALTIME_ORIGIN', 'MOBILE_DEV_REMOTE_API', 'MOBILE_REALTIME_SAME_BACKEND_AS']) delete process.env[key]; });
afterEach(() => { process.env = original; });

test.each(['production', 'preview'])('%s explicitly configures the public website with a Railway API', profile => {
  process.env.EAS_BUILD_PROFILE = profile;
  process.env.EXPO_PUBLIC_API_ORIGIN = 'https://wings4uapi-production.up.railway.app';
  const extra = configure({ config }).extra;
  expect(extra.websiteUrl).toBe('https://www.wings4ulondon.ca');
  expect(extra.apiOrigin).toBe('https://wings4uapi-production.up.railway.app');
});

test.each([undefined, '', 'http://www.wings4ulondon.ca', 'https://localhost', 'https://example.com/privacy', 'https://user:pass@example.com', 'https://example.com?x=1', 'https://example.com#x'])('production rejects missing or invalid website origin %s', websiteUrl => {
  process.env.EAS_BUILD_PROFILE = 'production';
  process.env.EXPO_PUBLIC_API_ORIGIN = 'https://wings4uapi-production.up.railway.app';
  expect(() => configure({ config: { ...config, extra: { ...config.extra, websiteUrl } } })).toThrow('websiteUrl');
});
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
  expect(configure({ config }).extra).toMatchObject({ apiOrigin: 'http://192.168.1.50:3001', apiOriginExplicit: true });
});
test('the default LAN origin is not marked explicit, so the Android emulator keeps its loopback default', () => {
  expect(configure({ config }).extra.apiOriginExplicit).toBe(false);
});
test.each(['http://10.0.2.2:3001', 'http://127.0.0.1:3001', 'http://localhost:3001', 'http://172.20.1.4:3001', 'http://devbox:3001', 'http://api.lan:3001'])(
  'development may target local backend %s without an opt-in', origin => {
    process.env.EXPO_PUBLIC_API_ORIGIN = origin;
    expect(configure({ config }).extra.apiOriginExplicit).toBe(true);
  });
test.each(['https://api.example.com', 'https://wings4u-api.up.railway.app', 'http://203.0.113.10:3001'])(
  'development requires an explicit opt-in before targeting remote backend %s', origin => {
    process.env.EXPO_PUBLIC_API_ORIGIN = origin;
    expect(() => configure({ config })).toThrow('MOBILE_DEV_REMOTE_API=allow');
    process.env.MOBILE_DEV_REMOTE_API = 'yes';
    expect(() => configure({ config })).toThrow('MOBILE_DEV_REMOTE_API=allow');
    process.env.MOBILE_DEV_REMOTE_API = 'allow';
    expect(configure({ config }).extra).toMatchObject({ apiOrigin: new URL(origin).origin, apiOriginExplicit: true, environment: 'development' });
  });
test('the remote opt-in also covers the realtime origin and requires REST on the same backend', () => {
  process.env.EXPO_PUBLIC_REALTIME_ORIGIN = 'https://api.example.com';
  expect(() => configure({ config })).toThrow('MOBILE_DEV_REMOTE_API=allow');
  process.env.MOBILE_DEV_REMOTE_API = 'allow';
  expect(() => configure({ config })).toThrow('must target the same backend');
  process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com';
  expect(configure({ config }).extra).toMatchObject({ apiOrigin: 'https://api.example.com', realtimeOrigin: 'https://api.example.com' });
});
describe('REST and Socket.IO must target the same backend', () => {
  const configureRelease = () => { process.env.EAS_BUILD_PROFILE = 'production'; return configure({ config }); };
  const configureRemoteDevelopment = () => { process.env.MOBILE_DEV_REMOTE_API = 'allow'; return configure({ config }); };

  test.each([['release', configureRelease], ['development', configureRemoteDevelopment]])(
    '%s builds reject two different remote backends', (_label, build) => {
      process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com';
      process.env.EXPO_PUBLIC_REALTIME_ORIGIN = 'https://realtime.other-backend.example';
      expect(build).toThrow('must target the same backend');
    });
  test.each([['release', configureRelease], ['development', configureRemoteDevelopment]])(
    '%s builds accept identical origins, written in different but equivalent forms', (_label, build) => {
      process.env.EXPO_PUBLIC_API_ORIGIN = 'https://API.example.com/';
      process.env.EXPO_PUBLIC_REALTIME_ORIGIN = 'https://api.example.com';
      expect(build().extra).toMatchObject({ apiOrigin: 'https://api.example.com', realtimeOrigin: 'https://api.example.com', realtimeAliasOf: undefined });
    });
  test.each([['release', configureRelease], ['development', configureRemoteDevelopment]])(
    '%s builds accept a different realtime host only when declared an alias of the exact API origin', (_label, build) => {
      process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com';
      process.env.EXPO_PUBLIC_REALTIME_ORIGIN = 'https://ws.example.com';
      process.env.MOBILE_REALTIME_SAME_BACKEND_AS = 'https://api.example.com/';
      expect(build().extra).toMatchObject({ realtimeOrigin: 'https://ws.example.com', realtimeAliasOf: 'https://api.example.com' });
    });
  test.each([
    ['a different backend', 'https://ws.example.com', 'https://other.example.com'],
    ['the realtime host itself', 'https://ws.example.com', 'https://ws.example.com'],
    ['no realtime override', undefined, 'https://api.example.com'],
    ['an origin that equals the API already', 'https://api.example.com', 'https://api.example.com'],
  ])('an alias naming %s is rejected', (_label, realtime, alias) => {
    process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com';
    if (realtime) process.env.EXPO_PUBLIC_REALTIME_ORIGIN = realtime;
    process.env.MOBILE_REALTIME_SAME_BACKEND_AS = alias;
    expect(configureRelease).toThrow('MOBILE_REALTIME_SAME_BACKEND_AS must equal the API origin');
  });
  test('a remote realtime origin cannot pair with the local default development API', () => {
    process.env.MOBILE_DEV_REMOTE_API = 'allow';
    process.env.EXPO_PUBLIC_REALTIME_ORIGIN = 'https://api.example.com';
    expect(() => configure({ config })).toThrow('and the API origin (http://10.0.0.192:3001) must target the same backend');
  });
  test('a local realtime override with a remote API is rejected', () => {
    process.env.MOBILE_DEV_REMOTE_API = 'allow';
    process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com';
    process.env.EXPO_PUBLIC_REALTIME_ORIGIN = 'http://10.0.2.2:3001';
    expect(() => configure({ config })).toThrow('must target the same backend');
  });
  test('two local origins remain allowed for local development', () => {
    process.env.EXPO_PUBLIC_REALTIME_ORIGIN = 'http://10.0.2.2:3001';
    expect(configure({ config }).extra).toMatchObject({ apiOrigin: 'http://10.0.0.192:3001', realtimeOrigin: 'http://10.0.2.2:3001' });
  });
});

describe('the remote development opt-in applies to the effective API origin', () => {
  const remoteDefault = { ...config, extra: { ...config.extra, developmentApiOrigin: 'https://wings4u-api.up.railway.app' } };
  test('a remote developmentApiOrigin fallback requires MOBILE_DEV_REMOTE_API=allow', () => {
    expect(() => configure({ config: remoteDefault })).toThrow('remote backend https://wings4u-api.up.railway.app');
    process.env.MOBILE_DEV_REMOTE_API = 'allow';
    expect(configure({ config: remoteDefault }).extra).toMatchObject({ apiOrigin: 'https://wings4u-api.up.railway.app', apiOriginExplicit: false });
  });
  test('a local explicit origin does not need the opt-in even when the fallback is remote', () => {
    process.env.EXPO_PUBLIC_API_ORIGIN = 'http://10.0.2.2:3001';
    expect(configure({ config: remoteDefault }).extra.apiOrigin).toBe('http://10.0.2.2:3001');
  });
  test('the shipped LAN default needs no opt-in', () => {
    expect(configure({ config }).extra).toMatchObject({ apiOrigin: 'http://10.0.0.192:3001', apiOriginExplicit: false });
  });
  test('release builds never use the development fallback', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    expect(() => configure({ config: remoteDefault })).toThrow('EXPO_PUBLIC_API_ORIGIN');
  });
});

test('a remote-origin error never echoes credentials', () => {
  process.env.EXPO_PUBLIC_API_ORIGIN = 'https://user:secret@api.example.com';
  expect(() => configure({ config })).toThrow('without credentials');
});
test('production builds use their public origin without the development opt-in', () => {
  process.env.EAS_BUILD_PROFILE = 'production'; process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com';
  expect(configure({ config }).extra).toMatchObject({ environment: 'production', apiOrigin: 'https://api.example.com' });
});
