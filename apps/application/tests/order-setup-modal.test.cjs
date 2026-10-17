const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockCart = { locationId: 'store', locationTimezone: 'America/Toronto', setLocationTimezone: jest.fn() };
let mockMenu;
jest.mock('react-native', () => ({
  Modal: 'Modal', View: 'View', Text: 'Text', Pressable: 'Pressable', TextInput: 'TextInput',
  ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: value => value }, Platform: { OS: 'ios' },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 30, bottom: 20 }) }));
jest.mock('lucide-react-native', () => Object.fromEntries(['ArrowLeft', 'Bike', 'CalendarDays', 'CarFront', 'Check', 'ChevronRight', 'Clock3', 'MapPin', 'X'].map(name => [name, name])));
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/hooks/use-menu', () => ({ useMenu: () => mockMenu }));
const { OrderSetupModal } = require('../src/components/order-setup-modal');
const { buildOrderSlots } = require('../src/lib/order-setup');
const now = Date.parse('2026-10-17T16:00:00Z');
const hours = [{ day_of_week: 6, time_from: '11:00', time_to: '23:00', is_closed: false }];
const location = { timezone: 'America/Toronto', pickup_hours: hours, delivery_hours: hours, store_hours: hours,
  pickup_min_minutes: 15, delivery_min_minutes: 40, delivery_max_minutes: 60, estimated_prep_minutes: 15 };
let renderer;
const onConfirm = jest.fn(), onClose = jest.fn();
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
const button = label => renderer.root.findAllByType('Pressable').find(node => text(node) === label);
const primary = () => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityState?.disabled !== undefined && node.props.accessibilityRole === 'button');
const mount = async props => act(async () => { renderer = create(React.createElement(OrderSetupModal,
  { initialType: 'PICKUP', initialScheduledFor: null, initialAddress: null, onConfirm, onClose, ...props })); });
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); jest.clearAllMocks(); mockMenu = { menu: { location }, loading: false, error: null, refetch: jest.fn() }; });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.useRealTimers(); });

test('ASAP pickup starts with the configured fifteen-minute estimate', async () => {
  await mount();
  expect(primary().props.disabled).toBe(false);
  expect(renderer.root.findAllByType('Text').some(node => text(node) === 'Ready in about 15 minutes')).toBe(true);
  await act(async () => primary().props.onPress());
  expect(onConfirm).toHaveBeenCalledWith({ fulfillmentType: 'PICKUP', scheduledFor: null, deliveryAddress: null });
});

test('delivery requires an address and carries normalized details into the selection', async () => {
  await mount({ initialType: 'DELIVERY' });
  expect(primary().props.disabled).toBe(true);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Delivery street address and unit' }).props.onChangeText(' 12  Main St unit 2 '));
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Delivery postal code' }).props.onChangeText('n5y4j7'));
  expect(primary().props.disabled).toBe(false);
  await act(async () => primary().props.onPress());
  expect(onConfirm).toHaveBeenCalledWith({ fulfillmentType: 'DELIVERY', scheduledFor: null,
    deliveryAddress: { line1: '12 Main St unit 2', city: 'London', postal_code: 'N5Y 4J7' } });
});

test.each(['PICKUP', 'DELIVERY'])('schedule picker confirms a time without leaving the %s setup sheet', async type => {
  await mount({ initialType: type, initialAddress: { line1: '12 Main', city: 'London', postal_code: 'N5Y 4J7' } });
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Schedule a date and time' }).props.onPress());
  expect(text(primary())).toBe('Confirm time');
  const slot = buildOrderSlots(location, type, now)[2];
  await act(async () => button(slot.label).props.onPress());
  await act(async () => primary().props.onPress());
  expect(onConfirm).not.toHaveBeenCalled();
  await act(async () => primary().props.onPress());
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ fulfillmentType: type, scheduledFor: slot.value }));
});

test('backing out of the picker leaves the previous timing untouched', async () => {
  await mount();
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Schedule a date and time' }).props.onPress());
  await act(async () => renderer.root.findByType('Modal').props.onRequestClose());
  await act(async () => primary().props.onPress());
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ scheduledFor: null }));
});

test('unavailable ASAP still allows scheduling, and an in-flight request disables confirmation', async () => {
  mockMenu = { ...mockMenu, menu: { location: { ...location, delivery_available_from_minutes: 13 * 60 } } };
  // Move before opening hours to test closed-now versus future availability.
  jest.setSystemTime(Date.parse('2026-10-17T13:00:00Z'));
  await mount();
  expect(primary().props.disabled).toBe(true);
  expect(renderer.root.findByProps({ accessibilityLabel: 'Schedule a date and time' }).props.disabled).toBe(false);
  mockMenu = { ...mockMenu, loading: true };
  await act(async () => renderer.update(React.createElement(OrderSetupModal, { initialType: 'PICKUP', initialScheduledFor: null,
    initialAddress: null, onConfirm, onClose })));
  expect(primary().props.disabled).toBe(true);
});

test.each(['closed', 'no-slots', 'api-error'])('customers can always browse or dismiss when ordering is %s', async condition => {
  if (condition === 'closed') jest.setSystemTime(Date.parse('2026-10-17T13:00:00Z'));
  if (condition === 'no-slots') mockMenu = { ...mockMenu, menu: { location: { ...location, pickup_hours: [], store_hours: [] } } };
  if (condition === 'api-error') mockMenu = { ...mockMenu, menu: null, error: 'Offline' };
  await mount();
  expect(primary().props.disabled).toBe(true);
  expect(button('Browse Menu for Now').props.disabled).not.toBe(true);
  await act(async () => button('Browse Menu for Now').props.onPress());
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
  await act(async () => renderer.root.findByType('Modal').props.onRequestClose());
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('ordering API errors retain retry and the close button', async () => {
  mockMenu = { ...mockMenu, menu: null, error: 'Offline' };
  await mount();
  await act(async () => button('Try again').props.onPress());
  expect(mockMenu.refetch).toHaveBeenCalledTimes(1);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Close order setup' }).props.onPress());
  expect(onClose).toHaveBeenCalledTimes(1);
});
