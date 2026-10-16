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
  total_order_count: id === CUSTOMER ? 42 : 0,
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
  expect(paragraphs).toContain('Total orders: 42 (this restaurant)');
  const accountInfo = customerDialog().findAllByProps({ className: 'admin-customer-account-info' });
  expect(accountInfo.map(textOf)[0]).toContain('Account created');
  expect(accountInfo.map(textOf)[1]).toBe('Total orders: 42 (this restaurant)');
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

const grantDialog = () => renderer.root.findByProps({ 'aria-labelledby': 'admin-stamp-grant-title' });
const setGrantField = async (id, value) => act(async () => grantDialog().findByProps({ id }).props.onChange({ target: { value } }));
const fillGrant = async (amount = '2', reason = 'SERVICE_RECOVERY', note = '') => {
  await setGrantField('admin-stamp-count', amount); await setGrantField('admin-stamp-reason', reason);
  await setGrantField('admin-stamp-note', note);
};
const submitGrant = async () => act(async () => grantDialog().findByType('form').props.onSubmit({ preventDefault() {} }));
const grantEntry = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', entry_type: 'ADMIN_GRANTED', delta_stamps: 2,
  balance_after_stamps: 7, pounds_awarded: null, reason_text: 'Gifted by Wings 4 U — courtesy stamps added.',
  created_at: DATE, order_id: null, order_number: null, order_accessible: false };
const granted = { grant_id: grantEntry.id, stamps_granted: 2, replayed: false, entry: grantEntry,
  summary: { ...summary, available_stamps: 7, lifetime_stamps: 23 },
  email: { status: 'SENT', message: 'Notification email accepted by the email provider.', retryable: false } };
const grantCalls = () => apiFetch.mock.calls.filter(([path]) => path.endsWith('/stamps/grant'));

test('grant cancellation returns to expanded history without requesting a mutation or rerunning search', async () => {
  await mount(); await openCustomer(); await expand(); await expandStamps();
  await tap('Load more orders'); await tap('Load more history');
  await tap('Give Stamps');
  expect(dialogs()).toHaveLength(1); expect(grantDialog()).toBeDefined();
  expect(text()).toContain('Remaining capacity:');
  await tap('Cancel');
  expect(customerDialog()).toBeDefined(); expect(grantCalls()).toHaveLength(0);
  expect(renderer.root.findByProps({ 'aria-controls': 'admin-customer-orders' }).props['aria-expanded']).toBe(true);
  expect(renderer.root.findByProps({ 'aria-controls': 'admin-customer-stamps' }).props['aria-expanded']).toBe(true);
  expect(text()).toContain('REDEEMED'); expect(searchCalls()).toHaveLength(1);
});

test.each(['', '0', '-1', '1.5', 'NaN', '4'])('invalid grant amount %s disables submission', async amount => {
  await mount(); await openCustomer(); await tap('Give Stamps'); await fillGrant(amount);
  expect(button('Give Stamps', grantDialog()).props.disabled).toBe(true);
  await submitGrant(); expect(grantCalls()).toHaveLength(0);
});

test('grant validation requires a reason and an explanation for Other, using the backend capacity', async () => {
  apiFetch.mockImplementation(path => path.includes('/stamps?') ? Promise.resolve(response({ summary: { ...summary, available_stamps: 6 }, entries: [], next_cursor: null })) : defaultFetch(path));
  await mount(); await openCustomer(); await tap('Give Stamps');
  expect(grantDialog().findByProps({ id: 'admin-stamp-count' }).props.max).toBe(2);
  await fillGrant('2', ''); expect(button('Give Stamps', grantDialog()).props.disabled).toBe(true);
  await fillGrant('2', 'OTHER', '  '); expect(button('Give Stamps', grantDialog()).props.disabled).toBe(true);
  await fillGrant('2', 'OTHER', 'Missing sauce'); expect(button('Give Stamps', grantDialog()).props.disabled).toBe(false);
  await fillGrant('5'); expect(button('Give Stamps', grantDialog()).props.disabled).toBe(true);
});

test('Give Stamps is disabled for a full card and unavailable stamp data', async () => {
  let resolve;
  apiFetch.mockImplementation(path => path.includes('/stamps?') ? new Promise(done => { resolve = done; }) : defaultFetch(path));
  await mount(); await openCustomer();
  expect(button('Give Stamps').props.disabled).toBe(true);
  await act(async () => resolve(response({ summary: { ...summary, available_stamps: 8 }, entries: [], next_cursor: null })));
  expect(button('Give Stamps').props.disabled).toBe(true);
  expect(button('Give Stamps').parent.props.title).toContain('redeem');
});

