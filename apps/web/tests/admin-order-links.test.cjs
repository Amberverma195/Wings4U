const React = require('react');
const { act, create } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
let mockUrl;
const mockListeners = new Set();
const mockNavigate = href => {
  mockUrl = new URL(href, 'http://localhost');
  for (const listener of mockListeners) listener();
};
const mockRouter = { push: jest.fn(mockNavigate), replace: jest.fn(mockNavigate) };
const mockSession = { refresh: jest.fn(), clear: jest.fn() };

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockUrl.pathname,
  useSearchParams: () => {
    const React = require('react');
    const search = React.useSyncExternalStore(listener => {
      mockListeners.add(listener);
      return () => mockListeners.delete(listener);
    }, () => mockUrl.search);
    return new URLSearchParams(search);
  },
}));
jest.mock('next/link', () => ({ __esModule: true, default: props => {
  const React = require('react');
  return React.createElement('a', { ...props, onClick: () => mockRouter.push(props.href) });
} }));
jest.mock('@/lib/session', () => ({
  useSession: () => mockSession,
  withSilentRefresh: jest.fn(callback => callback()),
}));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('@/lib/env', () => ({ DEFAULT_LOCATION_ID: 'restaurant-location' }));
jest.mock('@/components/order-chat', () => ({ OrderChat: props => {
  const React = require('react');
  return React.createElement('div', { 'data-chat-order': props.orderId });
} }));
jest.mock('@/components/payment-collection', () => ({
  paymentStatusLabel: status => status,
  PaymentCollectionPanel: props => {
    const React = require('react');
    return React.createElement('div', { 'data-payments-path': props.paymentsPath });
  },
}));

const { apiFetch } = require('@/lib/api');
const { withSilentRefresh } = require('@/lib/session');
const { OrdersListClient } = require('../src/app/admin/orders/orders-list-client');
const { GlobalSearchClient } = require('../src/app/admin/search/search-client');
const { ApprovalsClient } = require('../src/app/admin/approvals/approvals-client');
const { SupportDetailClient } = require('../src/app/admin/support/[id]/support-detail-client');
const ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => ({ data }) });
const order = (id = ORDER_ID) => ({
  id, order_number: id === ORDER_ID ? 1042 : 1043, status: 'DELIVERED', fulfillment_type: 'DELIVERY',
  customer_name_snapshot: 'Test Customer', customer_phone_snapshot: '5195551234',
  placed_at: '2026-10-01T17:00:00Z', estimated_ready_at: null,
  address_snapshot_json: { line1: 'Test street', city: 'London', postalCode: 'N6A 1A1' },
  customer_order_notes: 'Test order notes', item_subtotal_cents: 1299,
  item_discount_total_cents: 0, order_discount_total_cents: 0, delivery_fee_cents: 300,
  tax_cents: 169, driver_tip_cents: 0, wallet_applied_cents: 0, final_payable_cents: 1768,
  items: [{ id: 'item', quantity: 1, product_name_snapshot: 'Wings', line_total_cents: 1299,
    flavours: [{ flavour_name_snapshot: 'Honey Garlic', heat_level_snapshot: null, placement: 'ON_SIDE' }],
    modifiers: [{ modifier_kind: 'ADD', modifier_name_snapshot: 'Ranch dip', quantity: 1 }],
    special_instructions: 'Sauce on the side' }],
});
let renderer;
const mount = async Component => act(async () => { renderer = create(React.createElement(Component)); });
const navigate = async href => act(async () => mockNavigate(href));
const text = () => JSON.stringify(renderer.toJSON());
const dialogs = () => renderer.root.findAllByProps({ role: 'dialog' });
const button = label => renderer.root.findAllByType('button').find(node => node.children.join('') === label);
const tap = async label => act(async () => button(label).props.onClick());
const detailCalls = () => apiFetch.mock.calls.filter(([path]) => /^\/api\/v1\/orders\/[^?]+$/.test(path));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => {
  jest.clearAllMocks();
  mockUrl = new URL('http://localhost/admin/orders');
  mockListeners.clear();
  apiFetch.mockImplementation(async path => path.startsWith('/api/v1/orders?')
    ? response({ orders: [order(OTHER_ID)], next_cursor: 'another-page' })
    : response(order(path.split('/').pop())));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('Global Search customer → order link → existing modal with items and complete details', async () => {
  apiFetch.mockImplementation(async path => {
    if (path.startsWith('/api/v1/admin/search?')) return response({ orders: [order()], tickets: [], customers: [] });
    if (path.startsWith('/api/v1/orders?')) return response({ orders: [], next_cursor: 'page-2' });
    return response(order());
  });
  await mount(GlobalSearchClient);
  await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: 'Test Customer' } }));
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(apiFetch.mock.calls[0][0]).toBe('/api/v1/admin/search?q=Test%20Customer');
  const link = renderer.root.findByType('a');
  expect(link.props.href).toBe(`/admin/orders?orderId=${ORDER_ID}`);
  await act(async () => { link.props.onClick(); renderer.update(React.createElement(OrdersListClient)); });
  expect(dialogs()).toHaveLength(1);
  for (const value of ['Wings', 'Honey Garlic', 'Ranch dip', 'Sauce on the side',
    'Customer notes:', 'Delivery address:', 'Pricing Summary', 'Total']) expect(text()).toContain(value);
  expect(renderer.root.findByProps({ 'data-chat-order': ORDER_ID })).toBeDefined();
  expect(renderer.root.findByProps({ 'data-payments-path': `/api/v1/orders/${ORDER_ID}/payments` })).toBeDefined();
  expect(detailCalls()).toHaveLength(1);
  expect(detailCalls()[0][1]).toEqual(expect.objectContaining({ locationId: 'restaurant-location', signal: expect.any(AbortSignal) }));
  expect(withSilentRefresh).toHaveBeenCalledWith(expect.any(Function), mockSession.refresh, mockSession.clear);
});

