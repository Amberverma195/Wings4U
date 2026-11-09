const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('next/navigation', () => ({ usePathname: () => '/checkout', useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('@/lib/delivery-quote', () => ({ clearStoredDeliveryQuotes: jest.fn(), pruneStoredDeliveryQuotes: jest.fn() }));
jest.mock('@/lib/account-deletion', () => ({ forgetDeletedAccount: jest.fn() }));
const { apiFetch } = require('../src/lib/api');
const { SessionProvider, useSession } = require('../src/lib/session');
let renderer, session;
function Probe() { session = useSession(); return null; }
const mount = async () => act(async () => { renderer = create(React.createElement(SessionProvider, null, React.createElement(Probe))); });
const response = user => ({ ok: true, json: async () => ({ data: { authenticated: Boolean(user), user: user ? { id: user } : undefined } }) });
beforeEach(() => {
  apiFetch.mockReset();
  global.window = Object.assign(new EventTarget(), { setTimeout, clearTimeout, localStorage: { setItem: jest.fn() } });
  global.document = Object.assign(new EventTarget(), { cookie: '', visibilityState: 'visible' });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; delete global.window; delete global.document; });

test('an initial network failure is unresolved ownership, not confirmed guest identity', async () => {
  apiFetch.mockRejectedValue(new Error('offline')); await mount();
  expect(session.loaded).toBe(true); expect(session.resolved).toBe(false); expect(session.error).toBeTruthy();
  apiFetch.mockResolvedValue(response('customer-a')); await act(async () => session.refresh());
  expect(session.authenticated).toBe(true); expect(session.resolved).toBe(true); expect(session.error).toBeNull();
});

test('a malformed 200 response cannot confirm guest ownership and erase a private draft', async () => {
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ data: null }) }); await mount();
  expect(session.loaded).toBe(true); expect(session.resolved).toBe(false); expect(session.error).toBeTruthy();
});

test('a slow initial session remains unresolved and resolves to the authenticated owner', async () => {
  let finish; apiFetch.mockImplementation(() => new Promise(resolve => { finish = resolve; })); await mount();
  expect(session.loaded).toBe(false); expect(session.resolved).toBe(false);
  apiFetch.mockResolvedValue(response('customer-a'));
  await act(async () => finish(response('customer-a')));
  expect(session.user.id).toBe('customer-a'); expect(session.resolved).toBe(true);
});

test('logout invalidates an older pending session response', async () => {
  apiFetch.mockResolvedValue(response('customer-a')); await mount();
  let finish; apiFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending; await act(async () => { pending = session.refresh(); });
  apiFetch.mockResolvedValue(response(null)); await act(async () => session.clear());
  await act(async () => { finish(response('customer-a')); await pending; });
  expect(session.authenticated).toBe(false); expect(session.user).toBeNull(); expect(session.resolved).toBe(true);
});
