const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

let mockGeneration = 0;
const session = { refresh: jest.fn(), clear: jest.fn(), user: null };
jest.mock('../src/context/session', () => ({
  useSession: () => session,
  withSilentRefresh: (call) => call(),
}));
jest.mock('../src/lib/api', () => ({
  apiFetch: jest.fn(),
  getApiErrorMessage: (body, fallback) => body?.errors?.[0]?.message || fallback,
}));
jest.mock('../src/lib/token-store', () => ({
  getSessionGeneration: jest.fn(() => mockGeneration),
  setSessionTokens: jest.fn(async (_access, _refresh, expected = mockGeneration) => expected === mockGeneration ? ++mockGeneration : null),
}));
const { useAuth } = require('../src/hooks/use-auth');
const { apiFetch } = require('../src/lib/api');
const tokens = require('../src/lib/token-store');
const bundle = { user: { id: 'customer', displayName: 'Test Customer' }, access_token: 'access',
  refresh_token: 'refresh', profile_complete: true, needs_profile_completion: false };
const response = (data, status = 200, message) => ({
  ok: status >= 200 && status < 300, status,
  headers: new Headers(), json: async () => ({ data, errors: message ? [{ message }] : null }),
});
let auth;
let renderer;
function Probe() { auth = useAuth(); return null; }
beforeEach(async () => {
  jest.clearAllMocks(); mockGeneration = 0;
  session.refresh.mockResolvedValue(true);
  await act(async () => { renderer = create(React.createElement(Probe)); });
});
afterEach(async () => { await act(async () => renderer.unmount()); });

test('rejects malformed identifiers before contacting the API', async () => {
  await act(async () => {
    await expect(auth.login('12345678901234567890', 'password')).rejects.toThrow('10 digit');
  });
  expect(apiFetch).not.toHaveBeenCalled();
});

test('uses a generic wrong-credentials message and never stores tokens on failure', async () => {
  apiFetch.mockResolvedValue(response(null, 401, 'Account not found'));
  await act(async () => {
    await expect(auth.login('person@example.com', 'password')).rejects.toThrow('Invalid phone/email or password');
  });
  expect(tokens.setSessionTokens).not.toHaveBeenCalled();
  expect(session.refresh).not.toHaveBeenCalled();
});

test('unverified email advances to verification without starting a session', async () => {
  apiFetch.mockResolvedValue(response({ needs_email_verification: true, email: 'person@example.com' }));
  await act(async () => {
    expect((await auth.login('person@example.com', 'password')).needs_email_verification).toBe(true);
  });
  expect(tokens.setSessionTokens).not.toHaveBeenCalled();
  expect(session.refresh).not.toHaveBeenCalled();
});

test('requires both tokens and a confirmed session', async () => {
  apiFetch.mockResolvedValue(response({ profile_complete: true }));
  await act(async () => {
    await expect(auth.login('person@example.com', 'password')).rejects.toThrow('no valid session');
  });
  expect(tokens.setSessionTokens).not.toHaveBeenCalled();
  apiFetch.mockResolvedValue(response(bundle));
  session.refresh.mockResolvedValue(false);
  await act(async () => {
    await expect(auth.login('person@example.com', 'password')).rejects.toThrow('session could not be established');
  });
  expect(session.clear).toHaveBeenCalledTimes(1);
});

test('normalizes login and stores native tokens before session confirmation', async () => {
  apiFetch.mockResolvedValue(response(bundle));
  await act(async () => { await auth.login('(519)-555-1234', 'legacy'); });
  expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ identifier: '+15195551234', password: 'legacy' });
  expect(tokens.setSessionTokens).toHaveBeenCalledWith('access', 'refresh', 0);
  expect(session.refresh).toHaveBeenCalledTimes(1);
});

test('prevents same-frame duplicate submissions', async () => {
  let resolve;
  apiFetch.mockReturnValue(new Promise(done => { resolve = done; }));
  let first;
  await act(async () => {
    first = auth.login('person@example.com', 'password');
    await expect(auth.login('person@example.com', 'password')).rejects.toThrow('Please wait');
  });
  expect(apiFetch).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(response(bundle)); await first; });
});

test('email verification establishes a confirmed session with the returned tokens', async () => {
  apiFetch.mockResolvedValue(response(bundle));
  await act(async () => { await auth.verifyEmail('person@example.com', '123456'); });
  expect(apiFetch.mock.calls[0][0]).toBe('/api/v1/auth/signup/verify');
  expect(tokens.setSessionTokens).toHaveBeenCalledWith('access', 'refresh', 0);
  expect(session.refresh).toHaveBeenCalled();
});

test('reset rejects weak passwords before making a request and signs in after confirmation', async () => {
  await act(async () => {
    await expect(auth.confirmPasswordReset('person@example.com', '123456', 'weak', 'weak')).rejects.toThrow('at least 8');
  });
  expect(apiFetch).not.toHaveBeenCalled();
  apiFetch.mockResolvedValue(response(bundle));
  await act(async () => {
    await auth.confirmPasswordReset('person@example.com', '123456', 'Strong123!', 'Strong123!');
  });
  expect(apiFetch.mock.calls[0][0]).toBe('/api/v1/auth/password-reset/confirm');
  expect(session.refresh).toHaveBeenCalled();
});

test('preserves rate-limit messages and retry timing', async () => {
  apiFetch.mockResolvedValue(response(null, 429, 'Please wait 45 seconds before requesting another code'));
  await act(async () => {
    await expect(auth.requestPasswordReset('person@example.com')).rejects.toMatchObject({ status: 429, retrySeconds: 45 });
  });
});
