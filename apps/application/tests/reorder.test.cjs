const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, mockCart, mockFocused = true, renderer;
const mockRouter = { navigate: jest.fn(), push: jest.fn() };
jest.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', ScrollView: 'ScrollView',
  Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View', StyleSheet: { create: value => value } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useIsFocused: () => mockFocused }));
jest.mock('../src/context/cart', () => ({ useCart: () => mockCart }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession,
  withSilentRefresh: jest.fn(async call => call()) }));
jest.mock('../src/lib/api', () => ({ apiFetch: jest.fn(), getApiErrorMessage: (body, fallback) => body?.errors?.[0]?.message ?? fallback }));
const { apiFetch } = require('../src/lib/api');
const { withSilentRefresh } = require('../src/context/session');
const { ReorderButton } = require('../src/components/reorder-button');
const { OrderRow } = require('../src/components/order-history');
const { parseReorderPreview } = require('../src/lib/reorder');
const item = { menu_item_id: 'burger', menu_item_slug: 'burger', name: 'Burger', image_url: 'image', base_price_cents: 1500, quantity: 2,
  modifier_selections: [{ modifier_option_id: 'cheese', option_name: 'Cheese', group_name: 'Extras', price_delta_cents: 100 }],
  removed_ingredients: [{ id: 'onion', name: 'Onion' }], special_instructions: 'Cut in half', builder_payload: null };
const preview = () => ({ order_id: 'past', location_id: 'original-store', fulfillment_type_hint: 'DELIVERY', items: [item], all_unavailable: false,
  diff: { skipped: [{ name: 'Wings', reason: 'unavailable', detail: 'Out of stock' }], modifier_changes: [{ name: 'Burger', dropped: ['Old sauce'] }],
    price_changes: [{ name: 'Burger', old_cents: 1200, new_cents: 1600 }], configuration_changes: [{ name: 'Burger', changes: ['Old cheese → Cheese'] }] } });
