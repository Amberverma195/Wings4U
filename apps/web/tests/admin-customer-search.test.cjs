const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockSession = { refresh: jest.fn(), clear: jest.fn() };
const mockNavigate = jest.fn();
jest.mock('next/link', () => ({ __esModule: true, default: props => require('react').createElement('a', props) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockNavigate, replace: mockNavigate }) }));
jest.mock('@/lib/session', () => ({ useSession: () => mockSession, withSilentRefresh: jest.fn(callback => callback()) }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('@/lib/env', () => ({ DEFAULT_LOCATION_ID: 'restaurant-location' }));
jest.mock('@/components/order-chat', () => ({ OrderChat: props => require('react').createElement('div', { 'data-chat-order': props.orderId }) }));
jest.mock('@/components/payment-collection', () => ({ PaymentCollectionPanel: props => require('react').createElement('div', { 'data-payments-path': props.paymentsPath }) }));
const { apiFetch } = require('@/lib/api');
const { GlobalSearchClient } = require('../src/app/admin/search/search-client');
const { AdminCustomerModal } = require('../src/app/admin/search/admin-customer-modal');
const CUSTOMER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CUSTOMER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_ORDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DATE = '2026-10-15T12:34:56.789Z';
const base = id => `/api/v1/admin/customers/${id}`;
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => ({ data }) });
const profile = (id = CUSTOMER) => ({ id, display_name: id === CUSTOMER ? 'Brown' : 'Smith', first_name: null, last_name: null,
  primary_phone: id === CUSTOMER ? '+15195551234' : null, primary_email: id === CUSTOMER ? 'brown@example.com' : 'smith@example.com', created_at: DATE,
  saved_addresses: id === CUSTOMER ? [
    { id: 'home', label: 'Home', line1: '123 Main St', city: 'London', postal_code: 'N6A 1A1', is_default: true },
    { id: 'work', label: 'Work', line1: '42 Main St', city: 'London', postal_code: 'N6A 2A2', is_default: false },
  ] : [], default_address: null });
const orderRow = (id = ORDER) => ({ id, order_number: id === ORDER ? '1042' : '1043', status: 'DELIVERED',
  fulfillment_type: 'DELIVERY', placed_at: DATE, final_payable_cents: 1768 });
const detail = id => ({ ...orderRow(id), location_id: 'restaurant-location', customer_name_snapshot: 'Brown',
  customer_phone_snapshot: '+15195551234', customer_email_snapshot: 'brown@example.com', customer_order_notes: 'Ring bell',
  item_subtotal_cents: 1299, item_discount_total_cents: 0, order_discount_total_cents: 0, delivery_fee_cents: 300,
  tax_cents: 169, driver_tip_cents: 0, wallet_applied_cents: 0, address_snapshot_json: { line1: '123 Main St' },
  items: [{ id: 'line', quantity: 1, product_name_snapshot: 'Wings', line_total_cents: 1299,
    modifiers: [], flavours: [{ flavour_name_snapshot: 'Honey Garlic', placement: 'ON_SIDE' }], special_instructions: 'Extra crispy' }] });
const stamp = (redeemed = false) => ({ id: redeemed ? 'stamp-two' : 'stamp-one', entry_type: redeemed ? 'REDEEMED' : 'EARNED',
  delta_stamps: redeemed ? -8 : 2, balance_after_stamps: redeemed ? 0 : 5, pounds_awarded: redeemed ? null : 2,
  reason_text: redeemed ? 'Redeemed 1lb of wings free' : 'Earned 2 stamps', created_at: DATE,
  order_id: redeemed ? OTHER_ORDER : ORDER, order_number: redeemed ? '1043' : '1042', order_accessible: true });
