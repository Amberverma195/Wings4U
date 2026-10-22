const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let mockSession, mockOrder, mockOrderId, mockFocused, mockGeneration, mockOrderLoading, mockOrderError, renderer;
jest.mock('react-native', () => ({
  ...require('./skeleton-native-mock.cjs').createNativeSkeletonMock(),
  RefreshControl: 'RefreshControl', ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' }, StyleSheet: { create: value => value }, AccessibilityInfo: { ...require('./skeleton-native-mock.cjs').createNativeSkeletonMock().AccessibilityInfo, setAccessibilityFocus: jest.fn() }, findNodeHandle: () => null,
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_, name) => name }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused, useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({ id: mockOrderId }) }));
jest.mock('../src/context/session', () => ({ useSession: () => mockSession, withSilentRefresh: jest.fn(async call => call()) }));
jest.mock('../src/lib/token-store', () => ({ getSessionGeneration: () => mockGeneration }));
jest.mock('../src/lib/api', () => ({ apiFetch: jest.fn(), getApiErrorMessage: (body, fallback) => body?.errors?.[0]?.message ?? fallback,
  ApiRequestError: class extends Error { constructor(message, body, status) { super(message); this.body = body; this.status = status; } } }));
jest.mock('../src/hooks/use-order-detail', () => ({ useOrderDetail: () => ({ order: mockOrder, refetch: mockRefetch, loading: mockOrderLoading, error: mockOrderError }) }));
const mockRefetch = jest.fn();
const mockChatRefetch = jest.fn();
const mockSendMessage = jest.fn();
jest.mock('../src/hooks/use-chat', () => ({ useChat: () => ({ messages: [], loading: false, refetch: mockChatRefetch, sendMessage: mockSendMessage }) }));
jest.mock('../src/lib/realtime', () => ({ createOrdersSocket: jest.fn(() => ({ on: jest.fn(), off: jest.fn(), connect: jest.fn(), disconnect: jest.fn(), timeout: jest.fn() })) }));
jest.mock('../src/components/order-history', () => ({ OrderReorderAction: () => React.createElement('Reorder') }));
const { apiFetch } = require('../src/lib/api');
const { withSilentRefresh } = require('../src/context/session');
const { OrderHelpModal } = require('../src/components/order-help-modal');
const { OrderReviewModal } = require('../src/components/order-review-modal');
const Screen = require('../app/orders/[id]').default;
const { ORDER_ISSUES, ticketPayload, validReview } = require('../src/lib/order-feedback');
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => status < 400 ? { data } : { errors: [{ message: data }] } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const item = (id, line) => ({ id, line_no: line, order_id: 'order', product_name_snapshot: 'Wings', category_name_snapshot: 'Combos', quantity: line,
  line_total_cents: 1799, flavours: [{ flavour_name_snapshot: 'Buffalo' }], modifiers: [{ modifier_name_snapshot: 'Fries' }] });
const review = (id = 'line-a') => ({ id: `review-${id}`, order_id: 'order', order_item_id: id, customer_user_id: 'customer', rating: 4,
  review_body: 'Good wings', admin_reply: 'Thank you!', is_approved_public: false });
