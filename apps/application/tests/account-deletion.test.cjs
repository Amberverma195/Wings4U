const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession;
jest.mock('react-native', () => ({ Modal: 'Modal', ScrollView: 'ScrollView', View: 'View', Text: 'Text',
  TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: value => value } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession, withSilentRefresh: call => call() }));
jest.mock('../src/lib/api', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('../src/lib/api');
const { AccountDeletionModal } = require('../src/components/account-deletion');
const ready = { enabled: true, status: 'ready', blockers: [], available_stamps: 8, policy_version: 'test' };
const proof = { authorization: 'a'.repeat(64), expires_at: '2099-01-01T00:00:00Z', request_id: '11111111-1111-4111-8111-111111111111' };
const response = (data, status = 200, message = 'Verification failed') => ({ ok: status < 400, status, json: async () => ({ data, errors: status >= 400 ? [{ message }] : [] }) });
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children ? node.children.map(text).join('') : '';
let renderer, onClose, onCompleted;
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => text(node) === label);
const tap = async label => act(async () => button(label).props.onPress());
const type = async (label, value) => act(async () => renderer.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === label).props.onChangeText(value));
const deletes = () => apiFetch.mock.calls.filter(call => call[1]?.method === 'DELETE');
const props = () => ({ visible: true, onClose, onCompleted });
const mount = async () => act(async () => { renderer = create(React.createElement(AccountDeletionModal, props())); });
const verify = async () => { await tap('Continue to verification'); await type('Current password', 'Fictional123!'); await tap('Verify password'); };
const consent = async () => act(async () => renderer.root.findAllByType('TouchableOpacity').find(node => node.props.accessibilityRole === 'checkbox').props.onPress());
beforeEach(async () => {
  jest.clearAllMocks(); mockSession = { authenticated: true, user: { id: 'customer', role: 'CUSTOMER' } };
  onClose = jest.fn(); onCompleted = jest.fn(async () => {});
  apiFetch.mockImplementation(async (path, init) => path.endsWith('/verify') ? response(proof) :
    init?.method === 'DELETE' ? response({ status: 'completed', request_id: proof.request_id, blockers: [] }) : response(ready));
  await mount();
});
afterEach(async () => act(async () => renderer.unmount()));

test('reopening refreshes backend eligibility after an unpaid order closes', async () => {
  await act(async () => renderer.update(React.createElement(AccountDeletionModal, { ...props(), visible: false })));
  apiFetch.mockImplementationOnce(async () => response({ ...ready, status: 'resolution_required', blockers: [{ code: 'ACTIVE_ORDERS', message: 'An order is active.' }] }));
  await act(async () => renderer.update(React.createElement(AccountDeletionModal, props())));
  expect(button('Continue to verification').props.disabled).toBe(true);
  await act(async () => renderer.update(React.createElement(AccountDeletionModal, { ...props(), visible: false })));
  await act(async () => renderer.update(React.createElement(AccountDeletionModal, props())));
  expect(button('Continue to verification').props.disabled).toBe(false);
  expect(apiFetch.mock.calls.filter(([path]) => path === '/api/v1/auth/account-deletion')).toHaveLength(3);
});

