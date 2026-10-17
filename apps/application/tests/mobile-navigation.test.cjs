const React = require('react');
const { act, create } = require('react-test-renderer');
const fs = require('node:fs');
const path = require('node:path');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, mockItemCount, mockRouterState, mockFocused, mockKey = 0;
jest.mock('nanoid/non-secure', () => ({ nanoid: () => String(++mockKey) }));
jest.mock('expo-router/build/react-navigation/native', () => require('expo-router/build/react-navigation/core/validatePathConfig'));
jest.mock('expo-router/js-tabs', () => ({ Tabs: Object.assign(props => require('react').createElement('Tabs', props), { Screen: 'TabsScreen' }) }));
const mockRouter = { navigate: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useIsFocused: () => mockFocused }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 20 }) }));
jest.mock('lucide-react-native', () => ({ House: 'House', UtensilsCrossed: 'UtensilsCrossed', User: 'User', ShoppingBag: 'ShoppingBag' }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession }));
jest.mock('../src/context/cart', () => ({ useCart: () => ({ itemCount: mockItemCount }) }));
jest.mock('../src/components/auth-sheet', () => ({ AuthSheet: 'AuthSheet' }));

const { default: TabLayout, unstable_settings } = require('../app/(tabs)/_layout');
const { TabRouter } = require('expo-router/build/react-navigation/routers/TabRouter');
const { StackRouter } = require('expo-router/build/react-navigation/routers/StackRouter');
const { getRoutes } = require('expo-router/build/getRoutesCore');
const { getReactNavigationConfig } = require('expo-router/build/getReactNavigationConfig');
const { getStateFromPath } = require('expo-router/build/fork/getStateFromPath');
const tabOptions = { routeNames: ['index', 'menu', 'profile', 'cart', 'deals', 'orders'], routeParamList: {}, routeGetIdList: {} };
const tabRouter = TabRouter({ initialRouteName: 'index', backBehavior: 'history' });
const go = (name, params) => { mockRouterState = tabRouter.getStateForAction(mockRouterState, { type: 'NAVIGATE', payload: { name, params } }, tabOptions); };
const active = () => mockRouterState.routes[mockRouterState.index];
let renderer;
const screen = name => renderer.root.findAllByType('TabsScreen').find(node => node.props.name === name);
const sheet = () => renderer.root.findByType('AuthSheet');
const press = async name => {
  const event = { preventDefault: jest.fn() };
  await act(async () => {
    renderer.root.findByType('Tabs').props.screenListeners({ route: { name } }).tabPress(event);
    screen(name).props.listeners?.tabPress?.(event);
    if (!event.preventDefault.mock.calls.length) go(name);
  });
  return event;
};
const rerender = async () => act(async () => renderer.update(React.createElement(TabLayout)));

beforeEach(async () => {
  jest.clearAllMocks();
  mockSession = { loaded: true, authenticated: false, needsProfileCompletion: false };
  mockFocused = true;
  mockItemCount = 0;
  mockRouterState = tabRouter.getInitialState(tabOptions);
  mockRouter.navigate.mockImplementation(() => go('profile'));
  await act(async () => { renderer = create(React.createElement(TabLayout)); });
});
afterEach(async () => { await act(async () => renderer.unmount()); });

test('all four visible routes are real tabs, and Cart does not intercept selection', async () => {
  const screens = renderer.root.findAllByType('TabsScreen');
  expect(screens.filter(s => s.props.options.href !== null).map(s => s.props.name)).toEqual(['index', 'menu', 'profile', 'cart']);
  expect(screen('cart').props.listeners).toBeUndefined();
  expect(renderer.root.findByType('Tabs').props.backBehavior).toBe('history');
  expect(screen('cart').props.options.headerShown).toBe(true);
  const event = await press('cart');
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(active().name).toBe('cart');
  expect(mockRouter.navigate).not.toHaveBeenCalled();
});

test('guest Profile opens authentication, cancellation leaves the previous tab unchanged', async () => {
  await press('menu');
  const before = mockRouterState;
  const event = await press('profile');
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(sheet().props.visible).toBe(true);
  expect(mockRouterState).toBe(before);
  await act(async () => sheet().props.onClose());
  expect(sheet().props.visible).toBe(false);
  expect(active().name).toBe('menu');
  mockSession = { ...mockSession, authenticated: true };
  await rerender();
  expect(mockRouter.navigate).not.toHaveBeenCalled();
});

