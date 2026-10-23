/**
 * End to end origin resolution: app.config.js runs with the given build
 * variables, and its `extra` feeds the runtime resolver on each device type.
 */
let mockExtra, mockIsDevice;
const mockPlatform = { OS: 'android' };
jest.mock('expo-constants', () => ({ __esModule: true, default: { get expoConfig() { return { extra: mockExtra }; } } }));
jest.mock('expo-device', () => ({ get isDevice() { return mockIsDevice; } }));
jest.mock('react-native', () => ({ Platform: mockPlatform }));
const configure = require('../app.config');
const appJson = require('../app.json').expo;
const { getApiBase, getRealtimeOrigin, getPrivacyPolicyUrl, getTermsOfServiceUrl } = require('../src/lib/env');

const VARS = ['EAS_BUILD_PROFILE', 'MOBILE_APP_ENV', 'EXPO_PUBLIC_API_ORIGIN', 'EXPO_PUBLIC_REALTIME_ORIGIN', 'MOBILE_DEV_REMOTE_API', 'MOBILE_REALTIME_SAME_BACKEND_AS'];
const original = process.env;
const previousDev = global.__DEV__;
const LAN_DEFAULT = appJson.extra.developmentApiOrigin;
const EMULATOR = { OS: 'android', isDevice: false };
const ANDROID_PHONE = { OS: 'android', isDevice: true };
const IOS_SIMULATOR = { OS: 'ios', isDevice: false };
const IPHONE = { OS: 'ios', isDevice: true };

function resolve({ env = {}, device, developmentApiOrigin = LAN_DEFAULT, release = false }) {
  process.env = { ...original, NODE_ENV: 'test' };
  for (const key of VARS) delete process.env[key];
  Object.assign(process.env, env);
  if (release) process.env.EAS_BUILD_PROFILE = 'production';
  mockExtra = configure({ config: { ...appJson, extra: { ...appJson.extra, developmentApiOrigin } } }).extra;
  global.__DEV__ = !release;
  mockPlatform.OS = device.OS;
  mockIsDevice = device.isDevice;
  return { rest: getApiBase(), realtime: getRealtimeOrigin() };
}

afterEach(() => { process.env = original; global.__DEV__ = previousDev; });

test('release config feeds website legal URLs to the runtime while REST uses Railway', () => {
  const apiOrigin = 'https://wings4uapi-production.up.railway.app';
  expect(resolve({ device: ANDROID_PHONE, release: true, env: { EXPO_PUBLIC_API_ORIGIN: apiOrigin } }))
    .toEqual({ rest: apiOrigin, realtime: apiOrigin });
  expect(getPrivacyPolicyUrl()).toBe('https://www.wings4ulondon.ca/privacy');
  expect(getTermsOfServiceUrl()).toBe('https://www.wings4ulondon.ca/terms');
});

