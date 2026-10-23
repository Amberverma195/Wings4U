const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockSession = { refresh: jest.fn(), clear: jest.fn() };
jest.mock('next/link', () => props => React.createElement('a', props, props.children));
jest.mock('@/lib/session', () => ({ useSession: () => mockSession, withSilentRefresh: call => call() }));
jest.mock('../src/app/admin/admin-api', () => ({ adminApiFetch: jest.fn(), formatCents: String, formatDateTime: String }));
const { adminApiFetch } = require('../src/app/admin/admin-api');
const { ApprovalsClient } = require('../src/app/admin/approvals/approvals-client');
let renderer;
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node?.children ?? '');
const button = label => renderer.root.findAllByType('button').find(node => text(node) === label);
const decisions = () => adminApiFetch.mock.calls.filter(([, init]) => init?.method === 'POST');
const response = data => ({ ok: true, json: async () => ({ data }) });
beforeEach(() => jest.clearAllMocks());
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
async function mount(status) {
  adminApiFetch.mockResolvedValue(response({ items: [{ id: 'request', order_id: 'order', status: 'PENDING',
    request_source: 'KDS_CHAT_REQUEST', reason_text: 'Original request', created_at: '2026-10-23',
    order: { id: 'order', order_number: 123, status, final_payable_cents: 1130 } }] }));
  await act(async () => { renderer = create(React.createElement(ApprovalsClient)); });
}
test.each(['PICKED_UP', 'DELIVERED', 'NO_SHOW_PICKUP', 'NO_SHOW_DELIVERY', 'NO_PIN_DELIVERY', 'CANCELLED'])
('%s keeps its request visible until staff explicitly reject it', async status => {
  await mount(status);
  expect(text(renderer.toJSON())).toContain('Original request');
  expect(text(renderer.toJSON())).toContain('Leave the request pending while any dispute remains unresolved');
  expect(decisions()).toHaveLength(0);
  expect(button('Approve & cancel order').props.disabled).toBe(true);
  await act(async () => button('Approve & cancel order').props.onClick());
  expect(decisions()).toHaveLength(0);
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Reviewed with customer' } }));
  adminApiFetch.mockResolvedValueOnce(response({ status: 'REJECTED' }));
  await act(async () => button('Deny').props.onClick());
  expect(decisions()).toHaveLength(1);
  expect(JSON.parse(decisions()[0][1].body)).toEqual({ action: 'DENY', admin_notes: 'Reviewed with customer' });
  expect(decisions()[0][0]).toBe('/api/v1/admin/cancellation-requests/request/decide');
  expect(text(renderer.toJSON())).toContain('No pending cancellation requests.');
});
test('an active order retains its existing approve-and-cancel action', async () => {
  await mount('READY');
  expect(button('Approve & cancel order').props.disabled).toBe(false);
});
test('a failed review keeps the request visible and does not claim resolution', async () => {
  await mount('PICKED_UP');
  adminApiFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ errors: [{ message: 'Decision conflict' }] }) });
  await act(async () => button('Deny').props.onClick());
  expect(text(renderer.toJSON())).toContain('Decision conflict');
  expect(text(renderer.toJSON())).toContain('Original request');
});
