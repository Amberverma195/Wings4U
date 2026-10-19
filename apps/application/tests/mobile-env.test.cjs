let mockExtra;
jest.mock('expo-constants', () => ({ __esModule: true, default: { get expoConfig() { return { extra: mockExtra }; } } }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
const { getApiBase, getRealtimeOrigin } = require('../src/lib/env');
const previousDev = global.__DEV__;
beforeEach(() => { mockExtra = {}; });
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