const mount = async (Component = OrderHelpModal, props = {}) => act(async () => { renderer = create(React.createElement(Component, { order: mockOrder, onClose: jest.fn(), ...props })); });
const byLabel = label => renderer.root.findAllByType('TouchableOpacity').find(node => node.props.accessibilityLabel === label);
const tap = async label => act(async () => { const node = byLabel(label); if (!node.props.disabled) await node.props.onPress(); });
const input = () => renderer.root.findByProps({ accessibilityLabel: 'Please Explain the Issue' });
const texts = () => renderer.root.findAllByType('Text').map(node => node.children.join(''));
const checkboxes = () => renderer.root.findAllByType('TouchableOpacity').filter(node => node.props.accessibilityRole === 'checkbox');
const selectFirst = async () => act(async () => checkboxes()[1].props.onPress());
const details = async () => { await selectFirst(); await tap('Continue'); };
const enterDescription = async body => act(async () => input().props.onChangeText(body));
const stars = () => renderer.root.findAllByType('TouchableOpacity').filter(node => node.props.accessibilityRole === 'radio');
const submits = () => renderer.root.findAllByType('TouchableOpacity').filter(node => node.props.accessibilityLabel === 'Submit review');
const refreshWarning = "Couldn't refresh order. Showing the last available details.";
beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true; mockGeneration = 1; mockOrderId = 'order'; mockOrderLoading = false; mockOrderError = null;
  mockSession = { loaded: true, authenticated: true, user: { id: 'customer', role: 'CUSTOMER' }, refresh: jest.fn(), clear: jest.fn() };
  mockOrder = { id: 'order', location_id: 'order-location', customer_user_id: 'customer', order_number: 1061, status: 'DELIVERED', cancel_allowed_until: '2020-01-01',
    item_subtotal_cents: 3000, tax_cents: 390, tax_rate_bps: 1300, item_discount_total_cents: 0, order_discount_total_cents: 0, status_events: [{id:'placed',to_status:'PLACED',created_at:'2026-10-19T10:00:00Z'}],
    fulfillment_type: 'DELIVERY', placed_at: '2026-10-01', final_payable_cents: 3000, items: [item('line-a', 1), item('line-b', 2)] };
  apiFetch.mockResolvedValue(response([]));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test('initial order load shows loading, then full-screen error with Try again on failure', async () => {
  mockOrder = null; mockOrderLoading = true; await mount(Screen);
  expect(renderer.root.findAllByType('View').filter(node => node.props.testID === 'order-detail-skeleton')).toHaveLength(1); expect(texts()).not.toContain('Items');
  mockOrderLoading = false; mockOrderError = 'Unable to load order'; await act(async () => renderer.update(React.createElement(Screen)));
  expect(texts()).toContain('Unable to load order'); expect(texts()).toContain('Try again'); expect(texts()).not.toContain(refreshWarning);
  const retry = renderer.root.findAllByType('TouchableOpacity').find(node => node.findAllByType('Text').some(text => text.children.join('') === 'Try again'));
  await act(async () => retry.props.onPress()); expect(mockRefetch).toHaveBeenCalledTimes(1);
});
test('failed refresh keeps details with inline Retry; successful retry removes warning', async () => {
  await mount(Screen); mockOrderLoading = true; await act(async () => renderer.update(React.createElement(Screen)));
  expect(texts()).toContain('Items'); expect(texts()).not.toContain('Loading order...');
  mockOrderLoading = false; mockOrderError = 'Network request failed'; await act(async () => renderer.update(React.createElement(Screen)));
  expect(texts()).toEqual(expect.arrayContaining(['Items', 'Order status', refreshWarning]));
  expect(texts()).not.toContain('Try again'); await tap('Retry order refresh'); expect(mockRefetch).toHaveBeenCalledTimes(1);
  mockOrderLoading = true; await act(async () => renderer.update(React.createElement(Screen)));
  expect(byLabel('Retry order refresh').props.disabled).toBe(true); expect(texts()).toContain('Items');
  mockOrderLoading = false; mockOrderError = null; mockOrder = { ...mockOrder, order_number: 1062 };
  await act(async () => renderer.update(React.createElement(Screen)));
  expect(texts()).not.toContain(refreshWarning); expect(byLabel('Retry order refresh')).toBeUndefined();
  expect(texts()).toContain('Order #1062');
});
test('revoked order data shows full-screen error instead of stale details or inline warning', async () => {
  await mount(Screen); mockOrder = null; mockOrderError = 'You do not have access to this order';
  await act(async () => renderer.update(React.createElement(Screen)));
  expect(texts()).not.toContain('Items'); expect(texts()).not.toContain(refreshWarning);
  expect(texts()).toContain('You do not have access to this order'); expect(texts()).toContain('Try again');
});