test('a selected order loads independently of current filters and pagination', async () => {
  await mount(OrdersListClient);
  await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'READY' } }));
  await act(async () => renderer.root.findByProps({ type: 'date' }).props.onChange({ target: { value: '2026-10-15' } }));
  await navigate(`/admin/orders?orderId=${ORDER_ID}&source=search`);
  expect(apiFetch.mock.calls.some(([path]) => path.includes('status=READY&placed_on=2026-10-15'))).toBe(true);
  expect(detailCalls()[0][0]).toBe(`/api/v1/orders/${ORDER_ID}`);
  expect(dialogs()).toHaveLength(1);
  await tap('Close');
  expect(mockRouter.replace).toHaveBeenCalledWith('/admin/orders?source=search', { scroll: false });
  expect(dialogs()).toHaveLength(0);
  expect(renderer.root.findByType('select').props.value).toBe('READY');
  expect(renderer.root.findByProps({ type: 'date' }).props.value).toBe('2026-10-15');
});

test('ordinary View buttons use the same URL and closing leaves no empty query string', async () => {
  await mount(OrdersListClient);
  expect(detailCalls()).toHaveLength(0);
  await tap('View');
  expect(mockRouter.push).toHaveBeenCalledWith(`/admin/orders?orderId=${OTHER_ID}`, { scroll: false });
  expect(dialogs()).toHaveLength(1);
  await tap('Close');
  expect(mockRouter.replace).toHaveBeenCalledWith('/admin/orders', { scroll: false });
  expect(dialogs()).toHaveLength(0);
});

test('list failure does not prevent directly opening an accessible order', async () => {
  mockUrl.search = `?orderId=${ORDER_ID}`;
  apiFetch.mockImplementation(async path => path.startsWith('/api/v1/orders?') ? response(null, 500) : response(order()));
  await mount(OrdersListClient);
  expect(dialogs()).toHaveLength(1);
});

