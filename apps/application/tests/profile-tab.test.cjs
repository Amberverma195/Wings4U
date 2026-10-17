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
  mockAccount = { loading: false, refreshing: false, error: null, refresh: jest.fn(), data: {
    orders: [], promos: [], wingsLedger: [], wingsRewards: null, addresses: [], tickets: [],
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