test('authentication completion selects Profile exactly once, including delayed session refresh', async () => {
  await press('cart'); await press('profile');
  await act(async () => { sheet().props.onComplete(); sheet().props.onComplete(); sheet().props.onClose(); });
  expect(active().name).toBe('cart');
  mockSession = { ...mockSession, authenticated: true };
  await rerender(); await rerender();
  expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
  expect(mockRouter.navigate).toHaveBeenCalledWith('/profile');
  expect(active().name).toBe('profile');
  expect(mockRouterState.routes.filter(r => r.name === 'profile')).toHaveLength(1);
});

test('early authentication during incomplete-profile flow does not leave AuthSheet', async () => {
  await press('menu'); await press('profile');
  mockSession = { ...mockSession, authenticated: true, needsProfileCompletion: true };
  await rerender();
  expect(active().name).toBe('menu');
  expect(sheet().props.visible).toBe(true);
  expect(mockRouter.navigate).not.toHaveBeenCalled();
  await act(async () => { sheet().props.onComplete(); sheet().props.onClose(); });
  expect(mockRouter.navigate).not.toHaveBeenCalled();
  mockSession = { ...mockSession, needsProfileCompletion: false };
  await rerender();
  expect(active().name).toBe('profile');
  expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
});

test.each([false, true])('Profile press waits for session loading (authenticated: %s)', async authenticated => {
  mockSession = { ...mockSession, loaded: false };
  await rerender(); await press('profile'); await press('profile');
  expect(sheet().props.visible).toBe(false);
  expect(active().name).toBe('index');
  mockSession = { ...mockSession, loaded: true, authenticated };
  await rerender();
  expect(sheet().props.visible).toBe(!authenticated);
  expect(mockRouter.navigate).toHaveBeenCalledTimes(authenticated ? 1 : 0);
});

test('choosing another tab cancels a Profile intent waiting for session loading', async () => {
  mockSession = { ...mockSession, loaded: false };
  await rerender(); await press('profile'); await press('cart');
  mockSession = { ...mockSession, loaded: true, authenticated: true };
  await rerender();
  expect(active().name).toBe('cart');
  expect(mockRouter.navigate).not.toHaveBeenCalled();
});

test('leaving the tabs for a stack screen cancels delayed Profile navigation', async () => {
  mockSession = { ...mockSession, loaded: false };
  await rerender(); await press('profile');
  mockFocused = false; await rerender();
  mockSession = { ...mockSession, loaded: true, authenticated: true }; await rerender();
  expect(mockRouter.navigate).not.toHaveBeenCalled();
  expect(sheet().props.visible).toBe(false);
});

test('cancelling incomplete-profile authentication cannot navigate later when completion state changes', async () => {
  await press('menu'); await press('profile');
  mockSession = { ...mockSession, authenticated: true, needsProfileCompletion: true }; await rerender();
  await act(async () => sheet().props.onClose());
  mockSession = { ...mockSession, needsProfileCompletion: false }; await rerender();
  expect(mockRouter.navigate).not.toHaveBeenCalled();
  expect(active().name).toBe('menu');
});

test('authenticated Profile uses native tab focus; repeated presses do not add history entries', async () => {
  mockSession = { ...mockSession, authenticated: true };
  await rerender(); await press('menu'); await press('profile'); await press('profile');
  expect(active().name).toBe('profile');
  expect(sheet().props.visible).toBe(false);
  expect(mockRouter.navigate).not.toHaveBeenCalled();
  expect(mockRouterState.history).toHaveLength(3);
});

test('badge tracks cart updates without changing tab selection', async () => {
  await press('cart');
  for (const [count, badge] of [[0, undefined], [1, 1], [7, 7], [12, '9+'], [0, undefined]]) {
    mockItemCount = count; await rerender();
    expect(screen('cart').props.options.tabBarBadge).toBe(badge);
    expect(active().name).toBe('cart');
  }
});

