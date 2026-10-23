const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
const mockRouter = { push: jest.fn() };
const mockCart = { locationId: 'store', fulfillmentType: 'DELIVERY', scheduledFor: null, driverTipPercent: 'none',
  setLocationTimezone: jest.fn(), setDriverTipPercent: jest.fn(), isCartHydrated: true,
  items: [{ key: 'item', menu_item_id: 'lunch', name: 'Lunch', quantity: 1, base_price_cents: 1000, modifier_selections: [] }] };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('next/link', () => props => React.createElement('a', props, props.children));
jest.mock('@/lib/cart', () => ({ useCart: () => mockCart }));
jest.mock('@/lib/api', () => ({ apiJson: jest.fn() }));
jest.mock('../src/Wings4u/components/cart-order-settings', () => ({ CartOrderSettings: () => null }));
const { apiJson } = require('@/lib/api');
const { CartPage } = require('../src/Wings4u/components/cart-page');
const { NewsletterSection } = require('../src/Wings4u/components/newsletter-section');
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node?.children ?? '');
const note = 'First order only. Pickup & delivery · Lunch Specials eligible. Excludes 75 & 100 Wing Party Specials.';
const offers = [{ id: 'first-order-deal:store', code: 'CUSTOMWELCOME', name: 'Renamed by admin' },
  { id: 'ordinary', code: 'MYFIRSTORDER', name: 'First order deal' }].map(p => ({ ...p, discountType: 'PERCENT', discountValue: 15, minSubtotalCents: 0, eligibleFulfillmentType: 'BOTH' }));
const button = label => renderer.root.findAllByType('button').find(n => text(n).trim() === label);
let oldWindow, oldDocument;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); oldWindow = global.window; oldDocument = global.document;
  const storage = new Map();
  global.window = Object.assign(new EventTarget(), { innerWidth: 390, matchMedia: () => ({ matches: true }), sessionStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  } });
  global.document = Object.assign(new EventTarget(), { body: { style: {} }, documentElement: { clientWidth: 390 } });
  apiJson.mockImplementation(async (path, init) => {
    if (path.includes('/promotions/active')) return { data: offers };
    if (path.includes('/menu')) return { data: { categories: [], location: { timezone: 'America/Toronto' } } };
    if (path.includes('/cart/quote')) return { data: { lines: [], final_payable_cents: 1000, item_subtotal_cents: 1000,
      tax_cents: 0, wings_reward: { applied: false }, applied_promo_code: JSON.parse(init.body).promo_code ?? null } };
    return { data: null };
  });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null;
  jest.useRealTimers(); global.window = oldWindow; global.document = oldDocument; });
test('homepage explains the offer below the unchanged ORDER NOW action', async () => {
  const open = jest.fn(); window.addEventListener('wings4u:open-order-method', open);
  await act(async () => { renderer = create(React.createElement(NewsletterSection)); });
  const disclaimer = 'First order only. Valid for pickup and delivery, including Lunch Specials. Excludes 75 & 100 Wing Party Specials. Sign in and apply the offer from Coupons in your cart.';
  expect(text(renderer.toJSON())).toContain(disclaimer);
  const cta = button('ORDER NOW');
  expect(text(cta.parent.children[cta.parent.children.indexOf(cta) + 1])).toBe(disclaimer);
  await act(async () => cta.props.onClick()); expect(open).toHaveBeenCalledTimes(1);
});
test('only the identified first-order card gets disclosures and still applies its dynamic code', async () => {
  await act(async () => { renderer = create(React.createElement(CartPage)); });
  await act(async () => jest.advanceTimersByTime(300));
  await act(async () => renderer.root.findByProps({ className: 'cart-see-coupons-btn' }).props.onClick());
  const cards = renderer.root.findAllByType('button');
  const first = cards.find(n => text(n).includes('CUSTOMWELCOME'));
  const other = cards.find(n => text(n).includes('MYFIRSTORDER'));
  expect(text(first)).toContain(note); expect(text(other)).not.toContain(note);
  expect(first.findByType('svg').props['aria-hidden']).toBe('true');
  expect(apiJson.mock.calls.filter(([path, init]) => path.includes('/cart/quote') && JSON.parse(init.body).promo_code)).toHaveLength(0);
  await act(async () => first.props.onClick());
  const applied = apiJson.mock.calls.find(([path, init]) => path.includes('/cart/quote') && JSON.parse(init.body).promo_code);
  expect(JSON.parse(applied[1].body)).toMatchObject({ promo_code: 'CUSTOMWELCOME', fulfillment_type: 'DELIVERY' });
  expect(window.sessionStorage.getItem('wings4u.promo-checkout-handoff')).toBe('CUSTOMWELCOME');
});