const summary = { available_stamps: 5, lifetime_stamps: 21, lifetime_redemptions: 2, stamps_per_reward: 8, reward_available: false };
const search = { query: 'Brown', orders: [], tickets: [], customers: [
  { id: CUSTOMER, display_name: 'Brown' }, { id: OTHER_CUSTOMER, display_name: 'Smith' },
] };
const defaultFetch = async path => {
  if (path.startsWith('/api/v1/admin/search?')) return response(search);
  if (path.startsWith('/api/v1/orders/')) return response(detail(path.split('/').pop()));
  for (const id of [CUSTOMER, OTHER_CUSTOMER]) {
    if (path === base(id)) return response(profile(id));
    if (path.startsWith(`${base(id)}/orders?`)) return response(path.includes('cursor=')
      ? { orders: [orderRow(OTHER_ORDER)], next_cursor: null } : { orders: [orderRow()], next_cursor: 'orders-page-2' });
    if (path.startsWith(`${base(id)}/stamps?`)) return response(path.includes('cursor=')
      ? { summary, entries: [stamp(true)], next_cursor: null } : { summary, entries: [stamp()], next_cursor: 'stamps-page-2' });
  }
  throw new Error(`Unexpected endpoint ${path}`);
};
let renderer;
const dialogs = () => renderer.root.findAllByProps({ role: 'dialog' });
const customerDialog = () => renderer.root.findByProps({ 'aria-labelledby': 'admin-customer-title' });
const text = () => JSON.stringify(renderer.toJSON());
const textOf = node => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const button = (label, scope = renderer.root) => scope.findAllByType('button').find(node => textOf(node) === label);
const tap = async label => act(async () => button(label).props.onClick());
const openCustomer = async (name = 'Brown', currentTarget = null) => act(async () =>
  renderer.root.findByProps({ 'aria-label': `View customer ${name}` }).props.onClick({ currentTarget }));