const response = data => ({ ok: true, status: 200, json: async () => ({ data }) });
const tree = () => React.createElement(ReorderButton, { orderId: 'past', locationId: 'original-store' });
const texts = () => renderer.root.findAllByType('Text').map(node => node.children.join(''));
const button = label => renderer.root.findAllByType('TouchableOpacity').find(node => node.findAllByType('Text').some(text => text.children.join('') === label));
const tap = async label => act(async () => button(label).props.onPress());
const mount = async () => act(async () => { renderer = create(tree()); });
const rerender = async () => act(async () => renderer.update(tree()));
beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true;
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer' }, refresh: jest.fn(), clear: jest.fn() };
  mockCart = { locationId: 'original-store', fulfillmentType: 'PICKUP', scheduledFor: null, isCartHydrated: true, isCartHydrating: false,
    items: [{ key: 'existing', name: 'Existing item' }], addItem: jest.fn() };
  apiFetch.mockResolvedValue(response(preview()));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('preview uses original location and current cart context, review discloses differences; only confirmation adds items', async () => {
  mockCart.scheduledFor = '2030-01-01T18:00:00Z';
  await mount(); await tap('Reorder');
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/orders/past/reorder', expect.objectContaining({ method: 'POST', locationId: 'original-store',
    body: JSON.stringify({ fulfillment_type: 'PICKUP', scheduled_for: mockCart.scheduledFor }) }));
  expect(withSilentRefresh).toHaveBeenCalledWith(expect.any(Function), mockSession.refresh, mockSession.clear);
  expect(mockCart.addItem).not.toHaveBeenCalled();
  expect(texts()).toEqual(expect.arrayContaining(['Review your reorder', '1 item will be added to your cart at current prices.', 'Skipped',
    'Wings — currently unavailable. Out of stock', 'Modifiers dropped', 'Burger: Old sauce', 'Price changes', 'Burger: $12.00 → $16.00', 'Configuration changes']));
  const confirm = button('Add to cart').props.onPress;
  await act(async () => { confirm(); confirm(); });
  expect(mockCart.addItem).toHaveBeenCalledTimes(1);
  expect(mockCart.addItem).toHaveBeenCalledWith({ ...item, builder_payload: undefined });
  expect(mockCart.items).toEqual([{ key: 'existing', name: 'Existing item' }]);
  expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
  expect(mockRouter.navigate).toHaveBeenCalledWith('/(tabs)/cart');
});
test.each(['Cancel', 'back', 'backdrop'])('%s leaves the cart untouched', async action => {
  await mount(); await tap('Reorder');
  if (action === 'back') await act(async () => renderer.root.findByType('Modal').props.onRequestClose());
  else if (action === 'backdrop') await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Dismiss reorder review' }).props.onPress());
  else await tap('Cancel');
  expect(mockCart.addItem).not.toHaveBeenCalled(); expect(mockRouter.navigate).not.toHaveBeenCalled();
  expect(button('Add to cart')).toBeUndefined();
});
test('all unavailable offers Close only and no navigation', async () => {
  apiFetch.mockResolvedValue(response({ ...preview(), items: [], all_unavailable: true }));
  await mount(); await tap('Reorder');
  expect(texts()).toContain("We're sorry, none of the items from this order are currently available.");
  expect(button('Add to cart')).toBeUndefined(); await tap('Close');
  expect(mockCart.addItem).not.toHaveBeenCalled(); expect(mockRouter.navigate).not.toHaveBeenCalled();
});
test.each([401, 403, 422, 500])('server rejection %s keeps cart unchanged and allows retry', async status => {
  apiFetch.mockResolvedValueOnce({ ok: false, status, json: async () => ({ errors: [{ message: 'Choose another time' }] }) });
  await mount(); await tap('Reorder'); expect(button('Add to cart')).toBeUndefined();
  expect(mockCart.addItem).not.toHaveBeenCalled(); expect(texts().some(value => /sign in|account|another time/.test(value))).toBe(true);
  await tap('Reorder'); expect(button('Add to cart')).toBeDefined();
});
test('network failure allows retry', async () => {
  apiFetch.mockRejectedValueOnce(new Error('Network request failed')); await mount(); await tap('Reorder');
  expect(texts()).toContain('Unable to connect. Please try Reorder again.'); await tap('Reorder'); expect(button('Add to cart')).toBeDefined();
});
test('guest has no Reorder action or request', async () => {
  mockSession.authenticated = false; mockSession.user = null; await mount();
  expect(button('Reorder')).toBeUndefined(); expect(apiFetch).not.toHaveBeenCalled();
});
test.each(['logout', 'account', 'location', 'time', 'fulfillment', 'blur', 'unmount'])('%s during pending preview discards sensitive results', async change => {
  let resolve; apiFetch.mockReturnValue(new Promise(done => { resolve = done; })); await mount();
  const start = button('Reorder').props.onPress; let request;
  await act(async () => { request = start(); start(); }); expect(apiFetch).toHaveBeenCalledTimes(1);
  if (change === 'logout') mockSession = { ...mockSession, authenticated: false, user: null };
  if (change === 'account') mockSession = { ...mockSession, user: { id: 'another' } };
  if (change === 'location') mockCart.locationId = 'different';
  if (change === 'time') mockCart.scheduledFor = '2030-01-01T16:00:00Z';
  if (change === 'fulfillment') mockCart.fulfillmentType = 'DELIVERY';
  if (change === 'blur') mockFocused = false;
  if (change === 'unmount') { await act(async () => renderer.unmount()); renderer = null; } else await rerender();
  await act(async () => { resolve(response(preview())); await request; });
  expect(mockCart.addItem).not.toHaveBeenCalled(); expect(mockRouter.navigate).not.toHaveBeenCalled();
  if (renderer) expect(button('Add to cart')).toBeUndefined();
});
test('wrong-location confirmation fails without changing cart', async () => {
  mockCart.locationId = 'another-store'; await mount(); await tap('Reorder'); await tap('Add to cart');
  expect(texts()).toContain('This order was placed at a different location. Reorder is only available on the matching location.');
  expect(mockCart.addItem).not.toHaveBeenCalled(); expect(mockRouter.navigate).not.toHaveBeenCalled();
});
test.each(['logout', 'account', 'time'])('an already reviewed reorder cannot survive %s', async change => {
  await mount(); await tap('Reorder'); const oldConfirm = button('Add to cart').props.onPress;
  if (change === 'logout') mockSession = { ...mockSession, authenticated: false, user: null };
  if (change === 'account') mockSession = { ...mockSession, user: { id: 'other' } };
  if (change === 'time') mockCart.scheduledFor = '2030-01-01T18:00:00Z';
  await rerender(); await act(async () => oldConfirm());
  expect(button('Add to cart')).toBeUndefined(); expect(mockCart.addItem).not.toHaveBeenCalled();
});
test('hydration blocks requests and confirmations', async () => {
  mockCart.isCartHydrated = false; await mount(); await tap('Reorder'); expect(apiFetch).not.toHaveBeenCalled();
  mockCart.isCartHydrated = true; await rerender(); await tap('Reorder'); mockCart.isCartHydrating = true; await rerender(); await tap('Add to cart');
  expect(mockCart.addItem).not.toHaveBeenCalled();
});
test('expired review cannot be confirmed', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000); await mount(); await tap('Reorder'); now.mockReturnValue(122000);
  await tap('Add to cart'); expect(mockCart.addItem).not.toHaveBeenCalled(); now.mockRestore();
});
test('each eligible OrderRow has a sibling reorder action, independent of details navigation', async () => {
  const order = { id: 'past', location_id: 'original-store', status: 'DELIVERED', order_number: 42, fulfillment_type: 'DELIVERY', placed_at: '2026-10-01', final_payable_cents: 1800 };
  await act(async () => { renderer = create(React.createElement(OrderRow, { order })); });
  const card = renderer.root.findByProps({ accessibilityLabel: 'Order #42, delivered' });
  expect(card.findAllByProps({ accessibilityLabel: 'Reorder' })).toHaveLength(0);
  await tap('Reorder'); expect(mockRouter.push).not.toHaveBeenCalled();
  await tap('Cancel'); await act(async () => card.props.onPress()); expect(mockRouter.push).toHaveBeenCalledWith('/orders/past');
});
test.each(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'UNKNOWN'])('%s has no reorder action', async status => {
  await act(async () => { renderer = create(React.createElement(OrderRow, { order: { id: 'id', status, order_number: 1, fulfillment_type: 'PICKUP', placed_at: '2026-10-01', final_payable_cents: 1000 } })); });
  expect(button('Reorder')).toBeUndefined();
});
test.each([
  data => { data.items[0] = { ...item, quantity: -1 }; },
  data => { data.items[0] = { ...item, builder_payload: { builder_type: 'UNSUPPORTED' } }; },
  data => { data.location_id = 'forged-location'; },
  data => { data.all_unavailable = true; },
  data => { data.items[0] = { ...item, modifier_selections: [{}] }; },
])('malformed previews never reach cart', mutate => {
  const data = preview(); mutate(data); expect(() => parseReorderPreview(data, 'past', 'original-store')).toThrow();
});