test.each(['PICKED_UP', 'DELIVERED'])('%s shows both actions immediately after Reorder and before Details; existing sections remain', async status => {
  mockOrder.status = status; await mount(Screen);
  expect(byLabel('Help')).toBeDefined(); expect(byLabel('Rate your Order')).toBeDefined();
  const content = renderer.root.findByType('ScrollView').children;
  const index = content.findIndex(node => node.type === require('../src/components/order-history').OrderReorderAction);
  expect(content[index + 1].findByProps({ accessibilityLabel: 'Help' })).toBeDefined();
  expect(content[index + 2].findAllByType('Text')[0].children).toEqual(['Items']);
  expect(texts()).toEqual(expect.arrayContaining(['Order status']));
  await tap('Help'); expect(renderer.root.findAllByType('Modal')).toHaveLength(1);
  await tap('Cancel'); await tap('Rate your Order');
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/orders/order/reviews', expect.objectContaining({ locationId: 'order-location' }));
});
test.each(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'CANCELLED', 'REFUNDED', 'UNKNOWN'])('%s hides post-order feedback actions', async status => {
  mockOrder.status = status; await mount(Screen);
  expect(Boolean(byLabel('Help'))).toBe(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'].includes(status));
  expect(byLabel('Rate your Order')).toBeUndefined();
});
test.each(['signed-out', 'staff', 'other-customer', 'not-loaded'])('%s cannot open feedback', async change => {
  if (change === 'signed-out') mockSession.authenticated = false;
  if (change === 'staff') mockSession.user.role = 'STAFF';
  if (change === 'other-customer') mockSession.user.id = 'other';
  if (change === 'not-loaded') mockSession.loaded = false;
  await mount(Screen); expect(byLabel('Help')).toBeUndefined(); expect(byLabel('Rate your Order')).toBeUndefined();
});
test.each(['PICKED_UP', 'DELIVERED'])('admin purchasing their own %s order can use both feedback flows', async status => {
  mockSession.user.role = 'ADMIN'; mockOrder.status = status; await mount(Screen);
  expect(byLabel('Help')).toBeDefined(); expect(byLabel('Rate your Order')).toBeDefined();
  await tap('Help'); await details(); await enterDescription('An issue');
  apiFetch.mockResolvedValueOnce(response({ id: 'ticket' })); await tap('Submit ticket');
  expect(texts()).toContain('Ticket submitted'); await tap('Close');
  apiFetch.mockResolvedValueOnce(response([])); await tap('Rate your Order');
  await act(async () => stars()[4].props.onPress()); apiFetch.mockResolvedValueOnce(response({ ...review(), rating: 5 }));
  await act(async () => submits()[0].props.onPress()); expect(texts()).toContain('Review submitted · 5 of 5 stars');
});
test.each(['different-owner', 'CANCELLED', 'READY', 'OUT_FOR_DELIVERY'])('admin feedback remains hidden for %s', async reason => {
  mockSession.user.role = 'ADMIN';
  if (reason === 'different-owner') mockOrder.customer_user_id = 'someone-else'; else mockOrder.status = reason;
  await mount(Screen);
  expect(Boolean(byLabel('Help'))).toBe(['READY', 'OUT_FOR_DELIVERY'].includes(reason));
  expect(byLabel('Rate your Order')).toBeUndefined();
});
test('website single-item support skips selection and empty orders allow whole-order support', async () => {
  mockOrder.items = [item('line-a', 1)]; await mount();
  expect(texts()).toContain('Open a support ticket'); expect(checkboxes()).toHaveLength(0);
  expect(byLabel('Back')).toBeUndefined(); expect(byLabel('Submit ticket').props.disabled).toBe(true);
  await enterDescription('Wrong item'); apiFetch.mockResolvedValueOnce(response({ id: 'ticket' })); await tap('Submit ticket');
  expect(JSON.parse(apiFetch.mock.calls[0][1].body).description).toContain('[order_item_id: line-a]');
  await act(async () => renderer.unmount()); renderer = null; mockOrder.items = []; await mount();
  expect(texts()).toContain('Open a support ticket'); expect(byLabel('Continue')).toBeUndefined(); expect(byLabel('Back')).toBeUndefined();
  await enterDescription('Whole order issue'); apiFetch.mockResolvedValueOnce(response({ id: 'whole-order-ticket' })); await tap('Submit ticket');
  const body = JSON.parse(apiFetch.mock.calls[1][1].body);
  expect(body.subject).toBe('Wrong item - Whole order (#1061)'); expect(body.description).toContain('- Whole order');
});
test('checkboxes use unique line IDs for duplicate product names, and Select All toggles both directions', async () => {
  await mount(); expect(checkboxes()).toHaveLength(3);
  await selectFirst(); expect(checkboxes().map(node => node.props.accessibilityState.checked)).toEqual([false, true, false]);
  await tap('Select All'); expect(checkboxes().every(node => node.props.accessibilityState.checked)).toBe(true);
  await tap('Select All'); expect(checkboxes().every(node => !node.props.accessibilityState.checked)).toBe(true);
  await selectFirst(); await act(async () => checkboxes()[2].props.onPress()); expect(checkboxes()[0].props.accessibilityState.checked).toBe(true);
});
test('Back preserves selection, issue, and description; trimmed blank descriptions cannot submit', async () => {
  await mount(); await details(); await enterDescription('   '); expect(byLabel('Submit ticket').props.disabled).toBe(true);
  await enterDescription('Too cold'); await tap('Cold food'); await tap('Back');
  expect(checkboxes()[1].props.accessibilityState.checked).toBe(true); await tap('Continue');
  expect(input().props.value).toBe('Too cold'); expect(byLabel('Cold food').props.accessibilityState.checked).toBe(true);
  expect(apiFetch).not.toHaveBeenCalled();
});
test.each(ORDER_ISSUES)('$value submits website-compatible selected snapshots and actual location', async issue => {
  apiFetch.mockResolvedValue(response({ id: 'ticket' })); await mount(); await details(); await tap(issue.label); await enterDescription('  An issue  '); await tap('Submit ticket');
  const [path, options] = apiFetch.mock.calls[0]; const body = JSON.parse(options.body);
  expect(path).toBe('/api/v1/support/tickets'); expect(options.locationId).toBe('order-location');
  expect(body).toEqual(ticketPayload(mockOrder, ['line-a'], issue.value, 'An issue'));
  expect(body.subject).toBe(`${issue.subjectLabel} - Wings (#1061)`);
  expect(body.description).toContain('- Wings - $17.99 (Combos / Flavours: Buffalo / Options: Fries) [order_item_id: line-a]');
  expect(body.description).not.toContain('line-b'); expect(body.order_id).toBe('order'); expect(texts()).toContain('Ticket submitted');
  expect(withSilentRefresh).toHaveBeenCalledWith(expect.any(Function), mockSession.refresh, mockSession.clear);
});
test('a duplicate order ticket points at the customer tickets and cannot be submitted again', async () => {
  apiFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ errors: [{ code: 'SUPPORT_TICKET_EXISTS', message: 'You already have a support ticket for this order.' }] }) });
  await mount(); await details(); await enterDescription('Cold again'); await tap('Submit ticket');
  expect(texts()).toContain('You already have a support ticket for this order.');
  expect(byLabel('View my support tickets')).toBeTruthy();
  expect(byLabel('Submit ticket').props.disabled).toBe(true);
  await tap('Submit ticket'); expect(apiFetch).toHaveBeenCalledTimes(1);
});
test('support request failure preserves inputs and rapid duplicate submissions are locked', async () => {
  const pending = deferred(); apiFetch.mockReturnValue(pending.promise); await mount(); await details(); await enterDescription('Missing fries');
  const submit = byLabel('Submit ticket').props.onPress;
  await act(async () => { void submit(); void submit(); }); expect(apiFetch).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(response('Please contact the store', 422)));
  expect(input().props.value).toBe('Missing fries'); expect(texts()).toContain('Please contact the store'); expect(texts()).not.toContain('Ticket submitted');
});
test('ticket selection builder includes quantities and every actual selected marker', () => {
  const body = ticketPayload(mockOrder, ['line-a', 'line-b'], 'WRONG_ITEM', 'bad');
  expect(body.description).toContain('Wings x2'); expect(body.description).toContain('[order_item_id: line-b]');
  expect(() => ticketPayload(mockOrder, [], 'OTHER', 'bad')).toThrow();
  expect(() => ticketPayload(mockOrder, ['line-a'], 'OTHER', ' \n ')).toThrow();
});
test('existing reviews load as read-only with admin reply and only confirmed public status', async () => {
  apiFetch.mockResolvedValue(response([review()])); await mount(OrderReviewModal);
  expect(texts()).toEqual(expect.arrayContaining(['Good wings', 'Thank you!', 'Review submitted · 4 of 5 stars']));
  expect(texts()).not.toContain('Published publicly'); expect(submits()).toHaveLength(1); expect(stars()[0].props.disabled).toBe(true);
  expect(renderer.root.findAllByType('TextInput')[0].props.maxLength).toBe(2000);
});
test('stars and drafts are independent; item-specific submission updates only confirmed item and stays open', async () => {
  await mount(OrderReviewModal);
  expect(submits().every(node => node.props.disabled)).toBe(true);
  await act(async () => { stars()[4].props.onPress(); stars()[6].props.onPress(); renderer.root.findAllByType('TextInput')[1].props.onChangeText('Other draft'); });
  expect(stars()[4].props.accessibilityState.checked).toBe(true); expect(stars()[6].props.accessibilityState.checked).toBe(true);
  apiFetch.mockResolvedValue(response({ ...review(), rating: 5, review_body: null }));
  const submit = submits()[0].props.onPress; await act(async () => { void submit(); void submit(); });
  expect(apiFetch).toHaveBeenCalledTimes(2);
  expect(apiFetch.mock.calls[1]).toEqual(['/api/v1/orders/order/order-items/line-a/reviews', expect.objectContaining({ locationId: 'order-location', body: JSON.stringify({ rating: 5 }) })]);
  expect(submits()).toHaveLength(1); expect(renderer.root.findByType('TextInput').props.value).toBe('Other draft');
  await act(async () => submit()); expect(apiFetch).toHaveBeenCalledTimes(2); expect(renderer.root.findAllByType('Modal')).toHaveLength(1);
});
test('individual review errors preserve all drafts; failed initial load blocks submission and offers retry', async () => {
  apiFetch.mockResolvedValueOnce(response('Unavailable', 503)); await mount(OrderReviewModal);
  expect(texts()).toContain('Unavailable'); expect(submits().every(node => node.props.disabled)).toBe(true);
  apiFetch.mockResolvedValue(response([])); await tap('Reload reviews');
  await act(async () => { stars()[2].props.onPress(); renderer.root.findAllByType('TextInput')[0].props.onChangeText('First'); renderer.root.findAllByType('TextInput')[1].props.onChangeText('Second'); });
  apiFetch.mockResolvedValue(response('Try later', 500)); await act(async () => submits()[0].props.onPress());
  expect(texts()).toContain('Try later'); expect(renderer.root.findAllByType('TextInput').map(node => node.props.value)).toEqual(['First', 'Second']);
});
test('409 refreshes saved review without claiming the draft was saved', async () => {
  await mount(OrderReviewModal); await act(async () => stars()[4].props.onPress());
  apiFetch.mockResolvedValueOnce(response('Already reviewed', 409)).mockResolvedValueOnce(response([review()]));
  await act(async () => submits()[0].props.onPress());
  expect(apiFetch.mock.calls[2][0]).toBe('/api/v1/orders/order/reviews');
  expect(texts()).toContain('Review submitted · 4 of 5 stars'); expect(texts()).toContain('Good wings'); expect(submits()).toHaveLength(1);
});
test('409 with failed refresh remains blocked until an existing review is retrieved', async () => {
  await mount(OrderReviewModal); await act(async () => stars()[4].props.onPress());
  apiFetch.mockResolvedValueOnce(response('Already reviewed', 409)).mockResolvedValueOnce(response('Offline', 503));
  await act(async () => submits()[0].props.onPress());
  expect(texts()).not.toContain('Review submitted · 5 of 5 stars'); expect(submits()[0].props.disabled).toBe(true); expect(byLabel('Reload reviews')).toBeDefined();
});
test.each([0, -1, 6, 1.5, NaN])('invalid rating %s is rejected', rating => expect(validReview(rating, '')).toBe(false));
test('optional review is valid but capped at 2000 characters', () => { expect(validReview(1, '')).toBe(true); expect(validReview(5, 'a'.repeat(2001))).toBe(false); });
test.each(['Close modal', 'hardware-back'])('%s dismisses without implicit submission', async close => {
  const onClose = jest.fn(); await mount(OrderReviewModal, { onClose }); apiFetch.mockClear();
  if (close === 'hardware-back') await act(async () => renderer.root.findByType('Modal').props.onRequestClose()); else await tap(close);
  expect(onClose).toHaveBeenCalledTimes(1); expect(apiFetch).not.toHaveBeenCalled();
});
test.each(['logout', 'account', 'order', 'generation', 'blur'])('%s dismisses modal and ignores late ticket response', async change => {
  await mount(Screen); await tap('Help'); await details(); await enterDescription('Private description');
  const pending = deferred(); apiFetch.mockReturnValue(pending.promise); await act(async () => { void byLabel('Submit ticket').props.onPress(); });
  if (change === 'logout') mockSession = { ...mockSession, authenticated: false, user: null };
  if (change === 'account') mockSession = { ...mockSession, user: { id: 'other', role: 'CUSTOMER' } };
  if (change === 'order') { mockOrderId = 'new-order'; mockOrder = { ...mockOrder, id: 'new-order' }; }
  if (change === 'generation') mockGeneration++;
  if (change === 'blur') mockFocused = false;
  await act(async () => renderer.update(React.createElement(Screen)));
  await act(async () => pending.resolve(response({ id: 'late-ticket' })));
  expect(renderer.root.findAllByType('Modal')).toHaveLength(0); expect(texts()).not.toContain('Ticket submitted');
});
test('closing clears help drafts; late review loads never appear on reopening', async () => {
  await mount(Screen); await tap('Help'); await details(); await enterDescription('Private'); await tap('Cancel'); await tap('Help');
  expect(texts()).toContain('Which item had an issue?'); expect(byLabel('Continue').props.disabled).toBe(true); await tap('Cancel');
  const pending = deferred(); apiFetch.mockReturnValueOnce(pending.promise); await tap('Rate your Order'); await tap('Close modal');
  apiFetch.mockResolvedValue(response([])); await tap('Rate your Order'); await act(async () => pending.resolve(response([review()])));
  expect(texts()).not.toContain('Good wings'); expect(submits()).toHaveLength(2);
});
test('silent-refresh callback cannot retry after account switch', async () => {
  let retry;
  withSilentRefresh.mockImplementationOnce(async call => { retry = call; return call(); });
  await mount(); await details(); await enterDescription('Problem'); await tap('Submit ticket');
  mockGeneration++;
  expect(() => retry()).toThrow('Your session or order changed'); expect(apiFetch).toHaveBeenCalledTimes(1);
});