test('successful grant updates summary and history while preserving loaded orders, stamp pages and search', async () => {
  let complete = false;
  apiFetch.mockImplementation((path, options) => {
    if (path.endsWith('/stamps/grant')) { complete = true; return Promise.resolve(response(granted)); }
    if (path.includes('/stamps?') && complete) return Promise.resolve(response({ summary: granted.summary, entries: [grantEntry, stamp()], next_cursor: 'stamps-page-2' }));
    return defaultFetch(path, options);
  });
  await mount(); await openCustomer(); await expand(); await expandStamps();
  await tap('Load more orders'); await tap('Load more history');
  const orderReads = apiFetch.mock.calls.filter(([path]) => path.includes('/orders?')).length;
  await tap('Give Stamps'); await fillGrant(); await submitGrant();
  expect(dialogs()).toHaveLength(1); expect(customerDialog()).toBeDefined();
  expect(renderer.root.findByType('progress').props.value).toBe(7);
  expect(text()).toContain('Gifted by Wings 4 U'); expect(text()).toContain('REDEEMED');
  expect(customerDialog().findAllByType('p').map(textOf)).toContain('Lifetime stamps earned: 23');
  expect(textOf(customerDialog())).toContain("2 stamps added to Brown's account.");
  expect(renderer.root.findByProps({ 'aria-controls': 'admin-customer-orders' }).props['aria-expanded']).toBe(true);
  expect(renderer.root.findByProps({ 'aria-controls': 'admin-customer-stamps' }).props['aria-expanded']).toBe(true);
  expect(customerDialog().findAllByProps({ 'aria-label': 'View order #1043' })).toHaveLength(1);
  expect(apiFetch.mock.calls.filter(([path]) => path.includes('/orders?'))).toHaveLength(orderReads);
  expect(searchCalls()).toHaveLength(1); expect(mockNavigate).not.toHaveBeenCalled();
  const request = grantCalls()[0][1];
  expect(request.method).toBe('POST'); expect(request.locationId).toBe('restaurant-location');
  expect(JSON.parse(request.body)).toEqual({ stamps: 2, reason: 'SERVICE_RECOVERY', request_id: expect.stringMatching(/^[a-f0-9-]{36}$/) });
});

test('provider failure is separate from grant success, and notification retry cannot regrant stamps', async () => {
  apiFetch.mockImplementation(path => path.endsWith('/stamps/grant') ? Promise.resolve(response({ ...granted, email: { status: 'FAILED', message: 'Email provider unavailable.', retryable: true } }))
    : path.endsWith('/email/retry') ? Promise.resolve(response(granted.email)) : defaultFetch(path));
  await mount(); await openCustomer(); await tap('Give Stamps'); await fillGrant(); await submitGrant();
  expect(text()).toContain('Stamps were added successfully'); expect(text()).toContain('Email provider unavailable.');
  await tap('Retry notification email');
  expect(text()).toContain('accepted by the email provider'); expect(grantCalls()).toHaveLength(1);
  expect(apiFetch.mock.calls.some(([path]) => path.endsWith(`/${granted.grant_id}/email/retry`))).toBe(true);
});

test('uncertain grant retry retains its UUID and prevents double submission, including after cancel/reopen', async () => {
  let resolve;
  apiFetch.mockImplementation(path => path.endsWith('/stamps/grant') ? new Promise(done => { resolve = done; }) : defaultFetch(path));
  await mount(); await openCustomer(); await tap('Give Stamps'); await fillGrant();
  await submitGrant(); await submitGrant();
  expect(grantCalls()).toHaveLength(1); expect(button('Adding stamps...').props.disabled).toBe(true);
  await act(async () => resolve(response(null, 503)));
  expect(button('Retry same grant').props.disabled).toBe(false);
  expect(grantDialog().findByProps({ id: 'admin-stamp-count' }).props.disabled).toBe(true);
  const original = JSON.parse(grantCalls()[0][1].body);
  await tap('Cancel'); await tap('Give Stamps');
  await submitGrant(); expect(JSON.parse(grantCalls()[1][1].body)).toEqual(original);
  await act(async () => resolve(response(granted)));
});

test('an unresolved grant survives closing the customer profile and reuses its UUID after reopening', async () => {
  const originalStorage = global.sessionStorage;
  const values = new Map();
  global.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let failed = false;
  apiFetch.mockImplementation(path => path.endsWith('/stamps/grant') ? Promise.resolve(failed ? response(granted) : (failed = true, response(null, 503))) : defaultFetch(path));
  try {
    await mount(); await openCustomer(); await tap('Give Stamps'); await fillGrant(); await submitGrant();
    const original = JSON.parse(grantCalls()[0][1].body);
    expect(values.size).toBe(1);
    await tap('Cancel'); await tap('Close customer');
    await openCustomer(); await tap('Give Stamps');
    expect(button('Retry same grant').props.disabled).toBe(false);
    expect(grantDialog().findByProps({ id: 'admin-stamp-count' }).props.value).toBe('2');
    await submitGrant();
    expect(JSON.parse(grantCalls()[1][1].body)).toEqual(original); expect(values.size).toBe(0);
    expect(searchCalls()).toHaveLength(1);
  } finally { global.sessionStorage = originalStorage; }
});

