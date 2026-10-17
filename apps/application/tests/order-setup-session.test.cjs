const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockCart;
const mockStorage = new Map();
const mockListeners = new Set();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async key => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => { mockStorage.set(key, value); }),
  removeItem: jest.fn(async key => { mockStorage.delete(key); }),
}));
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: (_, fn) => {
  mockListeners.add(fn); return { remove: () => mockListeners.delete(fn) };
} } }));
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/components/order-setup-modal', () => ({ OrderSetupModal: 'OrderSetupModal' }));
const { AppState } = require('react-native');
const { OrderSetupProvider, useOrderSetup } = require('../src/context/order-setup');
const { ORDER_SETUP_TTL_MS } = require('../src/lib/order-setup');
let setup, renderer, setHydrated;
const now = Date.parse('2026-10-17T16:00:00Z');
const key = 'wings4u.order-setup-v1:store';
const delivery = { fulfillmentType: 'DELIVERY', scheduledFor: '2026-10-17T19:00:00.000Z',
  deliveryAddress: { line1: '12 Main St unit 2', city: 'London', postal_code: 'N5Y 4J7' } };
function Probe() { setup = useOrderSetup(); return null; }
function Harness({ hydrated = true, stale = false }) {
  const [fulfillmentType, setFulfillmentType] = React.useState(stale ? 'DELIVERY' : 'PICKUP');
  const [scheduledFor, setScheduledFor] = React.useState(stale ? delivery.scheduledFor : null);
  const [driverTipPercent, setDriverTipPercent] = React.useState('none');
  const [isCartHydrated, changeHydrated] = React.useState(hydrated);
  setHydrated = changeHydrated;
  mockCart = { locationId: 'store', fulfillmentType, scheduledFor, driverTipPercent, isCartHydrated,
    items: [{ key: 'wings' }], setFulfillmentType, setScheduledFor, setDriverTipPercent };
  return React.createElement(OrderSetupProvider, null, React.createElement(Probe));
}
const mount = async props => act(async () => { renderer = create(React.createElement(Harness, props)); });
const modal = () => renderer.root.findByType('OrderSetupModal');
const hasModal = () => renderer.root.findAllByType('OrderSetupModal').length > 0;
const appState = async state => act(async () => { AppState.currentState = state; for (const fn of mockListeners) fn(state); });
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); mockStorage.clear(); mockListeners.clear(); AppState.currentState = 'active'; });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.useRealTimers(); });

test('opens on first launch and commits type, schedule and address together', async () => {
  await mount();
  expect(modal().props.canClose).toBe(false);
  await act(async () => modal().props.onConfirm(delivery));
  expect(hasModal()).toBe(false);
  expect(mockCart.fulfillmentType).toBe('DELIVERY');
  expect(mockCart.scheduledFor).toBe(delivery.scheduledFor);
  expect(setup.deliveryAddress).toEqual(delivery.deliveryAddress);
  expect(JSON.parse(mockStorage.get(key))).toMatchObject(delivery);
  await act(async () => setup.openOrderSetup('PICKUP'));
  expect(modal().props.initialType).toBe('PICKUP');
  await act(async () => modal().props.onClose());
  expect(mockCart.fulfillmentType).toBe('DELIVERY'); // Cancelling edits does not mutate the cart.
});

test('restores a recent selection after a cold launch, following cart hydration', async () => {
  mockStorage.set(key, JSON.stringify({ ...delivery, v: 1, lastActiveAt: now - 60_000 }));
  await mount({ hydrated: false });
  expect(setup.ready).toBe(false);
  expect(hasModal()).toBe(false);
  await act(async () => setHydrated(true));
  expect(setup.ready).toBe(true);
  expect(hasModal()).toBe(false);
  expect(mockCart.scheduledFor).toBe(delivery.scheduledFor);
  expect(mockCart.fulfillmentType).toBe('DELIVERY');
});

test('discards stale cart scheduling when the saved setup has expired', async () => {
  mockStorage.set(key, JSON.stringify({ ...delivery, v: 1, lastActiveAt: now - ORDER_SETUP_TTL_MS }));
  await mount({ stale: true });
  expect(hasModal()).toBe(true);
  expect(mockCart.fulfillmentType).toBe('PICKUP');
  expect(mockCart.scheduledFor).toBeNull();
  expect(setup.deliveryAddress).toBeNull();
  expect(mockCart.items).toHaveLength(1);
});

test('keeps choices on quick return and expires after fifteen minutes away', async () => {
  await mount();
  await act(async () => modal().props.onConfirm(delivery));
  await appState('background');
  jest.setSystemTime(now + 5 * 60_000);
  await appState('active');
  expect(hasModal()).toBe(false);
  expect(mockCart.fulfillmentType).toBe('DELIVERY');
  await appState('background');
  jest.setSystemTime(now + 20 * 60_000);
  await appState('active');
  expect(hasModal()).toBe(true);
  expect(mockCart.scheduledFor).toBeNull();
  expect(setup.deliveryAddress).toBeNull();
  expect(mockStorage.has(key)).toBe(false);
  expect(mockCart.items).toHaveLength(1);
});

test('cart rehydration during sign-in preserves this session’s chosen setup', async () => {
  await mount();
  await act(async () => modal().props.onConfirm(delivery));
  await act(async () => setHydrated(false));
  await act(async () => { mockCart.setFulfillmentType('PICKUP'); mockCart.setScheduledFor(null); });
  await act(async () => setHydrated(true));
  expect(mockCart.fulfillmentType).toBe('DELIVERY');
  expect(mockCart.scheduledFor).toBe(delivery.scheduledFor);
  expect(setup.deliveryAddress).toEqual(delivery.deliveryAddress);
});

test('checkout address edits persist canonically without trimming the live input', async () => {
  await mount();
  await act(async () => modal().props.onConfirm(delivery));
  await act(async () => setup.setDeliveryAddress({ line1: ' 12 Main St unit 3 ', city: 'London', postal_code: 'n5y4j7' }));
  expect(setup.deliveryAddress.line1).toBe(' 12 Main St unit 3 ');
  expect(JSON.parse(mockStorage.get(key)).deliveryAddress).toEqual({ line1: '12 Main St unit 3', city: 'London', postal_code: 'N5Y 4J7' });
});

test('a scheduled time that has passed on return asks for a fresh setup', async () => {
  await mount();
  await act(async () => modal().props.onConfirm({ ...delivery, scheduledFor: new Date(now + 5 * 60_000).toISOString() }));
  await appState('background');
  jest.setSystemTime(now + 6 * 60_000);
  await appState('active');
  expect(hasModal()).toBe(true);
  expect(modal().props.canClose).toBe(false);
  expect(mockCart.scheduledFor).toBeNull();
});

test('foreground activity keeps a long browsing session alive for a later cold launch', async () => {
  await mount();
  await act(async () => modal().props.onConfirm(delivery));
  await act(async () => jest.advanceTimersByTime(30 * 60_000));
  expect(hasModal()).toBe(false);
  const saved = JSON.parse(mockStorage.get(key));
  expect(saved.lastActiveAt).toBe(now + 30 * 60_000);
  await act(async () => renderer.unmount()); renderer = null;
  jest.setSystemTime(now + 31 * 60_000);
  await mount();
  expect(hasModal()).toBe(false);
  expect(mockCart.fulfillmentType).toBe('DELIVERY');
});
