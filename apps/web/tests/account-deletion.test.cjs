const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession;
jest.mock('@/lib/session', () => ({ useSession: () => mockSession, withSilentRefresh: call => call() }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('@/lib/account-deletion', () => ({ forgetDeletedAccount: jest.fn(), leaveDeletedAccount: jest.fn() }));
jest.mock('@/components/customer-auth', () => ({ CustomerAuth: 'CustomerAuth' }));
jest.mock('next/link', () => ({ __esModule: true, default: 'a' }));
jest.mock('../src/app/account/profile/profile.module.css', () => ({}));
const { apiFetch } = require('@/lib/api');
const { forgetDeletedAccount, leaveDeletedAccount } = require('@/lib/account-deletion');
const { AccountDeletionFlow } = require('../src/app/account/delete/deletion-flow');
const { AccountDeletionButton } = require('../src/app/account/account-deletion-button');
const { default: DeleteAccountPage } = require('../src/app/account/delete/page');
const ready = { enabled: true, policy_version: 'test', status: 'ready', blockers: [], available_stamps: 8 };
const proof = { authorization: 'a'.repeat(64), request_id: '11111111-1111-4111-8111-111111111111', expires_at: '2099-01-01T00:00:00Z' };
const response = (data, status = 200, message = 'Verification failed') => ({ ok: status < 400, status, json: async () => ({ data, errors: status >= 400 ? [{ message }] : [] }) });
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children ? node.children.map(text).join('') : '';
let renderer;
const button = label => renderer.root.findAllByType('button').find(node => text(node) === label);
const click = async label => act(async () => button(label).props.onClick());
const submit = async () => act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
const input = type => renderer.root.findAllByType('input').find(node => (node.props.type ?? 'text') === type);
const type = async (kind, value) => act(async () => input(kind).props.onChange({ target: { value } }));
const deleteCalls = () => apiFetch.mock.calls.filter(call => call[1]?.method === 'DELETE');
const verify = async () => { await click('Continue to verification'); await type('password', 'Fictional123!'); await submit(); };
const consent = async () => act(async () => input('checkbox').props.onChange({ target: { checked: true } }));
const mount = async Component => act(async () => { renderer = create(React.createElement(Component ?? AccountDeletionFlow)); });
beforeEach(async () => {
  jest.clearAllMocks();
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer', role: 'CUSTOMER' }, clear: jest.fn() };
  apiFetch.mockImplementation(async (path, init) => path.endsWith('/verify') ? response(proof) :
    init?.method === 'DELETE' ? response({ status: 'completed', request_id: proof.request_id, blockers: [] }) : response(ready));
  await mount();
});
afterEach(async () => act(async () => renderer.unmount()));

test('Profile entry points navigate to the dedicated deletion page; opening/reviewing never deletes', async () => {
  await act(async () => renderer.update(React.createElement(AccountDeletionButton)));
  expect(renderer.root.findByType('a').props.href).toBe('/account/delete');
  expect(text(renderer.toJSON())).toContain('Delete Account'); expect(deleteCalls()).toHaveLength(0);
});
test('public explanation and sign-in path are accessible without authentication', async () => {
  mockSession = { ...mockSession, authenticated: false, user: null };
  await act(async () => renderer.update(React.createElement(DeleteAccountPage)));
  expect(text(renderer.toJSON())).toContain('Certain transaction, payment, tax, refund, and security records');
  expect(text(renderer.toJSON())).toContain('wallet balances');
  await click('Sign in to delete account'); expect(renderer.root.findAllByType('CustomerAuth')).toHaveLength(1);
  expect(deleteCalls()).toHaveLength(0);
});
test('verification, separate deliberate confirmation and rewards consent are all required; cancel never deletes', async () => {
  await click('Continue to verification'); await type('password', 'Fictional123!');
  await click('Keep My Account'); expect(deleteCalls()).toHaveLength(0);
  await verify(); expect(text(renderer.toJSON())).toContain('Final confirmation');
  expect(deleteCalls()).toHaveLength(0); expect(button('Delete My Account').props.disabled).toBe(true);
  await type('text', 'DELETE'); await submit(); expect(deleteCalls()).toHaveLength(0);
  await consent(); await click('Keep My Account'); expect(deleteCalls()).toHaveLength(0);
});
test('successful deletion clears account state and leaves through a fresh document navigation', async () => {
  await verify(); await type('text', 'DELETE'); await consent(); await submit();
  expect(deleteCalls()).toHaveLength(1);
  expect(JSON.parse(deleteCalls()[0][1].body)).toEqual({ authorization: proof.authorization, request_id: proof.request_id, confirmation: 'DELETE', forfeit_rewards: true });
  expect(forgetDeletedAccount).toHaveBeenCalledTimes(1); expect(mockSession.clear).toHaveBeenCalledTimes(1); expect(leaveDeletedAccount).toHaveBeenCalledTimes(1);
  expect(text(renderer.toJSON())).toContain('Your account has been deleted.');
});
test('password errors never advance to destructive confirmation', async () => {
  apiFetch.mockImplementationOnce(async () => response(null, 401, 'Password verification failed'));
  await click('Continue to verification'); await type('password', 'wrong'); await submit();
  expect(text(renderer.toJSON())).toContain('Password verification failed'); expect(button('Delete My Account')).toBeUndefined();
  expect(input('password').props.value).toBe(''); expect(deleteCalls()).toHaveLength(0);
});
test('expired authorization requires verification again without deleting', async () => {
  apiFetch.mockImplementationOnce(async () => response({ ...proof, expires_at: '2000-01-01T00:00:00Z' }));
  await verify(); await type('text', 'DELETE'); await consent(); await submit();
  expect(text(renderer.toJSON())).toContain('Verification expired'); expect(deleteCalls()).toHaveLength(0);
});
test('reopening deletion refreshes backend eligibility after an unpaid order closes', async () => {
  await act(async () => renderer.unmount());
  apiFetch.mockImplementationOnce(async () => response({ ...ready, status: 'resolution_required', blockers: [{ code: 'ACTIVE_ORDERS', message: 'An order is active.' }] }));
  await mount();
  expect(button('Continue to verification').props.disabled).toBe(true);
  await act(async () => renderer.unmount());
  await mount();
  expect(button('Continue to verification').props.disabled).toBe(false);
  expect(apiFetch.mock.calls.filter(([path]) => path === '/api/v1/auth/account-deletion')).toHaveLength(3);
  expect(apiFetch).toHaveBeenLastCalledWith('/api/v1/auth/account-deletion', { cache: 'no-store' });
});

test('new obligations at confirmation show actual resolution requirements and preserve authentication', async () => {
  await verify(); await type('text', 'DELETE'); await consent();
  apiFetch.mockImplementationOnce(async () => response({ status: 'resolution_required', request_id: proof.request_id, blockers: [{ code: 'WALLET_BALANCE', message: 'Your wallet balance must be resolved.' }] }));
  await submit(); expect(text(renderer.toJSON())).toContain('Your wallet balance must be resolved.');
  expect(text(renderer.toJSON())).toContain('Deletion has not completed'); expect(mockSession.clear).not.toHaveBeenCalled();
  expect(button('Continue to verification').props.disabled).toBe(true);
});
test.each(['pending', undefined])('an unconfirmed %s response never claims success or clears the session', async status => {
  await verify(); await type('text', 'DELETE'); await consent();
  apiFetch.mockImplementationOnce(async () => response({ status })); await submit();
  expect(mockSession.clear).not.toHaveBeenCalled(); expect(text(renderer.toJSON())).toContain('Deletion has not been confirmed');
});
test('activation unavailable and initial failures are honest and retryable', async () => {
  apiFetch.mockImplementationOnce(async () => response({ ...ready, enabled: false, status: 'unavailable' }));
  await act(async () => renderer.unmount()); await mount();
  expect(text(renderer.toJSON())).toContain('not available yet'); expect(button('Continue to verification')).toBeUndefined();
  apiFetch.mockImplementationOnce(async () => { throw new Error('Offline'); });
  await act(async () => renderer.unmount()); await mount();
  expect(button('Try again')).toBeDefined(); await click('Try again'); expect(button('Continue to verification')).toBeDefined();
});
test('an account switch during password verification discards the old proof', async () => {
  let release; apiFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await click('Continue to verification'); await type('password', 'Fictional123!');
  let pending; await act(async () => { pending = renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  mockSession = { ...mockSession, user: { id: 'another-customer', role: 'CUSTOMER' } };
  await act(async () => renderer.update(React.createElement(AccountDeletionFlow)));
  await act(async () => { release(response(proof)); await pending; });
  expect(button('Delete My Account')).toBeUndefined(); expect(deleteCalls()).toHaveLength(0);
});
test('double submits cannot overlap a deletion request', async () => {
  await verify(); await type('text', 'DELETE'); await consent();
  let release; apiFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const handler = renderer.root.findByType('form').props.onSubmit; let pending;
  await act(async () => { pending = handler({ preventDefault() {} }); void handler({ preventDefault() {} }); });
  expect(deleteCalls()).toHaveLength(1); expect(button('Deleting…').props.disabled).toBe(true);
  await act(async () => { release(response({ status: 'completed', blockers: [] })); await pending; });
});
test('a lost deletion response is confirmed by receipt without repeating the destructive request', async () => {
  await verify(); await type('text', 'DELETE'); await consent();
  apiFetch.mockRejectedValueOnce(new Error('Connection lost after commit'))
    .mockResolvedValueOnce(response({ status: 'completed', request_id: proof.request_id }));
  await submit(); expect(deleteCalls()).toHaveLength(1);
  expect(apiFetch.mock.calls.at(-1)[0]).toBe('/api/v1/auth/account-deletion/receipt');
  expect(mockSession.clear).toHaveBeenCalledTimes(1); expect(leaveDeletedAccount).toHaveBeenCalledTimes(1);
});
