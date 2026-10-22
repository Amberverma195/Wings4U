const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockSession = { loaded: true, user: { id: 'customer' }, refresh: jest.fn(), clear: jest.fn() };
jest.mock('next/link', () => ({ __esModule: true, default: props => require('react').createElement('a', props) }));
jest.mock('@/lib/session', () => ({ useSession: () => mockSession, withSilentRefresh: call => call() }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn(), getApiErrorMessage: body => body.errors?.[0]?.message }));
jest.mock('@/lib/env', () => ({ DEFAULT_LOCATION_ID: 'location' }));
jest.mock('@/components/account-skeleton', () => ({ AccountSkeleton: () => null }));
jest.mock('../src/app/account/support/support-back-link', () => ({ SupportBackLink: () => null }));
jest.mock('../src/app/account/support/support.module.css', () => new Proxy({}, { get: (_, key) => key }));
const { TicketDetailClient } = require('../src/app/account/support/[id]/ticket-detail-client');
const { apiFetch } = require('@/lib/api');
let ticket, renderer;
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => ({ data, errors: [{ message: 'Please wait' }] }) });
const text = () => JSON.stringify(renderer.toJSON());
beforeEach(() => {
  ticket = { id: 'ticket', status: 'RESOLVED', subject: 'Cold wings', ticket_type: 'COLD_FOOD', priority: 'NORMAL', customer_user_id: 'customer', created_at: '2026-10-21T12:00:00Z', messages: [{ id: 'history', author_user_id: 'customer', message_body: 'Earlier concern', created_at: '2026-10-21T12:00:00Z' }], events: [] };
  apiFetch.mockReset().mockImplementation(async (path, init) => {
    if (path.endsWith('/reopen')) { ticket = { ...ticket, status: 'OPEN' }; return response(ticket); }
    if (path.endsWith('/messages')) return response({ id: 'new-message' });
    return response(ticket);
  });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
const click = async label => { const button = renderer.root.findAllByType('button').find(node => node.children.includes(label)); await act(async () => button.props.onClick()); };
test.each(['RESOLVED', 'CLOSED'])('customer reopens %s and replies in the existing conversation', async status => {
  ticket.status = status;
  await act(async () => { renderer = create(React.createElement(TicketDetailClient, { ticketId: 'ticket' })); });
  expect(text()).toContain('Earlier concern');
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'New information' } }));
  await click('Reopen ticket');
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/support/tickets/ticket/reopen', expect.objectContaining({ method: 'POST', locationId: 'location' }));
  expect(renderer.root.findByType('textarea').props.value).toBe('New information');
  expect(text()).toContain('Earlier concern');
  await click('Send Reply');
  expect(apiFetch.mock.calls.find(([path]) => path.endsWith('/messages'))[1].body).toBe(JSON.stringify({ message_body: 'New information' }));
  expect(apiFetch.mock.calls.some(([path]) => path === '/api/v1/support/tickets')).toBe(false);
});
test('a 429 retains the ticket and drafted reply', async () => {
  await act(async () => { renderer = create(React.createElement(TicketDetailClient, { ticketId: 'ticket' })); });
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Keep my draft' } }));
  apiFetch.mockImplementationOnce(async () => response(null, 429));
  await click('Reopen ticket');
  expect(text()).toContain('Please wait');
  expect(renderer.root.findByType('textarea').props.value).toBe('Keep my draft');
  expect(mockSession.clear).not.toHaveBeenCalled();
});
