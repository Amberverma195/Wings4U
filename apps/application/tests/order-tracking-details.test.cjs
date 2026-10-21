const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let renderer, mockPin;
const mockOpenURL = jest.fn(async () => {});
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator',
  Linking: { openURL: (...args) => mockOpenURL(...args) }, StyleSheet: { create: value => value },
}));
jest.mock('../src/hooks/use-delivery-pin', () => ({ useDeliveryPin: () => mockPin }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('lucide-react-native', () => ({ X: 'X' }));
jest.mock('../src/components/order-chat-modal', () => ({ OrderChatModal: props => React.createElement('ChatModal', props) }));
const { OrderTrackingDetails } = require('../src/components/order-tracking-details');
const { deliveryAddress, deliveryPreference, driverPhoneLabel, showDeliveryDetails, sortedStatusHistory, statusEventCopy } = require('../src/lib/order-tracking');
const order = overrides => ({ id: 'order', status: 'PLACED', fulfillment_type: 'PICKUP', placed_at: '2026-10-20T15:00:00Z',
  estimated_ready_at: '2026-10-20T15:20:00Z', estimated_window_min_minutes: 15, estimated_window_max_minutes: 25,
  address_snapshot_json: { line1: '1 Main St', line2: 'Unit 2', city: 'London', province: 'ON', postalCode: 'N6A 1A1' },
  contactless_pref: 'LEAVE_AT_DOOR', ...overrides });
const driver = { user_id: 'driver', full_name: 'Alex Driver', phone: '+1 (519) 555-4321', vehicle_type: 'Car', vehicle_identifier: 'ABC 123' };
const mount = async value => act(async () => { renderer = create(React.createElement(OrderTrackingDetails, { order: value, chat: {} })); });
const texts = () => renderer.root.findAllByType('Text').map(node => node.children.join(''));
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => node.props.accessibilityLabel === label);
beforeEach(() => { mockPin = null; jest.clearAllMocks(); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('pickup metadata and the website ready-time estimate/window are rendered', async () => {
  const value = order(); await mount(value);
  expect(texts()).toContain('Pickup'); expect(texts()).toContain(new Date(value.placed_at).toLocaleString());
  expect(texts().join(' ')).toContain('Estimated ready ~'); expect(texts().join(' ')).toContain('(15–25 min)');
  expect(texts()).not.toContain('Delivery details');
});

test.each(['PICKED_UP', 'DELIVERED', 'CANCELLED', 'NO_SHOW_PICKUP', 'NO_SHOW_DELIVERY', 'NO_PIN_DELIVERY'])(
  '%s hides active ready/arrival estimates and driver actions', async status => {
    await mount(order({ status, fulfillment_type: 'DELIVERY', delivery_started_at: '2026-10-20T15:01:00Z', assigned_driver: driver, estimated_arrival_at: '2026-10-20T15:30:00Z' }));
    expect(texts().join(' ')).not.toContain('Estimated ready ~'); expect(texts().join(' ')).not.toContain('ETA ');
    expect(button('Chat with driver')).toBeUndefined(); expect(button('Call driver')).toBeUndefined();
    expect(texts()).toContain('Alex Driver'); expect(texts()).toContain('Delivery details');
    if (status === 'CANCELLED') expect(texts()).toContain('Order cancelled by Staff.');
  });

test('out-for-delivery shows PIN, arrival, driver, vehicle, address and preference, with native contact actions', async () => {
  mockPin = '1234'; const value = order({ status: 'OUT_FOR_DELIVERY', fulfillment_type: 'DELIVERY', assigned_driver: driver, estimated_arrival_at: '2026-10-20T15:30:00Z' });
  await mount(value);
  expect(texts()).toEqual(expect.arrayContaining(['Delivery PIN', '1234', 'Share this PIN with your driver at handoff.',
    'Driver is on the way', 'Alex Driver', '+1 (519) 555-4321', 'Car · ABC 123', '1 Main St, Unit 2, London, ON, N6A 1A1', 'Leave at door']));
  await act(async () => button('Call driver').props.onPress()); expect(mockOpenURL).toHaveBeenCalledWith('tel:+15195554321');
  await act(async () => button('Chat with driver').props.onPress());
  expect(renderer.root.findByType('ChatModal').props.title).toBe('Driver chat');
  await act(async () => renderer.root.findByType('ChatModal').props.onClose()); expect(renderer.root.findAllByType('ChatModal')).toHaveLength(0);
});

test('no assigned driver and incomplete profile fields use the same website fallbacks', async () => {
  await mount(order({ status: 'OUT_FOR_DELIVERY', fulfillment_type: 'DELIVERY' }));
  expect(texts()).toContain('We will show your driver here once the store assigns one.'); expect(button('Chat with driver')).toBeUndefined();
  await act(async () => renderer.update(React.createElement(OrderTrackingDetails, { order: order({ status: 'OUT_FOR_DELIVERY', fulfillment_type: 'DELIVERY', assigned_driver: { ...driver, phone: null, vehicle_type: null, vehicle_identifier: null } }), chat: {} })));
  expect(texts()).toContain('Phone not available'); expect(texts()).toContain('Not added'); expect(button('Call driver')).toBeUndefined();
});

test('delivery details appear only after delivery started or website delivery statuses, and only with available details', () => {
  expect(showDeliveryDetails(order({ fulfillment_type: 'DELIVERY', assigned_driver: driver }))).toBe(false);
  expect(showDeliveryDetails(order({ fulfillment_type: 'DELIVERY', delivery_started_at: '2026-10-20' }))).toBe(true);
  expect(showDeliveryDetails(order({ fulfillment_type: 'DELIVERY', status: 'OUT_FOR_DELIVERY', address_snapshot_json: null, contactless_pref: null }))).toBe(false);
});

test('address aliases, phone formatting and all website delivery preferences match', () => {
  expect(deliveryAddress({ line1: '1 Main', postal_code: 'A1A 1A1' })).toBe('1 Main, A1A 1A1');
  expect(deliveryAddress(null)).toBeNull(); expect(driverPhoneLabel('5195554321')).toBe('(519) 555-4321');
  expect(driverPhoneLabel(null)).toBeNull();
  expect(['HAND_TO_ME', 'LEAVE_AT_DOOR', 'CALL_ON_ARRIVAL', 'TEXT_ON_ARRIVAL', 'unknown'].map(deliveryPreference))
    .toEqual(['Hand it to me', 'Leave at door', 'Call on arrival', 'Text on arrival', null]);
});

test('history uses actual events only, keeps descending order and includes website item-added details/reasons', () => {
  const added = { id: 'added', to_status: 'PREPARING', event_type: 'CHANGE_REQUEST_APPROVED', reason_text: 'Add-items request abc approved (+450 cents)', created_at: '2026-10-20T15:02:00Z' };
  const placed = { id: 'placed', to_status: 'PLACED', reason_text: 'Order submitted', created_at: '2026-10-20T15:00:00Z' };
  const value = order({ status_events: [placed, added] });
  expect(sortedStatusHistory(value).map(event => event.id)).toEqual(['added', 'placed']); expect(value.status_events[0]).toBe(placed);
  expect(statusEventCopy(added, value)).toEqual({ title: 'Item added', detail: 'Additional item - $4.50' });
  expect(statusEventCopy(placed, value)).toEqual({ title: 'Order placed', detail: 'Order submitted' });
  expect(sortedStatusHistory(order({ status_events: [] }))).toEqual([]);
});
