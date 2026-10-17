const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockCart = { locationId: 'store', locationTimezone: 'America/Toronto', setLocationTimezone: jest.fn() };
let mockMenu;
let mockSession = { loaded: true, authenticated: false };
let mockAccount;
jest.mock('../src/context/session', () => ({ useSession: () => mockSession }));
jest.mock('../src/hooks/use-account-data', () => ({ useAccountData: () => mockAccount }));
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn(async () => ({ data: { delivery_fee_cents: 499, delivery_quote_token: 'token', expires_at: '2026-10-18T16:00:00Z' } })) }));
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
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); jest.clearAllMocks(); mockSession = { loaded: true, authenticated: false }; mockAccount = { data: { addresses: [] }, loading: false, refreshing: false, sectionErrors: {}, refresh: jest.fn() }; mockMenu = { menu: { location }, loading: false, error: null, refetch: jest.fn() }; });
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

test.each(['closed', 'no-slots', 'api-error'])('customers can always dismiss with the close button when ordering is %s', async condition => {
  if (condition === 'closed') jest.setSystemTime(Date.parse('2026-10-17T13:00:00Z'));
  if (condition === 'no-slots') mockMenu = { ...mockMenu, menu: { location: { ...location, pickup_hours: [], store_hours: [] } } };
  if (condition === 'api-error') mockMenu = { ...mockMenu, menu: null, error: 'Offline' };
  await mount();
  expect(primary().props.disabled).toBe(true);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Close order setup' }).props.onPress());
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

const savedAddress = (id, extra = {}) => ({ id, label: id, line1: `${id} Main St unit 4`, city: 'London', postal_code: 'N5Y 4J7', is_default: false, ...extra });
const update = async () => act(async () => renderer.update(React.createElement(OrderSetupModal,
  { initialType: 'DELIVERY', initialScheduledFor: null, initialAddress: null, onConfirm, onClose })));
const selectSaved = async label => act(async () => renderer.root.findByProps({ accessibilityLabel: `Deliver to ${label}` }).props.onPress());
const signIn = () => { mockSession = { loaded: true, authenticated: true, user: { id: 'a' } }; };

test.each([false, true])('auto-selects a sole or default saved address (multiple: %s)', async multiple => {
  signIn();
  mockAccount.data.addresses = multiple ? [savedAddress('Other'), savedAddress('Home', { is_default: true })] : [savedAddress('Home')];
  await mount({ initialType: 'DELIVERY' });
  expect(renderer.root.findAllByType('TextInput')).toHaveLength(0);
  await act(async () => primary().props.onPress());
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ savedAddressId: 'Home', deliveryAddress: expect.objectContaining({ line1: 'Home Main St unit 4' }) }));
});

test('multiple addresses without a default require a choice and changing addresses preserves valid time', async () => {
  signIn(); mockAccount.data.addresses = [savedAddress('Home'), savedAddress('Office')];
  const slot = buildOrderSlots(location, 'DELIVERY', now)[2].value;
  await mount({ initialType: 'DELIVERY', initialScheduledFor: slot });
  expect(primary().props.disabled).toBe(true);
  await selectSaved('Home');
  await act(async () => button('My Addresses').props.onPress());
  await selectSaved('Office');
  await act(async () => primary().props.onPress());
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ savedAddressId: 'Office', scheduledFor: slot }));
});

test('saved and new-address modes are exclusive, preserve the manual draft, and submit only the active address', async () => {
  signIn(); mockAccount.data.addresses = [savedAddress('Home')];
  await mount({ initialType: 'DELIVERY' });
  expect(renderer.root.findAllByProps({ accessibilityLabel: 'Delivery street address and unit' })).toHaveLength(0);
  expect(renderer.root.findByProps({ accessibilityLabel: 'Deliver to Home' }).props.accessibilityState.checked).toBe(true);
  await act(async () => button('Enter New Address').props.onPress());
  expect(renderer.root.findAllByProps({ accessibilityLabel: 'Deliver to Home' })).toHaveLength(0);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Delivery street address and unit' }).props.onChangeText('25 Other St apt 8'));
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Delivery postal code' }).props.onChangeText('n5y4j7'));
  await act(async () => button('My Addresses').props.onPress());
  expect(renderer.root.findAllByProps({ accessibilityLabel: 'Delivery street address and unit' })).toHaveLength(0);
  await act(async () => button('Enter New Address').props.onPress());
  expect(renderer.root.findByProps({ accessibilityLabel: 'Delivery street address and unit' }).props.value).toBe('25 Other St apt 8');
  expect(renderer.root.findByProps({ accessibilityLabel: 'Delivery postal code' }).props.value).toBe('n5y4j7');
  await act(async () => primary().props.onPress());
  expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ deliveryAddress: expect.objectContaining({ line1: '25 Other St apt 8' }) }));
  expect(onConfirm.mock.calls.at(-1)[0].savedAddressId).toBeUndefined();
  await act(async () => button('My Addresses').props.onPress());
  await selectSaved('Home');
  await act(async () => primary().props.onPress());
  expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ savedAddressId: 'Home', deliveryAddress: expect.objectContaining({ line1: 'Home Main St unit 4' }) }));
  expect(mockAccount.data.addresses[0].line1).toBe('Home Main St unit 4');
});

