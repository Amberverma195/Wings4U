const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession;
const mockStorage = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async key => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => mockStorage.set(key, value)), removeItem: jest.fn(async key => mockStorage.delete(key)) }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));
jest.mock('../src/lib/env', () => ({ DEFAULT_LOCATION_ID: 'store' }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession }));
jest.mock('../src/lib/saved-cart-api', () => ({
  fetchSavedCart: jest.fn(async () => null), putSavedCart: jest.fn(async () => null),
  deleteSavedCart: jest.fn(), mergeSavedCartOnLogin: jest.fn(),
}));
jest.mock('../src/components/order-setup-modal', () => ({ OrderSetupModal: 'OrderSetupModal' }));
const { CartProvider, useCart } = require('../src/context/cart');
const { OrderSetupProvider, useOrderSetup } = require('../src/context/order-setup');
let cart, setup, renderer;
function Probe() { cart = useCart(); setup = useOrderSetup(); return null; }
const tree = () => React.createElement(CartProvider, null, React.createElement(OrderSetupProvider, null, React.createElement(Probe)));
const modal = () => renderer.root.findByType('OrderSetupModal');
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockStorage.clear(); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.useRealTimers(); });

test.each([false, true])('customers can dismiss setup, add to the real cart and keep items on later cancellation (signed in: %s)', async authenticated => {
  mockSession = { loaded: true, authenticated };
  await act(async () => { renderer = create(tree()); });
  await act(async () => modal().props.onClose());
  await act(async () => cart.addItem({ menu_item_id: 'real-item', name: 'Wings', base_price_cents: 1299, quantity: 1,
    modifier_selections: [], special_instructions: '' }));
  expect(cart.itemCount).toBe(1);
  expect(cart.fulfillmentType).toBe('PICKUP');
  expect(setup.confirmed).toBe(false);
  expect(setup.getConfirmedSetup()).toBeNull();
  await act(async () => jest.advanceTimersByTime(500));
  expect(mockStorage.has('wings4u.order-setup-v1:store')).toBe(false);
  let request;
  await act(async () => { request = setup.ensureOrderSetup(); });
  await act(async () => modal().props.onClose());
  expect(await request).toBeNull();
  expect(cart.itemCount).toBe(1);
  expect(cart.items[0].menu_item_id).toBe('real-item');
});
