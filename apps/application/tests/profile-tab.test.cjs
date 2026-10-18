const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, mockParams, mockFocused, mockAccount;
const mockRouter = { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn(), push: jest.fn() };
const mockNavigation = { reset: jest.fn() };
const mockAuth = { logout: jest.fn(), clearError: jest.fn(), updateProfile: jest.fn(), requestPhoneChange: jest.fn(), verifyPhoneChange: jest.fn(), loading: false, error: null };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useNavigation: () => mockNavigation,
  useLocalSearchParams: () => mockParams, useIsFocused: () => mockFocused }));
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Alert: { alert: jest.fn() }, Modal: 'Modal',
  RefreshControl: 'RefreshControl', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity', View: 'View', StyleSheet: { create: value => value, absoluteFill: {} },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Defs: 'Defs', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('lucide-react-native', () => Object.fromEntries(['Check', 'CheckCircle2', 'Copy', 'CreditCard', 'Home', 'LifeBuoy', 'LogOut', 'Mail', 'MapPin', 'Pencil', 'Phone', 'Plus', 'Save', 'Ticket', 'Trash2', 'User', 'X'].map(name => [name, name])));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession }));
jest.mock('../src/context/cart', () => ({ useCart: () => ({ items: [], locationId: 'store', fulfillmentType: 'PICKUP', scheduledFor: null, isCartHydrated: true }) }));
jest.mock('../src/lib/api', () => ({ apiFetch: jest.fn(), getApiErrorMessage: () => 'Unable to reorder' }));
jest.mock('../src/hooks/use-auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/hooks/use-account-data', () => ({ useAccountData: () => mockAccount }));
jest.mock('../src/components/auth-sheet', () => ({ AuthSheet: 'AuthSheet' }));

const ProfileTab = require('../app/(tabs)/profile').default;
const user = { id: 'customer', displayName: 'Wing Fan', email: 'wings@example.com', phone: '+15195550123' };
let renderer;
const strings = () => renderer.root.findAllByType('Text').map(node => node.children.filter(child => typeof child === 'string').join(''));
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => node.findAllByType('Text').some(text => text.children.join('') === label));
const selected = label => Boolean(button(label).props.style[1]);
const tap = async label => act(async () => { await button(label).props.onPress(); });
const rerender = async () => act(async () => renderer.update(React.createElement(ProfileTab)));
const sheet = () => renderer.root.findByType('AuthSheet');

beforeEach(async () => {
  jest.clearAllMocks(); mockFocused = true; mockParams = {};
  mockSession = { loaded: true, authenticated: true, user, needsProfileCompletion: false };
  mockAccount = { loading: false, refreshing: false, error: null, refresh: jest.fn(), sectionErrors: {}, loadingMoreOrders: false, loadMoreOrders: jest.fn(), data: {
    orders: [], ordersNextCursor: null, promos: [], wingsLedger: [], wingsRewards: null, addresses: [], tickets: [],
  } };
  mockRouter.canGoBack.mockReturnValue(false);
  mockRouter.replace.mockImplementation(() => { mockFocused = false; });
  mockRouter.back.mockImplementation(() => { mockFocused = false; });
  mockNavigation.reset.mockImplementation(() => { mockFocused = false; });
  mockAuth.logout.mockImplementation(async () => { mockSession = { ...mockSession, authenticated: false, user: null }; });
  await act(async () => { renderer = create(React.createElement(ProfileTab)); });
});
afterEach(async () => { await act(async () => renderer.unmount()); });

test('Overview, Orders, Addresses, Support, Rewards and Coupons remain accessible inside Profile', async () => {
  expect(selected('Overview')).toBe(true);
  expect(strings()).toContain('Rewards hub');
  await tap('Coupons'); expect(strings()).toContain('Available coupons');
  for (const tab of ['Orders', 'Addresses', 'Support', 'Profile', 'Overview']) {
    await tap(tab); expect(selected(tab)).toBe(true);
  }
  expect(button('Sign Out')).toBeDefined();
});

