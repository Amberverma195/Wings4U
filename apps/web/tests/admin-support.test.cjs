const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockSession = { refresh: jest.fn(), clear: jest.fn() };
jest.mock('next/link', () => ({ __esModule: true, default: props => require('react').createElement('a', props) }));
jest.mock('@/lib/session', () => ({ useSession: () => mockSession, withSilentRefresh: jest.fn(callback => callback()) }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('@/lib/env', () => ({ DEFAULT_LOCATION_ID: 'location' }));
jest.mock('../src/app/admin/support/support.module.css', () => new Proxy({}, { get: (_, key) => key }));
const { apiFetch } = require('@/lib/api');
const { SupportListClient } = require('../src/app/admin/support/support-list-client');
const { SupportDetailClient } = require('../src/app/admin/support/[id]/support-detail-client');
const DATE = '2026-10-15T12:00:00Z';
const actor = { user_id: 'customer', display_name: 'John Smith', role: 'CUSTOMER', account_available: true };
const staff = { user_id: 'admin', display_name: 'Alex Manager', role: 'ADMIN', account_available: true };
const order = { id: 'order', order_number: '1042', placed_at: DATE, status: 'COMPLETED', fulfillment_type: 'PICKUP',
  final_payable_cents: 2345, customer_name_snapshot: 'Order Contact', customer_phone_snapshot: '+15195550000', customer_email_snapshot: 'snapshot@example.com' };
const makeTicket = (extra = {}) => ({ id: 'ticket', subject: 'Cold wings', description: 'Food was cold.\nPlease help.',
  ticket_type: 'COLD_FOOD', status: 'OPEN', priority: 'NORMAL', created_at: DATE, updated_at: DATE, created_source: 'CUSTOMER_APP',
  customer_user_id: 'customer', order_id: 'order', order, created_by: actor, assigned_admin: staff,
  customer: { ...actor, first_name: 'John', last_name: 'Smith', primary_phone: '+15195551234', primary_email: 'john@example.com' },
  messages: [{ id: 'm', author_user_id: 'customer', author: actor, message_body: 'Customer reply', created_at: DATE },
    { id: 'n', author_user_id: 'admin', author: staff, message_body: 'Staff note', is_internal_note: true, created_at: DATE }],
  events: [{ id: 'created', event_type: 'CREATED', performed_by: actor, created_at: DATE }], resolutions: [], ...extra });
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => ({ data, errors: status >= 400 ? [{ message: 'Request rejected' }] : [] }) });
let currentTicket;
let renderer;
const base = '/api/v1/admin/support-tickets';
const textOf = node => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const text = () => JSON.stringify(renderer.toJSON());
const button = label => renderer.root.findAllByType('button').find(node => textOf(node) === label);
const tap = async label => act(async () => button(label).props.onClick());
const mountDetail = async () => act(async () => { renderer = create(React.createElement(SupportDetailClient, { ticketId: 'ticket' })); });
beforeEach(() => {
  jest.clearAllMocks(); currentTicket = makeTicket();
  apiFetch.mockImplementation(async (path, init) => {
    if (path === `${base}/ticket`) return response(currentTicket);
    if (path.startsWith(`${base}?`)) return response({ tickets: [currentTicket], next_cursor: path.includes('cursor=') ? null : 'next' });
    if (path === `${base}/ticket/eligible-orders`) return response({ orders: [order], next_cursor: null });
    if (path === `${base}/ticket/link-order`) { currentTicket = makeTicket(); return response({ order }); }
    if (path === `${base}/ticket/order-details`) return response({ ticket_id: 'ticket', customer: { name: 'Order Contact', phone: '+15195550000', email: 'snapshot@example.com' },
      order: { ...order, item_subtotal_cents: 2000, tax_cents: 260, discount_total_cents: 100, delivery_fee_cents: 185, driver_tip_cents: 0 },
      payments: [{ id: 'payment', method: 'CARD', status: 'CAPTURED', amount_cents: 2345 }],
      items: [{ id: 'item', product_name: 'Chicken Wings', category_name: 'Wings', quantity: 1, unit_price_cents: 2000, line_total_cents: 2000,
        modifiers: [{ name: 'Ranch', group_name: 'Dip', quantity: 1, price_delta_cents: 100 }], flavours: [{ name: 'Honey Garlic', heat_level: 'MILD', placement: 'ON_SIDE' }] }] });
    if (path.startsWith('/api/v1/support/tickets/ticket/')) return response({});
    throw new Error(`Unexpected path ${path}`);
  });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('queue displays customer/order metadata, readable category, preview, filters and pagination', async () => {
  await act(async () => { renderer = create(React.createElement(SupportListClient)); });
  for (const value of ['John Smith', 'Cold wings', 'Cold Food', 'Order #1042', 'Food was cold.']) expect(text()).toContain(value);
  expect(renderer.root.findByProps({ href: '/admin/support/ticket' })).toBeTruthy();
  await tap('Load more');
  expect(apiFetch.mock.calls.some(([path]) => path.includes('cursor=next'))).toBe(true);
  await tap('Closed');
  expect(apiFetch.mock.calls.some(([path]) => path.includes('status=CLOSED'))).toBe(true);
});

test('detail separates account contacts and order snapshots, uses named authors and preserves the modal and deep link', async () => {
  await mountDetail();
  expect(renderer.root.findByProps({ href: 'mailto:john@example.com' })).toBeTruthy();
  expect(renderer.root.findByProps({ href: 'tel:+15195551234' })).toBeTruthy();
  for (const value of ['John Smith', 'Alex Manager', 'Internal note', 'Current account contact information', 'Contact recorded on this order', 'snapshot@example.com']) expect(text()).toContain(value);
  expect(renderer.root.findByProps({ href: '/admin/orders?orderId=order' })).toBeTruthy();
  await tap('View Order Details');
  expect(renderer.root.findByProps({ role: 'dialog' })).toBeTruthy();
  for (const value of ['Chicken Wings', 'Ranch', 'Honey Garlic', 'CARD', 'Delivery fee', 'Discounts', 'Unit price']) expect(text()).toContain(value);
});

test.each([
  { order_id: null, order: null },
  { order_id: null, order: null, customer_user_id: null, customer: null },
  { order_id: 'unavailable', order: null },
])('missing relationships render friendly fallbacks without a broken order button', async extra => {
  currentTicket = makeTicket(extra); await mountDetail();
  expect(button('View Order Details')).toBeUndefined();
  expect(text()).toContain(extra.order_id ? 'Linked order is unavailable' : 'No order linked to this ticket.');
  if (extra.customer === null) { expect(text()).toContain('Customer account unavailable'); expect(button('Find an order to link')).toBeUndefined(); }
});

test('manual linking requires an explicit selection and confirmation before submitting', async () => {
  currentTicket = makeTicket({ order_id: null, order: null }); await mountDetail();
  await tap('Find an order to link');
  expect(button('Confirm and link order').props.disabled).toBe(true);
  const select = renderer.root.findAllByType('select').find(node => node.findAllByType('option').some(option => option.props.value === 'order'));
  await act(async () => select.props.onChange({ target: { value: 'order' } }));
  expect(button('Confirm and link order').props.disabled).toBe(true);
  const check = renderer.root.findAllByType('input').find(node => node.props.type === 'checkbox' && textOf(node.parent).includes('I confirm'));
  await act(async () => check.props.onChange({ target: { checked: true } }));
  await tap('Confirm and link order');
  expect(apiFetch).toHaveBeenCalledWith(`${base}/ticket/link-order`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ order_id: 'order' }) }));
  expect(button('View Order Details')).toBeTruthy();
});

test('reply, internal note, status and resolution controls retain their working endpoints', async () => {
  await mountDetail();
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'We can help' } }));
  const note = renderer.root.findAllByType('input').find(node => node.props.type === 'checkbox');
  await act(async () => note.props.onChange({ target: { checked: true } }));
  await tap('Send');
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/support/tickets/ticket/messages', expect.objectContaining({ body: JSON.stringify({ message_body: 'We can help', is_internal_note: true }) }));
  const status = renderer.root.findAllByType('select').find(node => node.props.value === 'OPEN');
  await act(async () => status.props.onChange({ target: { value: 'IN_REVIEW' } })); await tap('Update status');
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/support/tickets/ticket/status', expect.objectContaining({ body: JSON.stringify({ status: 'IN_REVIEW' }) }));
  await act(async () => renderer.root.findByProps({ placeholder: 'Resolution notes (required)' }).props.onChange({ target: { value: 'Handled' } }));
  await tap('Record');
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/support/tickets/ticket/resolutions', expect.objectContaining({ body: JSON.stringify({ resolution_type: 'INFO_ONLY', notes: 'Handled' }) }));
});