test('opening and dismissing the modal never sends a destructive request', async () => {
  expect(deletes()).toHaveLength(0); expect(text(renderer.toJSON())).toContain('Deleting your account is permanent');
  await tap('Keep My Account'); expect(onClose).toHaveBeenCalledTimes(1); expect(deletes()).toHaveLength(0);
  await act(async () => renderer.root.findByType('Modal').props.onRequestClose()); expect(deletes()).toHaveLength(0);
});
test('password verification is separate from final confirmation and cancellation never deletes', async () => {
  await verify(); expect(button('Delete My Account').props.disabled).toBe(true); expect(deletes()).toHaveLength(0);
  await tap('Keep My Account'); expect(onClose).toHaveBeenCalledTimes(1); expect(onCompleted).not.toHaveBeenCalled();
  expect(deletes()).toHaveLength(0);
});
test('requires explicit DELETE text and rewards consent, then calls the shared workflow exactly once', async () => {
  await verify(); await type('Type DELETE to confirm', 'DELETE');
  await tap('Delete My Account'); expect(deletes()).toHaveLength(0);
  await consent(); await tap('Delete My Account');
  expect(deletes()).toHaveLength(1); expect(JSON.parse(deletes()[0][1].body)).toEqual({
    authorization: proof.authorization, request_id: proof.request_id, confirmation: 'DELETE', forfeit_rewards: true,
  });
  expect(onCompleted).toHaveBeenCalledTimes(1);
});
test('wrong passwords and expired authorizations never delete', async () => {
  apiFetch.mockImplementationOnce(async () => response(null, 401, 'Password verification failed'));
  await verify(); expect(text(renderer.toJSON())).toContain('Password verification failed'); expect(button('Delete My Account')).toBeUndefined();
  apiFetch.mockImplementationOnce(async () => response({ ...proof, expires_at: '2000-01-01T00:00:00Z' }));
  await type('Current password', 'Fictional123!'); await tap('Verify password');
  await type('Type DELETE to confirm', 'DELETE'); await consent(); await tap('Delete My Account');
  expect(text(renderer.toJSON())).toContain('Verification expired'); expect(deletes()).toHaveLength(0);
});
test('new pending refunds/obligations show the server reason without claiming deletion', async () => {
  await verify(); await type('Type DELETE to confirm', 'DELETE'); await consent();
  apiFetch.mockImplementationOnce(async () => response({ status: 'resolution_required', blockers: [{ code: 'PENDING_REFUNDS', message: 'Your refund is still pending.' }] }));
  await tap('Delete My Account'); expect(text(renderer.toJSON())).toContain('Your refund is still pending.');
  expect(text(renderer.toJSON())).toContain('Deletion has not completed'); expect(onCompleted).not.toHaveBeenCalled();
});
test.each(['pending', undefined])('unconfirmed %s results never claim success or clear authentication', async status => {
  await verify(); await type('Type DELETE to confirm', 'DELETE'); await consent();
  apiFetch.mockImplementationOnce(async () => response({ status })); await tap('Delete My Account');
  expect(text(renderer.toJSON())).toContain('Deletion has not been confirmed'); expect(onCompleted).not.toHaveBeenCalled();
});
test('unavailable activation is disclosed and no verification can start', async () => {
  apiFetch.mockImplementationOnce(async () => response({ ...ready, enabled: false, status: 'unavailable' }));
  await act(async () => renderer.unmount()); await mount();
  expect(text(renderer.toJSON())).toContain('not available yet'); expect(button('Continue to verification')).toBeUndefined();
});
test('a late verification response after account switching is discarded', async () => {
  let release; apiFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await tap('Continue to verification'); await type('Current password', 'Fictional123!');
  await act(async () => button('Verify password').props.onPress());
  mockSession = { ...mockSession, user: { id: 'another', role: 'CUSTOMER' } };
  await act(async () => renderer.update(React.createElement(AccountDeletionModal, props())));
  await act(async () => release(response(proof)));
  expect(button('Delete My Account')).toBeUndefined(); expect(deletes()).toHaveLength(0);
});
test('duplicate taps cannot overlap deletion; hardware back cannot dismiss an already submitted operation', async () => {
  await verify(); await type('Type DELETE to confirm', 'DELETE'); await consent();
  let release; apiFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const handler = button('Delete My Account').props.onPress;
  await act(async () => { handler(); handler(); }); expect(deletes()).toHaveLength(1);
  await act(async () => renderer.root.findByType('Modal').props.onRequestClose()); expect(onClose).not.toHaveBeenCalled();
  await act(async () => release(response({ status: 'completed', blockers: [] })));
  expect(onCompleted).toHaveBeenCalledTimes(1);
});
test('a lost deletion response is confirmed by receipt without repeating deletion', async () => {
  await verify(); await type('Type DELETE to confirm', 'DELETE'); await consent();
  apiFetch.mockRejectedValueOnce(new Error('Connection lost after commit'))
    .mockResolvedValueOnce(response({ status: 'completed', request_id: proof.request_id }));
  await tap('Delete My Account'); expect(deletes()).toHaveLength(1);
  expect(apiFetch.mock.calls.at(-1)[0]).toBe('/api/v1/auth/account-deletion/receipt');
  expect(onCompleted).toHaveBeenCalledTimes(1);
});