describe('development', () => {
  test('Android emulator with the default LAN settings uses the host loopback for both', () => {
    expect(resolve({ device: EMULATOR })).toEqual({ rest: 'http://10.0.2.2:3001', realtime: 'http://10.0.2.2:3001' });
  });

  test('Android emulator with an explicit local API origin uses it for both', () => {
    expect(resolve({ device: EMULATOR, env: { EXPO_PUBLIC_API_ORIGIN: 'http://192.168.1.50:3001' } }))
      .toEqual({ rest: 'http://192.168.1.50:3001', realtime: 'http://192.168.1.50:3001' });
  });

  test('Android emulator with an explicit remote API origin and opt-in uses it for both', () => {
    expect(resolve({ device: EMULATOR, env: { EXPO_PUBLIC_API_ORIGIN: 'https://api.example.com', MOBILE_DEV_REMOTE_API: 'allow' } }))
      .toEqual({ rest: 'https://api.example.com', realtime: 'https://api.example.com' });
  });

  test('Android emulator with a remote developmentApiOrigin and matching realtime origin keeps both remote', () => {
    expect(resolve({
      device: EMULATOR,
      developmentApiOrigin: 'https://api.example.com',
      env: { EXPO_PUBLIC_REALTIME_ORIGIN: 'https://api.example.com', MOBILE_DEV_REMOTE_API: 'allow' },
    })).toEqual({ rest: 'https://api.example.com', realtime: 'https://api.example.com' });
  });

  test('Android emulator with a remote developmentApiOrigin and no realtime override keeps both remote', () => {
    expect(resolve({ device: EMULATOR, developmentApiOrigin: 'https://api.example.com', env: { MOBILE_DEV_REMOTE_API: 'allow' } }))
      .toEqual({ rest: 'https://api.example.com', realtime: 'https://api.example.com' });
  });

  test('a local REST origin with a remote realtime origin is rejected at build time', () => {
    expect(() => resolve({ device: EMULATOR, env: { EXPO_PUBLIC_REALTIME_ORIGIN: 'https://api.example.com', MOBILE_DEV_REMOTE_API: 'allow' } }))
      .toThrow('must target the same backend');
  });

  test('a runtime config pairing the emulator loopback with a remote realtime origin is rejected', () => {
    mockExtra = { environment: 'development', apiOrigin: LAN_DEFAULT, apiOriginExplicit: false, realtimeOrigin: 'https://api.example.com' };
    global.__DEV__ = true; mockPlatform.OS = 'android'; mockIsDevice = false;
    expect(getApiBase()).toBe('http://10.0.2.2:3001');
    expect(() => getRealtimeOrigin()).toThrow('does not target the API backend');
  });

  test('a local realtime override beside the emulator loopback remains allowed', () => {
    expect(resolve({ device: EMULATOR, env: { EXPO_PUBLIC_REALTIME_ORIGIN: 'http://10.0.2.2:3001' } }))
      .toEqual({ rest: 'http://10.0.2.2:3001', realtime: 'http://10.0.2.2:3001' });
  });

  test.each([['iOS simulator', IOS_SIMULATOR], ['Android phone', ANDROID_PHONE], ['iPhone', IPHONE]])(
    '%s uses the LAN default for both', (_label, device) => {
      expect(resolve({ device })).toEqual({ rest: LAN_DEFAULT, realtime: LAN_DEFAULT });
    });

  test.each([['iOS simulator', IOS_SIMULATOR], ['Android phone', ANDROID_PHONE], ['iPhone', IPHONE]])(
    '%s keeps a remote developmentApiOrigin for both', (_label, device) => {
      expect(resolve({ device, developmentApiOrigin: 'https://api.example.com', env: { MOBILE_DEV_REMOTE_API: 'allow' } }))
        .toEqual({ rest: 'https://api.example.com', realtime: 'https://api.example.com' });
    });

  test('the same-backend alias is honoured on the Android emulator', () => {
    expect(resolve({
      device: EMULATOR,
      env: {
        EXPO_PUBLIC_API_ORIGIN: 'https://api.example.com', EXPO_PUBLIC_REALTIME_ORIGIN: 'https://ws.example.com',
        MOBILE_REALTIME_SAME_BACKEND_AS: 'https://api.example.com', MOBILE_DEV_REMOTE_API: 'allow',
      },
    })).toEqual({ rest: 'https://api.example.com', realtime: 'https://ws.example.com' });
  });
});

describe('release', () => {
  test.each([['Android', ANDROID_PHONE], ['iOS', IPHONE]])('%s uses matching HTTPS origins', (_label, device) => {
    expect(resolve({ release: true, device, env: { EXPO_PUBLIC_API_ORIGIN: 'https://api.example.com', EXPO_PUBLIC_REALTIME_ORIGIN: 'https://api.example.com/' } }))
      .toEqual({ rest: 'https://api.example.com', realtime: 'https://api.example.com' });
  });

  test('a declared same-backend alias is accepted', () => {
    expect(resolve({
      release: true, device: ANDROID_PHONE,
      env: { EXPO_PUBLIC_API_ORIGIN: 'https://api.example.com', EXPO_PUBLIC_REALTIME_ORIGIN: 'https://ws.example.com', MOBILE_REALTIME_SAME_BACKEND_AS: 'https://api.example.com' },
    })).toEqual({ rest: 'https://api.example.com', realtime: 'https://ws.example.com' });
  });

  test('runtime still rejects a realtime origin on another backend', () => {
    mockExtra = { environment: 'production', apiOrigin: 'https://api.example.com', realtimeOrigin: 'https://ws.other.example' };
    global.__DEV__ = false;
    expect(() => getRealtimeOrigin()).toThrow('does not target the API backend');
  });
});