test.each(['overview', 'profile', 'orders', 'addresses', 'support'])('section deep link opens %s without redirecting or stripping any parameters', async section => {
  mockParams = { section, entry: 'link-1', source: 'notification' }; await rerender();
  expect(selected(section[0].toUpperCase() + section.slice(1))).toBe(true);
  expect(mockParams).toEqual({ section, entry: 'link-1', source: 'notification' });
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('repeated section entries reselect the section without remounting the tab or losing params', async () => {
  mockParams = { section: ['orders'], entry: ['first'], source: 'notification' }; await rerender();
  expect(selected('Orders')).toBe(true);
  await tap('Addresses'); await rerender();
  expect(selected('Addresses')).toBe(true);
  mockParams = { ...mockParams, entry: ['second'] }; await rerender();
  expect(selected('Orders')).toBe(true);
  expect(mockParams.source).toBe('notification');
});

test('guest deep link waits for session loading, then authenticates in place and keeps the requested section', async () => {
  await act(async () => renderer.unmount());
  mockParams = { section: 'orders', entry: 'deep-link' };
  mockSession = { loaded: false, authenticated: false, user: null, needsProfileCompletion: false };
  await act(async () => { renderer = create(React.createElement(ProfileTab)); });
  expect(sheet().props.visible).toBe(false);
  mockSession = { ...mockSession, loaded: true }; await rerender();
  expect(sheet().props.visible).toBe(true);
  expect(strings()).not.toContain('Wing Fan');
  await act(async () => { sheet().props.onComplete(); sheet().props.onClose(); });
  mockSession = { loaded: true, authenticated: true, user, needsProfileCompletion: false }; await rerender();
  expect(selected('Orders')).toBe(true);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test.each([false, true])('cancelling guest deep-link authentication leaves Profile safely (history: %s)', async hasHistory => {
  await act(async () => renderer.unmount());
  mockRouter.canGoBack.mockReturnValue(hasHistory);
  mockSession = { loaded: true, authenticated: false, user: null, needsProfileCompletion: false };
  await act(async () => { renderer = create(React.createElement(ProfileTab)); });
  expect(sheet().props.visible).toBe(true);
  await act(async () => sheet().props.onClose());
  expect(hasHistory ? mockRouter.back : mockNavigation.reset).toHaveBeenCalledTimes(1);
  if (!hasHistory) expect(mockNavigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'index' }] });
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('sign-out clears tab history, hides account data and does not reopen authentication', async () => {
  await tap('Sign Out'); await rerender();
  expect(mockAuth.logout).toHaveBeenCalledTimes(1);
  expect(mockNavigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'index' }] });
  expect(strings()).not.toContain('Wing Fan');
  expect(sheet().props.visible).toBe(false);
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('inactive Profile cannot force navigation on sign-out or override the active status bar', async () => {
  mockFocused = false; await rerender();
  expect(renderer.root.findAllByType('StatusBar')).toHaveLength(0);
  mockSession = { ...mockSession, authenticated: false, user: null }; await rerender();
  expect(sheet().props.visible).toBe(false);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test('an already signed-in customer with an incomplete profile still lands on the profile form', async () => {
  mockSession = { ...mockSession, needsProfileCompletion: true }; await rerender();
  expect(selected('Profile')).toBe(true);
});

test('Profile > Orders > Past puts one Reorder action below each eligible card and keeps Active unchanged', async () => {
  const order = (id, status) => ({ id, status, location_id: 'original-store', order_number: id === 'past' ? 42 : 43,
    fulfillment_type: 'PICKUP', placed_at: '2026-10-01T16:00:00Z', final_payable_cents: 1200 });
  mockAccount.data.orders = [order('past', 'PICKED_UP'), order('active', 'PREPARING')];
  await rerender(); await tap('Orders');
  expect(button('Reorder')).toBeUndefined();
  await tap('Past (1)');
  const card = renderer.root.findByProps({ accessibilityLabel: 'Order #42' });
  expect(card.findAllByProps({ accessibilityLabel: 'Reorder' })).toHaveLength(0);
  const action = renderer.root.findByProps({ accessibilityLabel: 'Reorder' });
  expect(action).toBeDefined();
  await act(async () => card.props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith('/orders/past');
  await tap('Active (1)'); expect(button('Reorder')).toBeUndefined();
});

const historyOrder = (id, status = 'DELIVERED') => ({ id: String(id), status, location_id: 'store', order_number: id,
  fulfillment_type: 'PICKUP', placed_at: '2026-10-01T16:00:00Z', final_payable_cents: 1200 });
test('Past can load older orders, keeps the selected filter, adds Reorder actions and ends pagination', async () => {
  mockAccount.data.orders = Array.from({ length: 20 }, (_, i) => historyOrder(i + 1)); mockAccount.data.ordersNextCursor = 'page2';
  await rerender(); await tap('Orders'); expect(button('Load More Orders')).toBeUndefined(); await tap('Past (20)');
  expect(strings()).toContain('Counts show loaded orders. Older orders may be on the next pages.');
  mockAccount.loadMoreOrders.mockImplementation(async () => {
    mockAccount.data.orders = [...mockAccount.data.orders, historyOrder(21), historyOrder(22, 'PREPARING')]; mockAccount.data.ordersNextCursor = null;
  });
  await tap('Load More Orders'); await rerender();
  expect(mockAccount.loadMoreOrders).toHaveBeenCalledTimes(1); expect(selected('Past (21)')).toBe(true);
  expect(renderer.root.findAllByProps({ accessibilityLabel: 'Reorder' })).toHaveLength(21);
  expect(button('Load More Orders')).toBeUndefined();
  const olderCard = renderer.root.findByProps({ accessibilityLabel: 'Order #21' });
  expect(olderCard.findAllByProps({ accessibilityLabel: 'Reorder' })).toHaveLength(0);
  await act(async () => olderCard.props.onPress()); expect(mockRouter.push).toHaveBeenCalledWith('/orders/21');
  await tap('Active (1)'); expect(selected('Active (1)')).toBe(true); expect(strings()).toContain('Order #22');
});
test('an empty Past list with more mixed/active-only pages remains loadable and never claims no historical orders', async () => {
  mockAccount.data.orders = [historyOrder(1, 'PREPARING')]; mockAccount.data.ordersNextCursor = 'page2';
  await rerender(); await tap('Orders'); await tap('Past (0)');
  expect(strings()).toContain('No past orders in the loaded pages. Load more orders to check older history.');
  expect(strings()).not.toContain('No past orders'); expect(button('Load More Orders')).toBeDefined();
  mockAccount.data.orders = [...mockAccount.data.orders, historyOrder(2, 'ACCEPTED')]; mockAccount.data.ordersNextCursor = 'page3';
  await rerender(); expect(selected('Past (0)')).toBe(true); expect(button('Load More Orders')).toBeDefined();
  mockAccount.data.orders = [...mockAccount.data.orders, historyOrder(3)]; await rerender();
  expect(selected('Past (1)')).toBe(true); expect(renderer.root.findAllByProps({ accessibilityLabel: 'Reorder' })).toHaveLength(1);
});
test('pagination spinner and disabled button are visible while the next page loads', async () => {
  mockAccount.data.ordersNextCursor = 'page2'; await rerender(); await tap('Orders'); await tap('Past (0)');
  mockAccount.loadingMoreOrders = true; await rerender();
  const loading = renderer.root.findByProps({ accessibilityLabel: 'Load More Orders' });
  expect(loading.props.disabled).toBe(true); expect(loading.props.accessibilityState.busy).toBe(true);
  expect(loading.findAllByType('ActivityIndicator')).toHaveLength(1); expect(strings()).toContain('Loading more orders...');
});
test('failed page leaves existing cards visible with a retry action; exhaustion removes the button', async () => {
  mockAccount.data.orders = [historyOrder(1)]; mockAccount.data.ordersNextCursor = 'page2';
  await rerender(); await tap('Orders'); await tap('Past (1)');
  mockAccount.sectionErrors.orders = 'Unable to connect'; await rerender();
  expect(strings()).toContain('Order #1'); expect(strings()).toContain('Unable to connect');
  await tap('Load More Orders'); expect(mockAccount.loadMoreOrders).toHaveBeenCalledTimes(1);
  mockAccount.data.ordersNextCursor = null; mockAccount.sectionErrors = {}; await rerender();
  expect(button('Load More Orders')).toBeUndefined();
});
test('genuinely empty exhausted history shows No past orders; an initial load failure offers refresh retry', async () => {
  await tap('Orders'); await tap('Past (0)'); expect(strings()).toContain('No past orders'); expect(button('Load More Orders')).toBeUndefined();
  mockAccount.sectionErrors.orders = 'Offline'; await rerender();
  expect(strings()).not.toContain('No past orders'); await tap('Try again'); expect(mockAccount.refresh).toHaveBeenCalledWith('refresh');
});