test.each(['logout', 'account', 'order', 'generation', 'blur'])('%s invalidates a pending item-review submission', async change => {
  await mount(Screen); await tap('Rate your Order');
  await act(async () => stars()[4].props.onPress());
  const pending = deferred(); apiFetch.mockReturnValueOnce(pending.promise);
  await act(async () => { void submits()[0].props.onPress(); });
  if (change === 'logout') mockSession = { ...mockSession, authenticated: false, user: null };
  if (change === 'account') mockSession = { ...mockSession, user: { id: 'other', role: 'CUSTOMER' } };
  if (change === 'order') { mockOrderId = 'new-order'; mockOrder = { ...mockOrder, id: 'new-order' }; }
  if (change === 'generation') mockGeneration++;
  if (change === 'blur') mockFocused = false;
  await act(async () => renderer.update(React.createElement(Screen)));
  await act(async () => pending.resolve(response(review())));
  expect(renderer.root.findAllByType('Modal')).toHaveLength(0); expect(texts()).not.toContain('Good wings');
});
test.each(['Close modal', 'hardware-back', 'Cancel'])('help %s dismisses without implicit submission', async close => {
  const onClose = jest.fn(); await mount(OrderHelpModal, { onClose });
  if (close === 'hardware-back') await act(async () => renderer.root.findByType('Modal').props.onRequestClose()); else await tap(close);
  expect(onClose).toHaveBeenCalledTimes(1); expect(apiFetch).not.toHaveBeenCalled();
});
test('review submits the second line ID and trims optional text; public labels require approval', async () => {
  await mount(OrderReviewModal); await act(async () => { stars()[8].props.onPress(); renderer.root.findAllByType('TextInput')[1].props.onChangeText('  Delicious!  '); });
  apiFetch.mockResolvedValueOnce(response({ ...review('line-b'), rating: 4, review_body: 'Delicious!', is_approved_public: true }));
  await act(async () => submits()[1].props.onPress());
  expect(apiFetch.mock.calls[1]).toEqual(['/api/v1/orders/order/order-items/line-b/reviews', expect.objectContaining({ body: JSON.stringify({ rating: 4, review_body: 'Delicious!' }) })]);
  expect(texts()).toContain('Published publicly'); expect(texts()).toContain('Delicious!');
});
test('empty review orders show an empty state', async () => {
  mockOrder.items = []; await mount(OrderReviewModal); expect(texts().join(' ')).toContain('Order items are unavailable'); expect(submits()).toHaveLength(0);
});
test('review responses belonging to another customer are not displayed', async () => {
  apiFetch.mockResolvedValue(response([{ ...review(), customer_user_id: 'someone-else' }])); await mount(OrderReviewModal);
  expect(texts()).not.toContain('Good wings'); expect(submits().every(node => node.props.disabled)).toBe(true); expect(byLabel('Reload reviews')).toBeDefined();
});
test('ticket success requires a confirmed creation, and successful tickets cannot be submitted twice', async () => {
  apiFetch.mockResolvedValue(response(null)); await mount(); await details(); await enterDescription('Problem');
  await tap('Submit ticket'); expect(texts()).not.toContain('Ticket submitted'); expect(input().props.value).toBe('Problem');
  apiFetch.mockResolvedValue(response({ id: 'ticket' })); const submit = byLabel('Submit ticket').props.onPress; await act(async () => submit());
  await act(async () => submit()); expect(apiFetch).toHaveBeenCalledTimes(2); expect(texts()).toContain('Ticket submitted');
});
test('active orders retain live updates, and completing an order disconnects before feedback opens', async () => {
  mockOrder.status = 'PREPARING'; await mount(Screen);
  const socket = require('../src/lib/realtime').createOrdersSocket.mock.results[0].value;
  const handler = event => socket.on.mock.calls.find(([name]) => name === event)[1];
  expect(renderer.root.findByType('ScrollView').props.refreshControl).toBeDefined();
  expect(socket.connect).toHaveBeenCalledTimes(1);
  await act(async () => {
    handler('order.status_changed')(); handler('chat.message')();
    await new Promise(resolve => setTimeout(resolve, require('../src/lib/order-realtime').REFRESH_COALESCE_MS + 50));
  });
  expect(mockRefetch).toHaveBeenCalledTimes(1); expect(mockChatRefetch).toHaveBeenCalledTimes(1);
  mockOrder = { ...mockOrder, status: 'DELIVERED' };
  await act(async () => renderer.update(React.createElement(Screen)));
  expect(socket.disconnect).toHaveBeenCalledTimes(1); expect(byLabel('Refresh order')).toBeUndefined();
  await tap('Help'); await tap('Cancel'); await tap('Rate your Order'); await tap('Close modal');
  expect(texts()).toContain('Order status'); expect(byLabel('Order Chat')).toBeUndefined();
  expect(renderer.root.findAllByType('TextInput')).toHaveLength(0); expect(mockSendMessage).not.toHaveBeenCalled();
});

