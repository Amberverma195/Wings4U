const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockCart, mockSession, mockFocused;
const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useIsFocused: () => mockFocused }));
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView', Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View',
  StyleSheet: { create: value => value },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('lucide-react-native', () => ({ Minus: 'Minus', Plus: 'Plus', ShoppingBag: 'ShoppingBag', Trash2: 'Trash2' }));
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession }));
jest.mock('../src/context/order-setup', () => ({ useOrderSetup: () => ({ openOrderSetup: jest.fn() }) }));
jest.mock('../src/components/order-setup-summary', () => ({ OrderSetupSummary: 'OrderSetupSummary' }));
const mockPromo = { promoCode: null, applyWingsReward: false };
jest.mock('../src/context/promo', () => ({ usePromo: () => mockPromo }));
jest.mock('../src/hooks/use-account-data', () => ({ useAccountData: () => ({ data: { promos: [], wingsRewards: null } }) }));
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }));
const { apiJson } = require('../src/lib/api');
const CartTab = require('../app/(tabs)/cart').default;
let renderer;
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => node.findAllByType('Text').some(text => text.children.join('') === label));
const rerender = async () => act(async () => renderer.update(React.createElement(CartTab)));
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockFocused = true;
  mockSession = { loaded: true, authenticated: false };
  mockCart = { items: [{ key: 'wings', menu_item_id: 'wings', name: 'Wings', base_price_cents: 1000, quantity: 1,
    modifier_selections: [], special_instructions: '' }], locationId: 'store', fulfillmentType: 'PICKUP',
    scheduledFor: null, driverTipPercent: 'none', isCartHydrating: false, updateQuantity: jest.fn(), removeItem: jest.fn() };
  apiJson.mockResolvedValue({ data: { item_subtotal_cents: 1000, tax_total_cents: 130, final_payable_cents: 1130 } });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.useRealTimers(); });
const mount = async () => act(async () => { renderer = create(React.createElement(CartTab)); });

test.each([false, true])('guest/authenticated Cart still prices its items and opens the stack checkout (authenticated: %s)', async authenticated => {
  mockSession.authenticated = authenticated;
  mockCart.scheduledFor = '2026-10-18T17:00:00.000Z';
  await mount();
  expect(button('Checkout').props.disabled).toBe(true);
  await act(async () => jest.advanceTimersByTime(250));
  expect(button('Checkout').props.disabled).toBe(false);
  expect(JSON.parse(apiJson.mock.calls[0][1].body)).toMatchObject({
    fulfillment_type: 'PICKUP', scheduled_for: mockCart.scheduledFor,
    items: [{ menu_item_id: 'wings', quantity: 1 }],
  });
  await act(async () => button('Checkout').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith('/checkout');
  expect(mockCart.items).toHaveLength(1);
});

test('empty Cart keeps Browse menu available, and pricing errors still block checkout', async () => {
  mockCart.items = []; await mount();
  expect(button('Checkout')).toBeUndefined();
  expect(button('Browse menu')).toBeDefined();
  await act(async () => renderer.unmount()); renderer = null;
  mockCart.items = [{ key: 'wings', menu_item_id: 'wings', name: 'Wings', base_price_cents: 1000, quantity: 1,
    modifier_selections: [], special_instructions: '' }];
  apiJson.mockRejectedValue(new Error('Unavailable item')); await mount();
  await act(async () => jest.advanceTimersByTime(250));
  expect(button('Checkout').props.disabled).toBe(true);
});

test('an inactive Cart does not override the active screen’s status bar', async () => {
  await mount(); mockFocused = false; await rerender();
  expect(renderer.root.findAllByType('StatusBar')).toHaveLength(0);
});
