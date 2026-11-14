const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('@/components/combo-builder', () => ({ ComboBuilder: () => null }));
jest.mock('@/components/item-customization-overlay', () => ({ ItemCustomizationOverlay: () => null }));
jest.mock('@/components/item-modal', () => ({ ItemModal: () => null }));
jest.mock('@/components/legacy-size-picker-modal', () => ({ LegacySizePickerModal: () => null }));
jest.mock('@/components/lunch-special-builder', () => ({ LunchSpecialBuilder: () => null }));
jest.mock('@/components/wings-builder', () => ({ WingsBuilder: () => null }));
jest.mock('@/lib/cart', () => ({ CartContext: require('react').createContext(null) }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn(), getApiErrorMessage: body => body?.errors?.[0]?.message || 'Request failed' }));
jest.mock('@/lib/env', () => ({ DEFAULT_LOCATION_ID: 'location' }));
jest.mock('@/lib/realtime', () => ({
  createOrdersSocket: () => ({ on: jest.fn(), off: jest.fn(), connect: jest.fn(), disconnect: jest.fn() }),
  subscribeToChannels: () => jest.fn(),
}));
jest.mock('@/lib/menu-item-customization', () => ({ canQuickAddMenuItem: () => true,
  isComboBuilderItem: () => false, isLunchSpecialBuilderItem: () => false,
  isWingBuilderItem: () => false, shouldUseCustomizationOverlay: () => false }));
jest.mock('@/Wings4u/menu-display', () => ({ combineSideCategories: rows => rows,
  buildDisplayMenuCategories: rows => rows.map(row => ({ ...row, items: row.items.map(item => ({
    kind: 'item', key: item.id, item, displayName: item.name, displayPriceCents: item.base_price_cents, stockStatus: 'NORMAL',
  })) })) }));
const { apiFetch } = require('../src/lib/api');
const { PosClient } = require('../src/app/pos/pos-client');
const quote = { delivery_quote_token: 'signed-eligibility', delivery_fee_cents: 1700,
  expires_at: '2026-11-08T20:00:00Z', attribution: 'Google Maps' };
const response = (data, ok = true) => ({ ok, json: async () => ok ? { data } : { errors: [{ message: 'Outside our 20 km delivery area' }] } });
let renderer;
let discountsReduceTaxableBase = true;
const text = node => Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' && node ? text(node.props?.children ?? node.children) : String(node ?? '');
const button = label => renderer.root.findAllByType('button').find(node => text(node.props.children).trim() === label);
const click = async label => { const node = button(label); if (!node) throw new Error(`Missing ${label}; buttons: ${renderer.root.findAllByType('button').map(n => text(n.props.children)).join(' | ')}`); expect(node.props.disabled).not.toBe(true); await act(async () => node.props.onClick()); };
const input = async (predicate, value) => act(async () => renderer.root.findAllByType('input').find(predicate).props.onChange({ target: { value } }));

beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-08T19:00:00Z'));
  global.window = { setTimeout, clearTimeout, addEventListener: jest.fn(), removeEventListener: jest.fn() };
  global.document = { visibilityState: 'visible', addEventListener: jest.fn(), removeEventListener: jest.fn() };
  apiFetch.mockReset().mockImplementation(async (url, init) => {
    if (url.includes('/auth/status')) return response({ authenticated: true });
    if (url.includes('/menu?')) return response({ location: { name: 'Fixture', tax_rate_bps: 1300,
      tax_delivery_fee: false, free_delivery_threshold_cents: 0,
      discounts_reduce_taxable_base: discountsReduceTaxableBase,
      delivery_currently_available: true }, categories: [{ id: 'ordinary', name: 'Menu', slug: 'burgers',
      items: [{ id: 'burger', slug: 'burger', name: 'Burger', base_price_cents: 1000, modifier_groups: [], removable_ingredients: [], stock_status: 'NORMAL', is_available: true }] }] });
    if (url === '/api/v1/pos/delivery/quote') return response(quote);
    if (url === '/api/v1/pos/orders' && init?.method === 'POST') return response({ order_number: 1, final_payable_cents: 2830 });
    return response([]);
  });
  await act(async () => { renderer = create(React.createElement(PosClient)); });
  await click('New Order'); await click('Phone'); await click('Delivery');
  await act(async () => renderer.root.findByProps({ className: 'pos-item-card' }).props.onClick());
  await input(node => node.props.type === 'tel', '5195550123');
  await input(node => node.props.autoComplete === 'street-address', '123 Example Street');
  await input(node => node.props.autoComplete === 'postal-code', 'N6K 1A1');
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null;
  discountsReduceTaxableBase = true;
  jest.useRealTimers(); delete global.window; delete global.document; });

test('phone delivery requires verification, shows $17, and submits the bound address/token', async () => {
  expect(button('Exact Amount').props.disabled).toBe(true);
  await click('Check delivery address');
  expect(JSON.stringify(renderer.toJSON())).toContain('$17.00');
  await click('Exact Amount');
  const call = apiFetch.mock.calls.find(([url, init]) => url === '/api/v1/pos/orders' && init?.method === 'POST');
  expect(JSON.parse(call[1].body)).toMatchObject({ fulfillment_type: 'DELIVERY',
    delivery_quote_token: 'signed-eligibility', address_snapshot_json: { line1: '123 Example Street', city: 'London', postal_code: 'N6K 1A1' } });
});

test('changing the address or expiring its quote disables collection', async () => {
  await click('Check delivery address');
  await input(node => node.props.autoComplete === 'postal-code', 'N6K 2A2');
  expect(button('Exact Amount').props.disabled).toBe(true);
  await click('Check delivery address');
  await act(async () => jest.advanceTimersByTime(3600001));
  expect(button('Exact Amount').props.disabled).toBe(true);
});

test('a rejected route prevents order placement and staff can switch to pickup', async () => {
  apiFetch.mockImplementationOnce(async () => response(null, false));
  await click('Check delivery address');
  expect(button('Exact Amount').props.disabled).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('Outside our 20 km');
  await click('To-Go');
  expect(button('Exact Amount').props.disabled).toBe(false);
});

test.each([true, false])('POS discount estimate honors taxable-base policy %s', async reduce => {
  // Reload the menu to exercise the policy field supplied by the catalog.
  discountsReduceTaxableBase = reduce;
  await act(async () => renderer.unmount());
  await act(async () => { renderer = create(React.createElement(PosClient)); });
  await click('New Order');
  await act(async () => renderer.root.findByProps({ className: 'pos-item-card' }).props.onClick());
  await click('Staff');
  await act(async () => renderer.root.findAllByProps({ className: 'pos-staff-opt' })
    .find(node => text(node.props.children).includes('Apply Discount')).props.onClick());
  await input(node => node.props.placeholder === 'e.g. 10', '50');
  await click('Apply Discount');
  expect(JSON.stringify(renderer.toJSON())).toContain(reduce ? '$5.65' : '$6.30');
});
