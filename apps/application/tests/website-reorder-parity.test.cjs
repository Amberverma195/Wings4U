// Exercise the actual website component with offline native-test-renderer host mocks.
const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockCart = { locationId: 'store', addItem: jest.fn() };
const mockRouter = { push: jest.fn() };
const mockSession = { refresh: jest.fn(), clear: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('react-dom', () => ({ createPortal: children => children }));
jest.mock('@/lib/cart', () => ({ useCart: () => mockCart }), { virtual: true });
jest.mock('@/lib/session', () => ({ useSession: () => mockSession, withSilentRefresh: call => call() }), { virtual: true });
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }), { virtual: true });
jest.mock('@/lib/use-modal-dialog', () => ({ useModalDialog: jest.fn() }), { virtual: true });
const { apiFetch } = require('@/lib/api');
const { ReorderButton } = require('../../web/src/components/' + 'reorder-button');
let renderer;
const data = () => ({ order_id: 'past', location_id: 'store', fulfillment_type_hint: 'PICKUP', all_unavailable: false,
  items: [{ menu_item_id: 'burger', name: 'Burger', quantity: 2, base_price_cents: 1500, modifier_selections: [], removed_ingredients: [], special_instructions: '', builder_payload: null }],
  diff: { skipped: [], modifier_changes: [], price_changes: [{ name: 'Burger', old_cents: 1400, new_cents: 1500 }], configuration_changes: [{ name: 'Burger', changes: ['Old cheese → New cheese'] }] } });
const button = label => renderer.root.findAllByType('button').find(node => node.children.join('') === label);
const tap = async label => act(async () => button(label).props.onClick({ preventDefault() {}, stopPropagation() {} }));
beforeEach(async () => {
  jest.clearAllMocks(); global.document = { body: { style: {} } }; global.window = { addEventListener: jest.fn(), removeEventListener: jest.fn() };
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ data: data() }) });
  await act(async () => { renderer = create(React.createElement(ReorderButton, { orderId: 'past', locationId: 'store' })); });
});
afterEach(async () => { await act(async () => renderer.unmount()); delete global.document; delete global.window; });
test('web still sends its existing preview request and adds only after confirmation', async () => {
  await tap('Order again');
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/orders/past/reorder', expect.objectContaining({ method: 'POST', locationId: 'store' }));
  expect(mockCart.addItem).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('Configuration changes');
  expect(JSON.stringify(renderer.toJSON())).toContain('Old cheese');
  await tap('Add to cart'); expect(mockCart.addItem).toHaveBeenCalledTimes(1); expect(mockRouter.push).toHaveBeenCalledWith('/cart');
});
test('web cancel and all-unavailable retain the established contract', async () => {
  await tap('Order again'); await tap('Cancel'); expect(mockCart.addItem).not.toHaveBeenCalled();
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { ...data(), items: [], all_unavailable: true } }) });
  await tap('Order again'); expect(button('Add to cart')).toBeUndefined(); await tap('Close');
  expect(mockCart.addItem).not.toHaveBeenCalled(); expect(mockRouter.push).not.toHaveBeenCalled();
});