test.each([[404, 'could not be found'], [403, 'do not have access'], [500, 'Unable to load order details']])(
  'HTTP %s shows a readable error and can dismiss the selected order', async (status, message) => {
    mockUrl.search = `?orderId=${ORDER_ID}`;
    apiFetch.mockImplementation(async path => path.startsWith('/api/v1/orders?')
      ? response({ orders: [], next_cursor: null }) : response(null, status));
    await mount(OrdersListClient);
    expect(dialogs()).toHaveLength(0);
    expect(renderer.root.findByProps({ role: 'alert' })).toBeDefined();
    expect(text()).toContain(message);
    await tap('Dismiss');
    expect(mockUrl.searchParams.has('orderId')).toBe(false);
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  },
);

test.each(['not-a-uuid', ''])('invalid orderId %p does not fetch an arbitrary API path', async value => {
  mockUrl.search = `?orderId=${value}`;
  await mount(OrdersListClient);
  expect(detailCalls()).toHaveLength(0);
  expect(text()).toContain('Invalid order link');
});

test('URL changes abort old requests so a slow response cannot replace the selected order', async () => {
  const slow = deferred();
  mockUrl.search = `?orderId=${ORDER_ID}`;
  apiFetch.mockImplementation(async path => path === `/api/v1/orders/${ORDER_ID}` ? slow.promise :
    path.startsWith('/api/v1/orders?') ? response({ orders: [], next_cursor: null }) : response(order(OTHER_ID)));
  await mount(OrdersListClient);
  expect(renderer.root.findByProps({ role: 'status' })).toBeDefined();
  const firstSignal = detailCalls()[0][1].signal;
  await navigate(`/admin/orders?orderId=${OTHER_ID}`);
  expect(firstSignal.aborted).toBe(true);
  await act(async () => slow.resolve(response(order())));
  expect(dialogs()).toHaveLength(1);
  expect(renderer.root.findByProps({ 'data-chat-order': OTHER_ID })).toBeDefined();
});

test('removing orderId while loading prevents the modal reopening when the request completes', async () => {
  const slow = deferred();
  mockUrl.search = `?orderId=${ORDER_ID}`;
  apiFetch.mockImplementation(async path => path.startsWith('/api/v1/orders?')
    ? response({ orders: [], next_cursor: null }) : slow.promise);
  await mount(OrdersListClient);
  const signal = detailCalls()[0][1].signal;
  await navigate('/admin/orders');
  await act(async () => slow.resolve(response(order())));
  expect(signal.aborted).toBe(true);
  expect(dialogs()).toHaveLength(0);
  expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0);
});

test('back and forward URL changes close and reopen the matching modal', async () => {
  mockUrl.search = `?orderId=${ORDER_ID}`;
  await mount(OrdersListClient);
  await navigate('/admin/orders');
  expect(dialogs()).toHaveLength(0);
  await navigate(`/admin/orders?orderId=${ORDER_ID}`);
  expect(dialogs()).toHaveLength(1);
});

test('both approval lists link to the existing orders page without changing approval actions', async () => {
  const request = { id: 'request', order_id: ORDER_ID, order: order(), status: 'PENDING', created_at: order().placed_at };
  apiFetch.mockResolvedValue(response({ items: [request] }));
  await mount(ApprovalsClient);
  expect(renderer.root.findByType('a').props.href).toBe(`/admin/orders?orderId=${ORDER_ID}`);
  await tap('Refunds');
  expect(renderer.root.findByType('a').props.href).toBe(`/admin/orders?orderId=${ORDER_ID}`);
  expect(apiFetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
});

test('support related-order link uses the same modal deep link', async () => {
  apiFetch.mockResolvedValue(response({ id: 'ticket', order_id: ORDER_ID, subject: 'Test ticket',
    status: 'OPEN', messages: [], events: [], resolutions: [], created_at: order().placed_at }));
  await mount(() => React.createElement(SupportDetailClient, { ticketId: 'ticket' }));
  expect(renderer.root.findAllByType('a').some(link => link.props.href === `/admin/orders?orderId=${ORDER_ID}`)).toBe(true);
});