test.each(['empty', 'failed', 'loading'])('manual form remains usable when addresses are %s', async state => {
  signIn(); mockAccount.loading = state === 'loading';
  if (state === 'failed') mockAccount.sectionErrors.addresses = 'Offline';
  await mount({ initialType: 'DELIVERY' });
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Delivery street address and unit' }).props.onChangeText('Manual unit 3'));
  expect(renderer.root.findByProps({ accessibilityLabel: 'Delivery street address and unit' }).props.value).toBe('Manual unit 3');
  if (state === 'failed') {
    await act(async () => button('Retry saved addresses').props.onPress());
    expect(mockAccount.refresh).toHaveBeenCalledTimes(1);
  }
});

test('late saved-address fetch and guest login never overwrite manual edits', async () => {
  await mount({ initialType: 'DELIVERY' });
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Delivery street address and unit' }).props.onChangeText('My current apartment 9'));
  signIn(); mockAccount.data.addresses = [savedAddress('Home', { is_default: true })];
  await update();
  expect(renderer.root.findByProps({ accessibilityLabel: 'Delivery street address and unit' }).props.value).toBe('My current apartment 9');
  expect(button('My Addresses')).toBeDefined();
});

test('saved-address edits and deletions are reflected without silently choosing another address', async () => {
  signIn(); mockAccount.data.addresses = [savedAddress('Home')];
  await mount({ initialType: 'DELIVERY' });
  mockAccount.data.addresses = [savedAddress('Home', { line1: 'Updated unit 7' })]; await update();
  await act(async () => primary().props.onPress());
  expect(onConfirm.mock.calls.at(-1)[0].deliveryAddress.line1).toBe('Updated unit 7');
  mockAccount.data.addresses = [savedAddress('Office', { is_default: true })]; await update();
  expect(primary().props.disabled).toBe(true);
});

test('address changes hide stale estimates immediately and ignore old responses', async () => {
  const { apiJson } = require('../src/lib/api');
  let finishOld;
  apiJson.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  signIn(); mockAccount.data.addresses = [savedAddress('Home', { is_default: true }), savedAddress('Office')];
  await mount({ initialType: 'DELIVERY' });
  await act(async () => jest.advanceTimersByTime(350));
  await act(async () => button('My Addresses').props.onPress()); await selectSaved('Office');
  await act(async () => jest.advanceTimersByTime(350));
  await act(async () => finishOld({ data: { delivery_fee_cents: 999, delivery_quote_token: 'old', expires_at: '2026-10-18T16:00:00Z' } }));
  expect(renderer.root.findAllByType('Text').some(node => text(node).includes('$9.99'))).toBe(false);
  expect(JSON.parse(apiJson.mock.calls.at(-1)[1].body).address_snapshot_json.line1).toBe('Office Main St unit 4');
});

test('saved addresses outside delivery eligibility show server errors with retry and browsing still available', async () => {
  const { apiJson } = require('../src/lib/api');
  apiJson.mockRejectedValueOnce(new Error('This address is outside our delivery area.'));
  signIn(); mockAccount.data.addresses = [savedAddress('Home')];
  await mount({ initialType: 'DELIVERY' });
  await act(async () => jest.advanceTimersByTime(350));
  expect(renderer.root.findAllByType('Text').some(node => text(node).includes('outside our delivery area'))).toBe(true);
  expect(renderer.root.findByProps({ accessibilityLabel: 'Close order setup' })).toBeDefined();
  await act(async () => button('Retry delivery estimate').props.onPress());
  await act(async () => jest.advanceTimersByTime(350));
  expect(renderer.root.findAllByType('Text').some(node => text(node).includes('outside our delivery area'))).toBe(false);
});
