const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockSession = { authenticated: true, refresh: jest.fn(), clear: jest.fn() };
jest.mock('react-native', () => ({ Text: 'Text', ScrollView: 'ScrollView', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'ticket' }), useRouter: () => ({ back: jest.fn() }) }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession, withSilentRefresh: call => call() }));
jest.mock('../src/lib/token-store', () => ({ getSessionGeneration: () => 1 }));
jest.mock('../src/lib/env', () => ({ DEFAULT_LOCATION_ID: 'location' }));
jest.mock('../src/lib/api', () => ({ apiFetch: jest.fn(), getApiErrorMessage: body => body.errors?.[0]?.message }));
jest.mock('../src/components/order-feedback-sheet', () => ({ feedbackStyles: {} }));
const Screen = require('../app/support/[id]').default;
const { apiFetch } = require('../src/lib/api');
let ticket, renderer;
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => ({ data, errors: [{ message: 'Please wait' }] }) });
beforeEach(() => {
  ticket = { id: 'ticket', subject: 'Cold wings', description: 'Original concern', status: 'CLOSED', messages: [{ id: 'old', message_body: 'Historical reply' }] };
  apiFetch.mockReset().mockImplementation(async path => {
    if (path.endsWith('/reopen')) { ticket = { ...ticket, status: 'OPEN' }; return response(ticket); }
    return response(ticket);
  });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => JSON.stringify(node.toJSON ? node.toJSON() : node.children.map(x => x.props.children)).includes(label));
test.each(['RESOLVED', 'CLOSED'])('native customer reopens %s, keeps history and sends details', async status => {
  ticket.status = status;
  await act(async () => { renderer = create(React.createElement(Screen)); });
  expect(JSON.stringify(renderer.toJSON())).toContain('Historical reply');
  await act(async () => renderer.root.findByType('TextInput').props.onChangeText('New information'));
  await act(async () => button('Reopen ticket').props.onPress());
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/support/tickets/ticket/reopen', expect.objectContaining({ method: 'POST', locationId: 'location' }));
  expect(renderer.root.findByType('TextInput').props.value).toBe('New information');
  await act(async () => button('Send reply').props.onPress());
  expect(apiFetch.mock.calls.find(([path]) => path.endsWith('/messages'))[1].body).toBe(JSON.stringify({ message_body: 'New information' }));
  expect(JSON.stringify(renderer.toJSON())).toContain('Historical reply');
});
test('native reopening 429 retains the draft and session', async () => {
  await act(async () => { renderer = create(React.createElement(Screen)); });
  await act(async () => renderer.root.findByType('TextInput').props.onChangeText('Keep draft'));
  apiFetch.mockImplementationOnce(async () => response(null, 429));
  await act(async () => button('Reopen ticket').props.onPress());
  expect(renderer.root.findByType('TextInput').props.value).toBe('Keep draft');
  expect(mockSession.clear).not.toHaveBeenCalled();
});
