const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('../src/lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('../src/lib/token-store', () => ({
  getRefreshToken: jest.fn(), clearAllTokens: jest.fn(),
  setAccessToken: jest.fn(), setRefreshToken: jest.fn(),
}));
const { SessionProvider, useSession, withSilentRefresh } = require('../src/context/session');
const { apiFetch } = require('../src/lib/api');
const tokens = require('../src/lib/token-store');
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => ({ data }) });
const signedIn = { authenticated: true, user: { id: 'customer' }, profile_complete: true };
let session;
let renderer;
function Probe() { session = useSession(); return null; }
const mount = async () => act(async () => {
  renderer = create(React.createElement(SessionProvider, null, React.createElement(Probe)));
});
beforeEach(() => {
  jest.resetAllMocks();
  require('react-native').AppState.addEventListener.mockReturnValue({ remove: jest.fn() });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('restores expired access on startup using rotated native tokens', async () => {
  tokens.getRefreshToken.mockResolvedValue('old-refresh');
  apiFetch.mockResolvedValueOnce(response({ authenticated: false }))
    .mockResolvedValueOnce(response({ refreshed: true, access_token: 'new-access', refresh_token: 'new-refresh' }))
    .mockResolvedValueOnce(response(signedIn));
  await mount();
  expect(session.authenticated).toBe(true);
  expect(tokens.setAccessToken).toHaveBeenCalledWith('new-access');
  expect(tokens.setRefreshToken).toHaveBeenCalledWith('new-refresh');
  expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({ refresh_token: 'old-refresh' });
});

test('does not sign out an existing session on temporary refresh failure', async () => {
  apiFetch.mockResolvedValueOnce(response(signedIn));
  await mount();
  tokens.getRefreshToken.mockResolvedValue('refresh');
  apiFetch.mockResolvedValueOnce(response({ authenticated: false }))
    .mockResolvedValueOnce(response(null, 503));
  await act(async () => { expect(await session.refresh()).toBe(false); });
  expect(session.authenticated).toBe(true);
  expect(tokens.clearAllTokens).not.toHaveBeenCalled();
});

test('does not clear a session when a protected request has a network refresh failure', async () => {
  tokens.getRefreshToken.mockResolvedValue('refresh');
  apiFetch.mockRejectedValue(new Error('Network unavailable'));
  const clear = jest.fn();
  const call = jest.fn(async () => response(null, 401));
  await withSilentRefresh(call, jest.fn(), clear);
  expect(clear).not.toHaveBeenCalled();
});

test('clears a session when the refresh token is definitively rejected', async () => {
  tokens.getRefreshToken.mockResolvedValue('revoked');
  apiFetch.mockResolvedValue(response({ refreshed: false }));
  const clear = jest.fn();
  await withSilentRefresh(async () => response(null, 401), jest.fn(), clear);
  expect(clear).toHaveBeenCalledTimes(1);
});
