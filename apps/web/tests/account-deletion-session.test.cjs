const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockRouter = { replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter, usePathname: () => '/account/profile' }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('../src/lib/delivery-quote', () => ({ clearStoredDeliveryQuotes: jest.fn(), pruneStoredDeliveryQuotes: jest.fn() }));
const { apiFetch } = require('@/lib/api');
const { SessionProvider, useSession } = require('../src/lib/session');
const { forgetDeletedAccount } = require('../src/lib/account-deletion');
let session, renderer, pending;
function Probe() { session = useSession(); return React.createElement('span', null, session.user?.displayName ?? 'Guest'); }
const originalWindow = global.window, originalDocument = global.document;
beforeEach(() => {
  pending = []; apiFetch.mockReset();
  apiFetch.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  global.window = Object.assign(new EventTarget(), { setTimeout: jest.fn(() => 1), clearTimeout: jest.fn(),
    localStorage: { setItem: jest.fn() }, sessionStorage: { removeItem: jest.fn() }, location: { reload: jest.fn() } });
  global.document = Object.assign(new EventTarget(), { cookie: '', visibilityState: 'visible' });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; global.window = originalWindow; global.document = originalDocument; });

test('a session response started before deletion cannot restore private account data after clear', async () => {
  await act(async () => { renderer = create(React.createElement(SessionProvider, null, React.createElement(Probe))); });
  const signedIn = { ok: true, json: async () => ({ data: { authenticated: true, user: { id: 'old', displayName: 'Private Old Profile', role: 'CUSTOMER' }, profile_complete: true } }) };
  await act(async () => pending.shift()(signedIn));
  expect(session.authenticated).toBe(true);
  const oldResponses = pending.splice(0);
  await act(async () => session.clear());
  expect(session.authenticated).toBe(false);
  await act(async () => { for (const resolve of oldResponses) resolve(signedIn); });
  expect(session.authenticated).toBe(false); expect(session.user).toBeNull();
  expect(renderer.root.findByType('span').children).toEqual(['Guest']);
});
test('customer drafts and reward intent are cleared without erasing install anti-abuse data', () => {
  forgetDeletedAccount();
  const keys = window.sessionStorage.removeItem.mock.calls.map(call => call[0]);
  expect(keys).toContain('wings4u.cart-items-draft-v1'); expect(keys).toContain('wings4u.apply-wings-reward');
  expect(keys).toContain('wings4u.order-context'); expect(window.localStorage.setItem).not.toHaveBeenCalled();
});
