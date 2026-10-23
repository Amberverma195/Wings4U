const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockSession = { refresh: jest.fn(), clear: jest.fn() };
jest.mock('react-dom', () => ({ createPortal: children => children }));
jest.mock('@/lib/session', () => ({ useSession: () => mockSession, withSilentRefresh: call => call() }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('@/lib/api');
const { OrderReviews } = require('../src/components/order-reviews');
const notice = 'Your review may be displayed anonymously on the Wings4U website after approval. Your name, phone number, and email will not be published.';
const ok = data => ({ ok: true, json: async () => ({ data }) });
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node?.children ?? '');
let renderer, oldWindow, oldDocument;
const button = label => renderer.root.findAllByType('button').find(node => text(node) === label);
beforeEach(() => {
  jest.clearAllMocks(); oldWindow = global.window; oldDocument = global.document;
  global.window = new EventTarget(); global.document = { body: { style: {} } };
  apiFetch.mockResolvedValue(ok([]));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null;
  global.window = oldWindow; global.document = oldDocument; });
test('notice is between comment and submit, remains singular across rating changes, and leaves submission unchanged', async () => {
  await act(async () => { renderer = create(React.createElement(OrderReviews, { orderId: 'order', locationId: 'store',
    orderStatus: 'PICKED_UP', items: [{ id: 'item', product_name_snapshot: 'Wings' }] })); });
  expect(text(renderer.toJSON())).not.toContain(notice);
  await act(async () => button('Rate your Order').props.onClick());
  const comment = renderer.root.findByType('textarea');
  const siblings = comment.parent.children;
  expect(text(siblings[siblings.indexOf(comment) + 1])).toBe(notice);
  expect(siblings[siblings.indexOf(comment) + 1].findByType('svg').props['aria-hidden']).toBe('true');
  await act(async () => renderer.root.findByProps({ 'aria-label': '3 stars' }).props.onClick());
  await act(async () => renderer.root.findByProps({ 'aria-label': '5 stars' }).props.onClick());
  expect(renderer.root.findAllByType('span').filter(node => text(node) === notice)).toHaveLength(1);
  await act(async () => comment.props.onChange({ target: { value: '  Great wings!  ' } }));
  apiFetch.mockResolvedValueOnce(ok({ id: 'review', order_item_id: 'item', rating: 5, review_body: 'Great wings!', is_approved_public: false }));
  await act(async () => button('Submit review').props.onClick());
  const posts = apiFetch.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toEqual(['/api/v1/orders/order/order-items/item/reviews', expect.objectContaining({
    body: JSON.stringify({ rating: 5, review_body: 'Great wings!' }), locationId: 'store',
  })]);
  expect(text(renderer.toJSON())).toContain('Great wings!');
  expect(text(renderer.toJSON())).not.toContain(notice);
  expect(button('Submit review')).toBeUndefined();
});
