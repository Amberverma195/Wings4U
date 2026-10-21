const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' }, StyleSheet: { create: value => value },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('lucide-react-native', () => ({ X: 'X' }));
const { Platform } = require('react-native');
const { OrderChatModal } = require('../src/components/order-chat-modal');
const order = { id: 'order', order_number: 1061, status: 'PLACED' };
const chat = () => ({ messages: [], loading: false, sending: false, isClosed: false, retryAt: null, error: null, sendMessage: jest.fn(async () => {}), refetch: jest.fn() });
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => node.props.accessibilityLabel === label);
const texts = () => renderer.root.findAllByType('Text').map(node => node.children.join(''));
const mount = async (props = {}, options = {}) => act(async () => { renderer = create(React.createElement(OrderChatModal, { order, chat: chat(), onClose: jest.fn(), ...props }), options); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test.each([['ios', 'padding'], ['android', 'height']])('%s keyboard avoidance and native dismissal', async (os, behavior) => {
  Platform.OS = os; const onClose = jest.fn(); await mount({ onClose });
  expect(renderer.root.findByType('KeyboardAvoidingView').props.behavior).toBe(behavior);
  await act(async () => renderer.root.findByType('Modal').props.onRequestClose());
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => button('Close chat').props.onPress()); expect(onClose).toHaveBeenCalledTimes(2);
  expect(renderer.root.findByType('ScrollView').props.keyboardShouldPersistTaps).toBe('handled');
});

test('scrolls to the newest message on layout and content changes', async () => {
  const scrollToEnd = jest.fn();
  await mount({}, { createNodeMock: node => node.type === 'ScrollView' ? { scrollToEnd } : null });
  const scroll = renderer.root.findByType('ScrollView');
  await act(async () => { scroll.props.onLayout(); scroll.props.onContentSizeChange(); });
  expect(scrollToEnd).toHaveBeenCalledTimes(2); expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
});

test('loading, empty, sending, rate-limited, and failed sends retain safe input behavior', async () => {
  const value = chat(); value.loading = true; await mount({ chat: value });
  expect(renderer.root.findAllByType('ActivityIndicator')).toHaveLength(1);
  expect(button('Send')).toBeUndefined();
  value.loading = false; await act(async () => renderer.update(React.createElement(OrderChatModal, { order, chat: value, onClose: jest.fn() })));
  expect(texts()).toContain('No messages yet. Start a conversation.');
  await act(async () => renderer.root.findByType('TextInput').props.onChangeText('Hello'));
  value.sendMessage.mockRejectedValueOnce(new Error('Kitchen chat unavailable'));
  await act(async () => button('Send').props.onPress());
  expect(texts()).toContain('Kitchen chat unavailable'); expect(renderer.root.findByType('TextInput').props.value).toBe('Hello');
  value.sending = true; await act(async () => renderer.update(React.createElement(OrderChatModal, { order, chat: value, onClose: jest.fn() })));
  expect(button('Send').props.disabled).toBe(true); expect(renderer.root.findByType('TextInput').props.editable).toBe(false);
  value.sending = false; value.retryAt = Date.now() + 10_000;
  await act(async () => renderer.update(React.createElement(OrderChatModal, { order, chat: value, onClose: jest.fn() })));
  expect(button('Send').props.disabled).toBe(true); expect(renderer.root.findByType('TextInput').props.editable).toBe(false);
});

test('customer, staff and system messages have distinct authors and bubbles', async () => {
  const value = chat(); value.messages = [
    { id: 'customer', sender_surface: 'CUSTOMER', message_body: 'Hello', created_at: '2026-10-20T15:00:00Z' },
    { id: 'staff', sender_surface: 'KDS', message_body: 'Hi', created_at: '2026-10-20T15:01:00Z' },
    { id: 'system', sender_surface: 'CUSTOMER', is_system_message: true, message_body: 'Order update', created_at: '2026-10-20T15:02:00Z' },
  ];
  await mount({ chat: value }); expect(texts()).toEqual(expect.arrayContaining(['You', 'Staff', 'Order update']));
  const bubble = body => renderer.root.findAllByType('Text').find(node => node.children.join('') === body).parent;
  expect(bubble('Hello').props.style[1]).toMatchObject({ alignSelf: 'flex-end' });
  expect(bubble('Hi').props.style[1]).toBe(false);
});

test('website quick-message selection toggles, disables other choices, clears, and restores a typed draft', async () => {
  const value = chat(); await mount({ chat: value });
  await act(async () => renderer.root.findByType('TextInput').props.onChangeText('My typed draft'));
  await act(async () => button('Where is my order?').props.onPress());
  expect(renderer.root.findByType('TextInput').props.value).toBe('Where is my order?');
  expect(button('I want to cancel my order').props.disabled).toBe(true);
  await act(async () => button('Where is my order?').props.onPress());
  expect(renderer.root.findByType('TextInput').props.value).toBe('My typed draft');
  await act(async () => button('Where is my order?').props.onPress());
  await act(async () => button('Clear selection').props.onPress());
  expect(renderer.root.findByType('TextInput').props.value).toBe('My typed draft');
  await act(async () => button('Where is my order?').props.onPress());
  await act(async () => renderer.root.findByType('TextInput').props.onChangeText('Edited message'));
  expect(button('Clear selection')).toBeUndefined();
  await act(async () => button('Send').props.onPress()); expect(value.sendMessage).toHaveBeenCalledWith('Edited message');
});

test('closed header, driver sender and relative timestamps match the website without a composer', async () => {
  const value = chat(); value.isClosed = true; value.messages = [{ id: 'driver', sender_surface: 'DRIVER', message_body: 'At your door', created_at: new Date(Date.now() - 120_000).toISOString() }];
  await mount({ chat: value, title: 'Driver chat' });
  expect(texts()).toEqual(expect.arrayContaining(['Driver chat (closed)', 'Driver', '2m ago']));
  expect(button('Send')).toBeUndefined(); expect(renderer.root.findAllByType('TextInput')).toHaveLength(0); expect(button('Close')).toBeDefined();
});