const expand = async () => act(async () => renderer.root.findByProps({ 'aria-controls': 'admin-customer-orders' }).props.onClick());
const expandStamps = async () => act(async () => renderer.root.findByProps({ 'aria-controls': 'admin-customer-stamps' }).props.onClick());
const searchCalls = () => apiFetch.mock.calls.filter(([path]) => path.startsWith('/api/v1/admin/search?'));
const mount = async options => {
  await act(async () => { renderer = create(React.createElement(GlobalSearchClient), options); });
  await act(async () => renderer.root.findByProps({ type: 'search' }).props.onChange({ target: { value: 'Brown' } }));
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
};
beforeEach(() => { jest.clearAllMocks(); apiFetch.mockImplementation(defaultFetch); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('customer buttons open contact/address/reward details on the search page and preserve the search on close', async () => {
  await mount();
  const results = JSON.stringify(renderer.toJSON());
  await openCustomer();
  expect(dialogs()).toHaveLength(1);
  for (const value of ['Brown','+15195551234','brown@example.com','Home','(Default)','123 Main St','Work','N6A 2A2','Wings Rewards']) expect(text()).toContain(value);
  expect(customerDialog().findAllByType('address')[0].children[0].children).toContain('Home');
  expect(renderer.root.findByType('progress').props).toEqual(expect.objectContaining({ max: 8, value: 5 }));
  const paragraphs = customerDialog().findAllByType('p').map(textOf);
  expect(paragraphs).toContain('Lifetime stamps earned: 21');
  expect(paragraphs).toContain('Lifetime rewards redeemed: 2');
  expect(renderer.root.findByProps({ 'aria-controls': 'admin-customer-orders' }).props['aria-expanded']).toBe(false);
  expect(apiFetch.mock.calls.some(([path]) => path.includes('/orders?'))).toBe(false);
  expect(renderer.root.findByProps({ type: 'search' }).props.value).toBe('Brown');
  await tap('Close customer');
  expect(dialogs()).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toBe(results);
  expect(searchCalls()).toHaveLength(1);
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('orders and stamps paginate independently; existing order details return to the same expanded profile and loaded pages', async () => {
  await mount(); await openCustomer(); await expand(); await expandStamps();
  await tap('Load more orders'); await tap('Load more history');
  expect(customerDialog().findAllByProps({ 'aria-label': 'View order #1043' })).toHaveLength(1);
  expect(text()).toContain('REDEEMED');
  const callsBeforeOrder = apiFetch.mock.calls.filter(([path]) => path.startsWith(base(CUSTOMER))).length;
  await act(async () => customerDialog().findByProps({ 'aria-label': 'View order #1042' }).props.onClick({ currentTarget: null }));
  expect(dialogs()).toHaveLength(1);
  expect(dialogs()[0].props['aria-labelledby']).toBe('admin-order-detail-title');
  expect(renderer.root.findByType(AdminCustomerModal).props.suspended).toBe(true);
  for (const value of ['Wings','Honey Garlic','Extra crispy','Ring bell','$17.68']) expect(text()).toContain(value);
  expect(renderer.root.findByProps({ 'data-chat-order': ORDER })).toBeDefined();
  expect(renderer.root.findByProps({ 'data-payments-path': `/api/v1/orders/${ORDER}/payments` })).toBeDefined();
  await tap('Close');
  expect(dialogs()).toHaveLength(1);
  expect(customerDialog()).toBeDefined();
  expect(renderer.root.findByProps({ 'aria-controls': 'admin-customer-orders' }).props['aria-expanded']).toBe(true);
  expect(customerDialog().findAllByProps({ 'aria-label': 'View order #1043' })).toHaveLength(1);
  expect(text()).toContain('REDEEMED');
  expect(apiFetch.mock.calls.filter(([path]) => path.startsWith(base(CUSTOMER)))).toHaveLength(callsBeforeOrder);
  await expand(); await expand();
  expect(apiFetch.mock.calls.filter(([path]) => path.startsWith(base(CUSTOMER)))).toHaveLength(callsBeforeOrder);
  expect(searchCalls()).toHaveLength(1);
  expect(apiFetch.mock.calls.some(([path]) => path.includes('/orders?limit=20&cursor=orders-page-2'))).toBe(true);
  expect(apiFetch.mock.calls.some(([path]) => path.includes('/stamps?limit=20&cursor=stamps-page-2'))).toBe(true);
});

test('stamp history starts collapsed, retains loaded pages on toggle and stays expanded after viewing a linked order', async () => {
  await mount(); await openCustomer();
  const disclosure = () => renderer.root.findByProps({ 'aria-controls': 'admin-customer-stamps' });
  const history = () => renderer.root.findByProps({ id: 'admin-customer-stamps' });
  expect(disclosure().props['aria-expanded']).toBe(false);
  expect(history().props.hidden).toBe(true);
  expect(renderer.root.findByType('progress').props.value).toBe(5);
  await expandStamps();
  expect(disclosure().props['aria-expanded']).toBe(true);
  expect(history().props.hidden).toBe(false);
  await tap('Load more history');
  const callsBeforeToggle = apiFetch.mock.calls.length;
  await expandStamps();
  expect(history().props.hidden).toBe(true);
  await expandStamps();
  expect(history().props.hidden).toBe(false);
  expect(textOf(history())).toContain('REDEEMED · -8 stamps');
  expect(apiFetch.mock.calls).toHaveLength(callsBeforeToggle);
  expect(renderer.root.findByProps({ 'aria-controls': 'admin-customer-orders' }).props['aria-expanded']).toBe(false);
  await act(async () => button('Order #1043', history()).props.onClick({ currentTarget: null }));
  expect(dialogs()[0].props['aria-labelledby']).toBe('admin-order-detail-title');
  await tap('Close');
  expect(disclosure().props['aria-expanded']).toBe(true);
  expect(history().props.hidden).toBe(false);
  expect(textOf(history())).toContain('REDEEMED · -8 stamps');
  expect(renderer.root.findByProps({ type: 'search' }).props.value).toBe('Brown');
  expect(searchCalls()).toHaveLength(1);
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('phone/address omissions, empty orders and empty stamp history render safely', async () => {
  apiFetch.mockImplementation(path => path.startsWith(`${base(OTHER_CUSTOMER)}/orders?`) ? Promise.resolve(response({ orders: [], next_cursor: null }))
    : path.startsWith(`${base(OTHER_CUSTOMER)}/stamps?`) ? Promise.resolve(response({ summary: { ...summary, available_stamps: 0, lifetime_stamps: 0, lifetime_redemptions: 0 }, entries: [], next_cursor: null })) : defaultFetch(path));
  await mount(); await openCustomer('Smith'); await expand(); await expandStamps();
  for (const value of ['No phone number.','No saved addresses.','No orders at this restaurant.','No stamp history yet.']) expect(text()).toContain(value);
});

test('earn/redemption timestamps and signed deltas remain exact even with zero available stamps', async () => {
  apiFetch.mockImplementation(path => path.startsWith(`${base(CUSTOMER)}/stamps?`)
    ? Promise.resolve(response({ summary: { ...summary, available_stamps: 0 }, entries: [stamp(), stamp(true)], next_cursor: null })) : defaultFetch(path));
  await mount(); await openCustomer(); await expandStamps();
  const events = customerDialog().findAllByType('strong').map(textOf);
  expect(events).toContain('EARNED · +2 stamps');
  expect(events).toContain('REDEEMED · -8 stamps');
  expect(renderer.root.findAllByType('time').filter(node => node.props.dateTime === DATE).length).toBeGreaterThanOrEqual(3);
  expect(renderer.root.findByType('progress').props.value).toBe(0);
  expect(text()).toContain('REDEEMED');
});

test('uses the backend reward threshold and never calls customer-only rewards endpoints', async () => {
  apiFetch.mockImplementation(path => path.startsWith(`${base(CUSTOMER)}/stamps?`)
    ? Promise.resolve(response({ summary: { ...summary, available_stamps: 10, stamps_per_reward: 10, reward_available: true }, entries: [], next_cursor: null })) : defaultFetch(path));
  await mount(); await openCustomer();
  expect(renderer.root.findByType('progress').props.max).toBe(10);
  expect(text()).toContain('Free 1lb Wings reward available.');
  expect(apiFetch.mock.calls.some(([path]) => path.startsWith('/api/v1/rewards/me'))).toBe(false);
  expect(apiFetch.mock.calls.filter(([path]) => path.startsWith(base(CUSTOMER))).every(([, options]) => options.locationId === 'restaurant-location')).toBe(true);
});

test('restricted stamp entries contain no clickable external order metadata', async () => {
  apiFetch.mockImplementation(path => path.startsWith(`${base(CUSTOMER)}/stamps?`) ? Promise.resolve(response({ summary, entries: [{
    ...stamp(), order_id: null, order_number: null, order_accessible: false, pounds_awarded: null, reason_text: 'Stamps earned at another restaurant.',
  }], next_cursor: null })) : defaultFetch(path));
  await mount(); await openCustomer(); await expandStamps();
  expect(customerDialog().findAllByType('button').some(node => textOf(node).startsWith('Order #'))).toBe(false);
  expect(text()).toContain('Stamps earned at another restaurant.');
});

test('switching profiles invalidates late responses and closes obsolete requests', async () => {
  let resolve;
  apiFetch.mockImplementation(path => path === base(CUSTOMER) ? new Promise(done => { resolve = done; }) : defaultFetch(path));
  await mount(); await openCustomer();
  expect(text()).toContain('Loading customer profile');
  const signal = apiFetch.mock.calls.find(([path]) => path === base(CUSTOMER))[1].signal;
  await openCustomer('Smith');
  await act(async () => resolve(response(profile())));
  expect(signal.aborted).toBe(true);
  expect(text()).toContain('smith@example.com');
  expect(text()).not.toContain('brown@example.com');
  expect(searchCalls()).toHaveLength(1);
});

test('closing a loading customer aborts requests and late responses cannot reopen the modal', async () => {
  let resolve;
  apiFetch.mockImplementation(path => path === base(CUSTOMER) ? new Promise(done => { resolve = done; }) : defaultFetch(path));
  await mount(); await openCustomer();
  const signal = apiFetch.mock.calls.find(([path]) => path === base(CUSTOMER))[1].signal;
  await tap('Close customer');
  await act(async () => resolve(response(profile())));
  expect(signal.aborted).toBe(true);
  expect(dialogs()).toHaveLength(0);
  expect(searchCalls()).toHaveLength(1);
});

test('profile errors are readable and Retry loads the profile without rerunning search', async () => {
  let fail = true;
  apiFetch.mockImplementation(path => path === base(CUSTOMER) && fail ? Promise.resolve(response(null, 503)) : defaultFetch(path));
  await mount(); await openCustomer();
  expect(text()).toContain('Unable to load customer information (503)');
  fail = false;
  await tap('Retry');
  expect(text()).toContain('brown@example.com');
  expect(searchCalls()).toHaveLength(1);
});

test('an inaccessible order leaves the customer dialog active and usable', async () => {
  apiFetch.mockImplementation(path => path.startsWith('/api/v1/orders/') ? Promise.resolve(response(null, 403)) : defaultFetch(path));
  await mount(); await openCustomer(); await expand();
  await act(async () => customerDialog().findByProps({ 'aria-label': 'View order #1042' }).props.onClick({ currentTarget: null }));
  expect(dialogs()).toHaveLength(1);
  expect(customerDialog()).toBeDefined();
  expect(text()).toContain('do not have access');
  await tap('Dismiss order error');
  expect(text()).not.toContain('do not have access');
});

test('customer/order transitions keep one keyboard trap and restore customer-row then search-trigger focus', async () => {
  const originalDocument = global.document;
  const originalElement = global.HTMLElement;
  const listeners = new Map();
  const nodes = [];
  class Element {
    constructor(group, label) { this.group = group; this.label = label; this.tabIndex = 0; this.isConnected = true; nodes.push(this); }
    focus() { document.activeElement = this; }
    matches() { return false; }
    closest() { return null; }
    getClientRects() { return [{}]; }
  }
  global.HTMLElement = Element;
  const trigger = new Element('search', 'customer-trigger');
  global.document = { activeElement: trigger, body: { style: { overflow: 'auto' } },
    addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn) };
  try {
    await mount({ createNodeMock: element => {
      if (element.props.role === 'dialog') {
        const group = element.props['aria-labelledby'] === 'admin-customer-title' ? 'customer' : 'order';
        nodes.filter(node => node.group !== group && node.group !== 'search').forEach(node => { node.isConnected = false; });
        const dialog = new Element(group, 'dialog');
        dialog.contains = node => node?.isConnected && node.group === group;
        dialog.querySelectorAll = () => nodes.filter(node => node.isConnected && node.group === group && node.label !== 'dialog');
        return dialog;
      }
      if (element.type === 'button') return new Element(element.props.children === 'Close' ? 'order' : 'customer',
        element.props['aria-label'] ?? element.props.children);
      return null;
    } });
    await openCustomer('Brown', trigger);
    expect(listeners.get('keydown').size).toBe(1);
    expect(document.activeElement.label).toBe('Close customer');
    await expand();
    const row = nodes.find(node => node.label === 'View order #1042' && node.isConnected);
    await act(async () => customerDialog().findByProps({ 'aria-label': 'View order #1042' }).props.onClick({ currentTarget: row }));
    expect(listeners.get('keydown').size).toBe(1);
    expect(document.activeElement.group).toBe('order');
    const escape = async () => act(async () => Array.from(listeners.get('keydown')).forEach(fn =>
      fn({ key: 'Escape', preventDefault() {}, stopPropagation() {} })));
    await escape();
    expect(dialogs()).toHaveLength(1);
    expect(listeners.get('keydown').size).toBe(1);
    expect(document.activeElement.group).toBe('customer');
    expect(document.activeElement.label).toBe('View order #1042');
    await escape();
    expect(dialogs()).toHaveLength(0);
    expect(listeners.get('keydown').size).toBe(0);
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('auto');
  } finally {
    if (renderer) await act(async () => renderer.unmount()); renderer = null;
    global.document = originalDocument; global.HTMLElement = originalElement;
  }
});