test('Android GO_BACK traverses visited tabs once, then lets the parent handle Back', async () => {
  mockSession = { ...mockSession, authenticated: true }; await rerender();
  await press('menu'); await press('cart'); await press('profile'); await press('cart');
  for (const name of ['profile', 'menu', 'index']) {
    mockRouterState = tabRouter.getStateForAction(mockRouterState, { type: 'GO_BACK' }, tabOptions);
    expect(active().name).toBe(name);
  }
  expect(tabRouter.getStateForAction(mockRouterState, { type: 'GO_BACK' }, tabOptions)).toBeNull();
});

test('sign-out reset returns Home and removes Profile from Android Back history', async () => {
  mockSession = { ...mockSession, authenticated: true }; await rerender();
  await press('menu'); await press('cart'); await press('profile');
  const reset = tabRouter.getStateForAction(mockRouterState, { type: 'RESET', payload: { index: 0, routes: [{ name: 'index' }] } }, tabOptions);
  mockRouterState = tabRouter.getRehydratedState(reset, tabOptions);
  expect(active().name).toBe('index');
  expect(mockRouterState.routes.filter(r => r.name === 'profile')).toHaveLength(1);
  expect(tabRouter.getStateForAction(mockRouterState, { type: 'GO_BACK' }, tabOptions)).toBeNull();
});

// Build the real route graph from filesystem names, without evaluating app providers or API modules.
function routeGraph() {
  const appDir = path.join(__dirname, '../app');
  const keys = fs.readdirSync(appDir, { recursive: true }).filter(file => file.endsWith('.tsx')).map(file => `./${file.replaceAll('\\', '/')}`);
  const context = file => ({ default: () => null, ...(file === './(tabs)/_layout.tsx' ? { unstable_settings } : {}) });
  context.keys = () => keys;
  return getRoutes(context, { platform: 'android', importMode: 'sync', ignoreEntryPoints: false });
}

test.each(['/profile?section=orders&entry=123&coupon=HONEY%205', '/(tabs)/profile?section=addresses&entry=abc', '/cart?source=menu&entry=456'])('existing deep link resolves once inside the tab group: %s', url => {
  const tree = routeGraph();
  expect(tree.children.some(node => ['profile', 'cart'].includes(node.route))).toBe(false);
  const state = getStateFromPath(url, getReactNavigationConfig(tree, true));
  const group = state.routes[state.index ?? state.routes.length - 1];
  expect(group.name).toBe('(tabs)');
  const route = group.state.routes[group.state.index ?? group.state.routes.length - 1];
  expect(route.name).toBe(url.includes('profile') ? 'profile' : 'cart');
  const query = Object.fromEntries(new URLSearchParams(url.split('?')[1]));
  expect(route.params).toMatchObject(query);
  expect(group.state.routes.filter(r => r.name === route.name)).toHaveLength(1);
});

test('checkout and tracking remain stack routes above one tabs entry, and Back restores Cart', async () => {
  const rootRoutes = routeGraph().children.map(node => node.route);
  expect(rootRoutes).toEqual(expect.arrayContaining(['(tabs)', 'checkout', 'orders/[id]']));
  await press('cart');
  const router = StackRouter({ initialRouteName: '(tabs)' });
  const options = { routeNames: rootRoutes, routeParamList: {}, routeGetIdList: {} };
  let root = router.getInitialState(options);
  root.routes[0].state = mockRouterState;
  root = router.getStateForAction(root, { type: 'PUSH', payload: { name: 'checkout' } }, options);
  expect(root.routes.map(r => r.name)).toEqual(['(tabs)', 'checkout']);
  const back = router.getStateForAction(root, { type: 'GO_BACK' }, options);
  expect(back.routes[0].state.routes[back.routes[0].state.index].name).toBe('cart');
  root = router.getStateForAction(root, { type: 'REPLACE', payload: { name: 'orders/[id]', params: { id: 'order-123' } } }, options);
  expect(root.routes.map(r => r.name)).toEqual(['(tabs)', 'orders/[id]']);
  expect(root.routes[1].params.id).toBe('order-123');
  expect(root.routes.filter(r => r.name === '(tabs)')).toHaveLength(1);
});
