const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/components/order-chat', () => ({ OrderChat: () => null }));
jest.mock('@/components/payment-collection', () => ({ PaymentCollectionPanel: () => null }));
jest.mock('../src/app/admin/admin-api', () => ({ adminApiFetch: jest.fn(), formatCents: cents => `$${cents / 100}` }));
const { AdminOrderDetailModal } = require('../src/app/admin/admin-order-detail-modal');
const order = { id: 'order', order_number: 1042, status: 'READY', fulfillment_type: 'PICKUP', items: [],
  item_subtotal_cents: 2000, item_discount_total_cents: 0, order_discount_total_cents: 0,
  final_payable_cents: 2000, payment_status_summary: 'UNPAID' };
let renderer;
let close;
let last;
let trigger;
let dialog;
let events;
const originalDocument = global.document;
const originalHTMLElement = global.HTMLElement;

beforeEach(() => {
  events = new Map();
  class Element {
    constructor() { this.tabIndex = 0; this.isConnected = true; }
    focus() { document.activeElement = this; }
    matches() { return false; }
    closest() { return null; }
    getClientRects() { return [{}]; }
  }
  global.HTMLElement = Element;
  close = new Element();
  last = new Element();
  trigger = new Element();
  dialog = new Element();
  dialog.querySelectorAll = () => [close, last];
  dialog.contains = node => [dialog, close, last].includes(node);
  global.document = { activeElement: trigger, body: { style: { overflow: 'auto' } },
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name, callback) => { if (events.get(name) === callback) events.delete(name); } };
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  global.document = originalDocument;
  global.HTMLElement = originalHTMLElement;
});
const mount = async onClose => act(async () => {
  renderer = create(React.createElement(AdminOrderDetailModal, { order, onClose, onPaymentRecorded() {} }), {
    createNodeMock: element => element.props.role === 'dialog' ? dialog : element.props.children === 'Close' ? close : null,
  });
});
const key = (value, shiftKey = false) => {
  const event = { key: value, shiftKey, preventDefault: jest.fn(), stopPropagation: jest.fn() };
  events.get('keydown')(event);
  return event;
};

test('focus enters the modal, Tab and Shift+Tab wrap, and outside focus stays in the dialog', async () => {
  await mount(jest.fn());
  expect(document.activeElement).toBe(close);
  expect(document.body.style.overflow).toBe('hidden');
  expect(key('Tab', true).preventDefault).toHaveBeenCalled();
  expect(document.activeElement).toBe(last);
  expect(key('Tab').preventDefault).toHaveBeenCalled();
  expect(document.activeElement).toBe(close);
  document.activeElement = trigger;
  events.get('focusin')({ target: trigger });
  expect(document.activeElement).toBe(close);
});

test('Escape closes the dialog; cleanup restores the trigger focus and original scroll state', async () => {
  const onClose = jest.fn();
  await mount(onClose);
  const event = key('Escape');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopPropagation).toHaveBeenCalled();
  await act(async () => renderer.unmount());
  renderer = null;
  expect(document.activeElement).toBe(trigger);
  expect(document.body.style.overflow).toBe('auto');
  expect(events.size).toBe(0);
});

test('a data rerender keeps focus in place and Escape uses the latest close handler', async () => {
  const firstClose = jest.fn();
  const nextClose = jest.fn();
  await mount(firstClose);
  last.focus();
  await act(async () => renderer.update(React.createElement(AdminOrderDetailModal,
    { order: { ...order }, onClose: nextClose, onPaymentRecorded() {} })));
  expect(document.activeElement).toBe(last);
  key('Escape');
  expect(firstClose).not.toHaveBeenCalled();
  expect(nextClose).toHaveBeenCalledTimes(1);
});