test.each(['PICKED_UP', 'DELIVERED', 'CANCELLED', 'NO_SHOW_PICKUP', 'NO_SHOW_DELIVERY', 'NO_PIN_DELIVERY'])('%s has a final header without refresh or live connection', async status => {
  mockOrder.status = status; await mount(Screen);
  expect(byLabel('Refresh order')).toBeUndefined();
  expect(texts().join(' ')).not.toContain('live updates');
  expect(require('../src/lib/realtime').createOrdersSocket).not.toHaveBeenCalled();
});

test('items precede the price breakdown and a collapsed latest status expands into recorded history', async () => {
  mockOrder = { ...mockOrder, status: 'PICKED_UP', fulfillment_type: 'PICKUP', tax_rate_bps: 1300, tax_cents: 420, item_subtotal_cents: 3796,
    order_discount_total_cents: 569, final_payable_cents: 3647, status_events: [
      { id: 'placed', to_status: 'PLACED', created_at: '2026-10-18T05:00:00Z' },
      { id: 'ready', to_status: 'READY', created_at: '2026-10-18T05:20:00Z' },
      { id: 'done', to_status: 'PICKED_UP', created_at: '2026-10-18T05:30:00Z' },
    ] };
  mockOrder.items[0] = { ...mockOrder.items[0], special_instructions: 'Please keep separate', modifiers: [{ modifier_kind: 'REMOVE_INGREDIENT', modifier_name_snapshot: 'Onion' }] };
  await mount(Screen);
  const labels = texts();
  expect(labels.indexOf('Items')).toBeLessThan(labels.indexOf('Subtotal'));
  expect(labels.indexOf('Subtotal')).toBeLessThan(labels.indexOf('Order status'));
  expect(labels).toEqual(expect.arrayContaining(['Wings × 1', '$37.96', '-$5.69', 'Tax (13%)', '$4.20', '$36.47', 'No Onion', 'Please keep separate']));
  expect(labels).not.toContain('Ready for pickup');
  expect(byLabel('View all status updates').props.accessibilityState.expanded).toBe(false);
  await tap('View all status updates');
  expect(texts()).toEqual(expect.arrayContaining(['Picked up', 'Ready for pickup', 'Order placed']));
  expect(texts().indexOf('Ready for pickup')).toBeLessThan(texts().indexOf('Order placed'));
  await tap('Close status updates'); expect(texts()).not.toContain('Ready for pickup');
});
