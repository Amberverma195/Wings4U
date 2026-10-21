const mockDisk = new Map();
// isolateModules may create another mock registry. Share the same disk adapter
// so each isolated token-store instance exercises the configured storage mock.
const mockSecureStore = { getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() };
jest.mock('expo-secure-store', () => mockSecureStore, { virtual: true });
const store = require('expo-secure-store');
let tokens;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => {
  mockDisk.clear(); jest.clearAllMocks();
  store.getItemAsync.mockImplementation(async key => mockDisk.get(key) ?? null);
  store.setItemAsync.mockImplementation(async (key, value) => { mockDisk.set(key, value); });
  store.deleteItemAsync.mockImplementation(async key => { mockDisk.delete(key); });
  jest.isolateModules(() => { tokens = require('../src/lib/token-store'); });
});
test('cold startup restores secure credentials without changing the session generation', async () => {
  mockDisk.set('wings4u_access_token', 'a'); mockDisk.set('wings4u_refresh_token', 'r');
  expect(await tokens.getAccessToken()).toBe('a'); expect(await tokens.getRefreshToken()).toBe('r');
  expect(tokens.getSessionGeneration()).toBe(0);
  await tokens.getAccessToken(); await tokens.getRefreshToken(); expect(store.getItemAsync).toHaveBeenCalledTimes(2);
});
test.each(['access', 'refresh'])('a pending cold %s read cannot repopulate the previous identity after login', async kind => {
  const read = deferred(); store.getItemAsync.mockReturnValueOnce(read.promise);
  const pending = kind === 'access' ? tokens.getAccessToken() : tokens.getRefreshToken();
  await tokens.setSessionTokens('b-access', 'b-refresh'); read.resolve('old-value');
  await expect(pending).rejects.toThrow('session changed');
  expect(await tokens.getAccessToken()).toBe('b-access');
});
test('a pending cold read cannot restore tokens after logout', async () => {
  const read = deferred(); store.getItemAsync.mockReturnValueOnce(read.promise);
  const pending = tokens.getAccessToken(); await tokens.clearAllTokens(); read.resolve('old-access');
  await expect(pending).rejects.toThrow('session changed'); expect(await tokens.getAccessToken()).toBeNull();
});
test('same-generation rotation is atomic and a stale rotation is a no-op', async () => {
  const generation = await tokens.setSessionTokens('a', 'r');
  expect(await tokens.commitRefreshedTokens(generation, 'a2', 'r2')).toBe(true); expect(tokens.getSessionGeneration()).toBe(generation);
  await tokens.setSessionTokens('b', 'br'); const writes = store.setItemAsync.mock.calls.length;
  expect(await tokens.commitRefreshedTokens(generation, 'stale', 'stale-r')).toBe(false);
  expect(store.setItemAsync).toHaveBeenCalledTimes(writes); expect(await tokens.getAccessToken()).toBe('b');
});
test('a stale clear cannot erase a newer login', async () => {
  const old = await tokens.setSessionTokens('a', 'ar'); await tokens.setSessionTokens('b', 'br');
  await tokens.clearAllTokens(old); expect(await tokens.getAccessToken()).toBe('b'); expect(await tokens.getRefreshToken()).toBe('br');
});
test('serialized old deletion cannot delete newer persisted credentials', async () => {
  await tokens.setSessionTokens('a', 'ar'); const deleting = deferred();
  store.deleteItemAsync.mockImplementationOnce(async key => { await deleting.promise; mockDisk.delete(key); });
  const logout = tokens.clearAllTokens(); await flush(); const login = tokens.setSessionTokens('b', 'br');
  expect(await tokens.getAccessToken()).toBe('b'); deleting.resolve(); await Promise.all([logout, login]);
  expect(mockDisk.get('wings4u_access_token')).toBe('b'); expect(mockDisk.get('wings4u_refresh_token')).toBe('br');
});
test('legacy concurrent individual setters and clearers still persist the latest full pair', async () => {
  await Promise.all([tokens.setAccessToken('a'), tokens.setRefreshToken('ar')]);
  expect(mockDisk.get('wings4u_access_token')).toBe('a'); expect(mockDisk.get('wings4u_refresh_token')).toBe('ar');
  await Promise.all([tokens.clearAccessToken(), tokens.clearRefreshToken()]);
  expect(mockDisk.has('wings4u_access_token')).toBe(false); expect(mockDisk.has('wings4u_refresh_token')).toBe(false);
});
test('secure-store failures retain the existing in-memory fallback', async () => {
  store.setItemAsync.mockRejectedValue(new Error('Secure store unavailable'));
  await tokens.setSessionTokens('a', 'ar'); expect(await tokens.getAccessToken()).toBe('a'); expect(await tokens.getRefreshToken()).toBe('ar');
});
