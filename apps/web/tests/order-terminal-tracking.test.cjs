const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, renderer, status, socket, listeners;
jest.mock('next/link', () => props => React.createElement('a', props, props.children));
jest.mock('@/lib/session', () => ({ useSession: () => mockSession, withSilentRefresh: call => call() }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('@/lib/env', () => ({ DEFAULT_LOCATION_ID: 'store' }));
jest.mock('@/lib/realtime', () => ({ createOrdersSocket: jest.fn(), subscribeToChannels: jest.fn(() => jest.fn()) }));
jest.mock('@/components/order-chat', () => ({ OrderChat: () => null }));
jest.mock('@/components/order-reviews', () => ({ OrderReviews: () => null }));
jest.mock('@/components/order-status-timeline-chakra', () => ({ OrderStatusTimelineChakra: () => null }));
jest.mock('@/components/reorder-button', () => ({ ReorderButton: props => React.createElement('ReorderButton', props) }));
jest.mock('@/components/support-ticket-form', () => ({ SupportTicketForm: () => null }));
jest.mock('../src/app/orders/[orderId]/order-detail.module.css', () => ({}));
const { apiFetch } = require('@/lib/api');
const { createOrdersSocket } = require('@/lib/realtime');
const { OrderDetailClient } = require('../src/app/orders/[orderId]/order-detail-client');
const text = () => JSON.stringify(renderer.toJSON());
const buttons = () => renderer.root.findAllByType('button');
beforeEach(() => {
  jest.clearAllMocks(); status = 'PLACED'; listeners = new Map();
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer' }, refresh: jest.fn(), clear: jest.fn() };
  socket = { on: jest.fn((event, callback) => listeners.set(event, callback)), connect: jest.fn(), disconnect: jest.fn() };
  createOrdersSocket.mockReturnValue(socket);
  apiFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ data: {
    id: 'order', customer_user_id: 'customer', location_id: 'store', order_number: 123,
    status, fulfillment_type: 'PICKUP', placed_at: '2026-10-20T15:00:00Z',
    cancel_allowed_until: '2099-01-01T00:00:00Z', status_events: [], items: [],
    estimated_ready_at: '2026-10-20T15:20:00Z', payment_status_summary: 'UNPAID',
    item_subtotal_cents: 1000, final_payable_cents: 1130, tax_cents: 130,
  } }) }));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
test.each([
  ['PICKED_UP', 'Picked up'], ['DELIVERED', 'Delivered'], ['NO_SHOW_PICKUP', 'No-show (not picked up)'],
  ['NO_SHOW_DELIVERY', 'Delivery not completed'], ['NO_PIN_DELIVERY', 'Delivery completed without PIN'], ['CANCELLED', 'Order cancelled'],
])('KDS %s stops live tracking and cancellation while preserving order history', async (finalStatus, label) => {
  await act(async () => { renderer = create(React.createElement(OrderDetailClient, { orderId: 'order' })); });
  const cancel = buttons().find(node => node.children.includes('Cancel order'));
  expect(cancel).toBeDefined();
  await act(async () => cancel.props.onClick());
  expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(1);
  status = finalStatus;
  await act(async () => listeners.get('order.status_changed')());
  expect(text()).toContain(label);
  expect(text()).not.toContain('Estimated ready ~');
  expect(buttons().some(node => node.children.includes('Cancel order'))).toBe(false);
  expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
  expect(socket.disconnect).toHaveBeenCalledTimes(1);
  expect(createOrdersSocket).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByType('ReorderButton')).toHaveLength(1);
  expect(apiFetch.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