test('the grant form derives its maximum from the returned threshold instead of a frontend constant', async () => {
  apiFetch.mockImplementation(path => path.includes('/stamps?') ? Promise.resolve(response({ summary: { ...summary, available_stamps: 8, stamps_per_reward: 10 }, entries: [], next_cursor: null })) : defaultFetch(path));
  await mount(); await openCustomer(); expect(button('Give Stamps').props.disabled).toBe(false);
  await tap('Give Stamps'); expect(grantDialog().findByProps({ id: 'admin-stamp-count' }).props.max).toBe(2);
});

test('changed server balance is shown without optimistic credit and can be refreshed', async () => {
  apiFetch.mockImplementation(path => path.endsWith('/stamps/grant') ? Promise.resolve({ ok: false, status: 409, json: async () => ({ errors: [
    { code: 'STAMP_CAP_CHANGED', message: 'Stamp balance is now 7/8. You can add at most 1 stamps. Refresh the rewards and try again.' },
  ] }) }) : defaultFetch(path));
  await mount(); await openCustomer(); await tap('Give Stamps'); await fillGrant(); await submitGrant();
  expect(text()).toContain('at most 1 stamps'); expect(grantDialog()).toBeDefined();
  apiFetch.mockImplementation(path => path.includes('/stamps?') ? Promise.resolve(response({ summary: { ...summary, available_stamps: 7 }, entries: [stamp()], next_cursor: null })) : defaultFetch(path));
  await tap('Refresh rewards');
  expect(grantDialog().findByProps({ id: 'admin-stamp-count' }).props.max).toBe(1);
  expect(button('Give Stamps', grantDialog()).props.disabled).toBe(true);
  expect(searchCalls()).toHaveLength(1);
});

test('grant dialog has one focus trap, wraps Tab, closes on Escape and restores Give Stamps focus', async () => {
  const originalDocument = global.document;
  const originalElement = global.HTMLElement;
  const listeners = new Map(); const nodes = [];
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
        const group = element.props['aria-labelledby'] === 'admin-stamp-grant-title' ? 'grant' : 'customer';
        nodes.filter(node => node.group !== group && node.group !== 'search').forEach(node => { node.isConnected = false; });
        const dialog = new Element(group, 'dialog');
        dialog.contains = node => node?.isConnected && node.group === group;
        dialog.querySelectorAll = () => nodes.filter(node => node.isConnected && node.group === group && node.label !== 'dialog');
        return dialog;
      }
      if (element.type === 'input' && element.props.id === 'admin-stamp-count') return new Element('grant', 'stamp-count');
      if (element.type === 'button') return new Element(element.props.type === 'submit' || element.props.children === 'Cancel' ? 'grant' : 'customer', element.props.children);
      return null;
    } });
    await openCustomer('Brown', trigger); await tap('Give Stamps');
    expect(dialogs()).toHaveLength(1); expect(listeners.get('keydown').size).toBe(1);
    expect(document.activeElement.label).toBe('stamp-count');
    const active = nodes.filter(node => node.isConnected && node.group === 'grant' && node.label !== 'dialog');
    active[active.length - 1].focus();
    const preventDefault = jest.fn();
    await act(async () => Array.from(listeners.get('keydown')).forEach(fn => fn({ key: 'Tab', shiftKey: false, preventDefault })));
    expect(preventDefault).toHaveBeenCalled(); expect(document.activeElement).toBe(active[0]);
    await act(async () => Array.from(listeners.get('keydown')).forEach(fn => fn({ key: 'Escape', preventDefault() {}, stopPropagation() {} })));
    expect(dialogs()).toHaveLength(1); expect(customerDialog()).toBeDefined(); expect(listeners.get('keydown').size).toBe(1);
    expect(document.activeElement.label).toBe('Give Stamps'); expect(grantCalls()).toHaveLength(0);
    await tap('Close customer'); expect(listeners.get('keydown').size).toBe(0); expect(document.activeElement).toBe(trigger);
  } finally {
    if (renderer) await act(async () => renderer.unmount()); renderer = null;
    global.document = originalDocument; global.HTMLElement = originalElement;
  }
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
