const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('@/lib/api', () => ({ apiJson: jest.fn() }));
jest.mock('@/lib/env', () => ({ DEFAULT_LOCATION_ID: 'fixture' }));
jest.mock('@/lib/cart', () => ({ useCart: () => mockCart }));
jest.mock('@/components/delivery-address-provider', () => ({ useDeliveryAddress: () => ({ address: null, openAddressPicker: jest.fn() }) }));
jest.mock('next/link', () => props => React.createElement('a', props, props.children));
const { apiJson } = require('@/lib/api');
const scheduling = require('../src/lib/order-scheduling');
const { OrderMethodModal } = require('../src/Wings4u/components/order-method-modal');
const { CartOrderSettings } = require('../src/Wings4u/components/cart-order-settings');
const { OrderCtaSection } = require('../src/Wings4u/components/order-cta-section');
const { HowItWorksSection } = require('../src/Wings4u/components/how-it-works-section');
const { BrandSection } = require('../src/Wings4u/components/brand-section');
const { MenuClient } = require('../src/app/menu/menu-client');
const oldConfig = () => ({ pickup: { minMinutes: 30, maxMinutes: 39 }, delivery: { minMinutes: 45, maxMinutes: 65 } });
const hours = Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, time_from: '11:00', time_to: '23:00', is_closed: false }));
const menu = () => ({ categories: [], location: { timezone: 'America/Toronto', pickup_min_minutes: 30, pickup_max_minutes: 39,
  delivery_min_minutes: 45, delivery_max_minutes: 65, estimated_prep_minutes: 30, pickup_hours: hours, delivery_hours: hours, store_hours: hours } });
let renderer, mockCart;
const text = node => JSON.stringify(node.toJSON());
const flatText = node => Array.isArray(node) ? node.map(flatText).join('') : node && typeof node === 'object' ? flatText(node.children) : node ?? '';
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-19T16:00:30Z'));
  global.window = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }),
    sessionStorage: { getItem: () => null }, localStorage: { getItem: () => null } });
  global.document = Object.assign(new EventTarget(), { activeElement: null });
  mockCart = { fulfillmentType: 'PICKUP', scheduledFor: null, schedulingConfig: oldConfig(), commitOrderContext: jest.fn(),
    setSchedulingConfig: jest.fn(config => { mockCart.schedulingConfig = config; }) };
  apiJson.mockResolvedValue({ data: menu() });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null;
  jest.useRealTimers(); jest.clearAllMocks(); delete global.window; delete global.document; });
const mountModal = async extra => act(async () => { renderer = create(React.createElement(OrderMethodModal,
  { open: true, defaultMethod: 'PICKUP', onClose: jest.fn(), onContinue: jest.fn(), ...extra })); });

test.each([undefined, null, oldConfig()])('pickup display ignores database/stored configuration (%j)', config => {
  const normalized = scheduling.normalizeSchedulingConfig(config);
  expect(normalized.pickup).toEqual({ minMinutes: 15, maxMinutes: 20 });
  expect(scheduling.formatEtaLabel('PICKUP', config ?? normalized)).toBe('ASAP (15\u201320 min)');
  expect(scheduling.getTimingWindow(oldConfig(), 'PICKUP')).toEqual({ minMinutes: 15, maxMinutes: 20 });
});

test.each(['loaded', 'failed', 'delayed'])('initial Pickup card and ASAP agree with catalog %s', async state => {
  let resolve;
  if (state === 'failed') apiJson.mockRejectedValue(new Error('Offline fixture'));
  if (state === 'delayed') apiJson.mockImplementation(() => new Promise(done => { resolve = done; }));
  await mountModal();
  expect(text(renderer)).toContain('FREE'); expect(text(renderer)).toContain('15\u201320');
  expect(text(renderer)).toContain('~30 MIN'); // Delivery card unchanged.
  await act(async () => renderer.root.findByProps({ className: 'wk-method-continue' }).props.onClick());
  expect(text(renderer)).toContain('ASAP (15\u201320 min)');
  if (state !== 'loaded') expect(renderer.root.findAllByType('option').filter(o => /^\d{4}-.*T/.test(o.props.value))).toHaveLength(0);
  if (state === 'delayed') {
    await act(async () => resolve({ data: menu() }));
    expect(text(renderer)).toContain('ASAP (15\u201320 min)');
  }
  expect(text(renderer)).not.toContain('ASAP (30');
});

test('homepage copy and cart settings use the same advertised range', async () => {
  for (const Component of [OrderCtaSection, HowItWorksSection, BrandSection]) {
    await act(async () => { renderer = create(React.createElement(Component)); });
    const copy = flatText(renderer.toJSON());
    expect(copy).toContain('15-20'); expect(copy).not.toContain('15-25');
    await act(async () => renderer.unmount()); renderer = null;
  }
  await act(async () => { renderer = create(React.createElement(CartOrderSettings, { menu: menu() })); });
  expect(text(renderer)).toContain('ASAP (15\u201320 min)');
  await act(async () => renderer.root.findByProps({ className: 'wk-order-settings-action' }).props.onClick());
  expect(renderer.root.findAllByType('option').some(o => o.children.includes('ASAP (15\u201320 min)'))).toBe(true);
});

test('cart retains fixed pickup fallback without a catalog response', async () => {
  await act(async () => { renderer = create(React.createElement(CartOrderSettings, { menu: null })); });
  expect(text(renderer)).toContain('ASAP (15\u201320 min)');
});

test.each(['PICKUP', 'DELIVERY'])('menu summary preserves the correct %s estimate', async type => {
  mockCart.fulfillmentType = type;
  await act(async () => { renderer = create(React.createElement(MenuClient)); });
  expect(flatText(renderer.toJSON())).toContain(type === 'PICKUP' ? '15\u201320 min' : '~30 min');
});

test('delivery scheduling still uses its loaded API values in the actual modal', async () => {
  await mountModal({ defaultMethod: 'DELIVERY', initialStep: 'schedule' });
  expect(text(renderer)).toContain('ASAP (45-65 min)');
});

test('delivery configured/fallback labels and slot calculation remain unchanged', () => {
  const config = scheduling.normalizeSchedulingConfig(oldConfig());
  expect(scheduling.formatEtaLabel('DELIVERY', config)).toBe('ASAP (45-65 min)');
  expect(scheduling.formatEtaLabel('DELIVERY', scheduling.DEFAULT_SCHEDULING_CONFIG)).toBe('ASAP (40-60 min)');
  const now = new Date(2026, 9, 19, 12, 0, 0);
  const params = { fulfillmentType: 'DELIVERY', selectedDateKey: scheduling.getDateKey(now), config,
    hours: { pickup: hours, delivery: hours, store: hours }, now };
  const options = scheduling.buildScheduleTimeOptions(params);
  expect(options[0].label).toBe('ASAP (45-65 min)');
  expect(new Date(options[1].value).getTime() - now.getTime()).toBe(45 * 60_000);
  expect(scheduling.buildScheduleTimeOptions({ ...params, pickupLeadMinutes: 90 })).toEqual(options);
});

test('unknown prep has no explicit pickup slots; loaded/busy prep preserves backend lead including seconds', () => {
  const params = { fulfillmentType: 'PICKUP', selectedDateKey: '2026-10-19', config: oldConfig(),
    timezone: 'America/Toronto', hours: { pickup: hours, delivery: hours, store: hours }, now: new Date('2026-10-19T16:00:30Z') };
  expect(scheduling.buildScheduleTimeOptions(params)).toEqual([{ value: 'ASAP', label: 'ASAP (15\u201320 min)' }]);
  for (const lead of [15, 30, 45, 60]) {
    const options = scheduling.buildScheduleTimeOptions({ ...params, pickupLeadMinutes: lead });
    expect(options[0].label).toBe('ASAP (15\u201320 min)');
    expect(Date.parse(options[1].value) - params.now.getTime()).toBeGreaterThanOrEqual(lead * 60_000);
  }
});

test('closing hours, overnight lead, and restaurant timezone constrain pickup slots', () => {
  const params = { fulfillmentType: 'PICKUP', config: oldConfig(), timezone: 'America/Toronto',
    hours: { pickup: hours, delivery: hours, store: hours }, pickupLeadMinutes: 45 };
  expect(scheduling.buildScheduleTimeOptions({ ...params, selectedDateKey: '2026-10-19', now: new Date('2026-10-20T03:00:00Z') })).toEqual([]);
  const overnight = Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, time_from: '23:00', time_to: '02:00', is_closed: false }));
  const slots = scheduling.buildScheduleTimeOptions({ ...params, selectedDateKey: '2026-10-20',
    hours: { pickup: overnight, delivery: hours, store: hours }, now: new Date('2026-10-20T03:55:30Z') });
  expect(Date.parse(slots[0].value)).toBeGreaterThanOrEqual(Date.parse('2026-10-20T04:40:30Z'));
  const dates = scheduling.buildScheduleDateOptions('PICKUP', params.hours, 'America/Toronto', new Date('2026-10-20T02:00:00Z'));
  expect(dates[0].value).toBe('2026-10-19');
});

test('a selected pickup slot is rechecked before continuing if it expires', async () => {
  const onContinue = jest.fn(); await mountModal({ onContinue, initialStep: 'schedule' });
  const time = () => renderer.root.findAllByType('select')[1];
  const slot = time().findAllByType('option').find(o => o.props.value !== 'ASAP');
  await act(async () => time().props.onChange({ target: { value: slot.props.value } }));
  jest.setSystemTime(new Date('2026-10-19T16:40:00Z'));
  await act(async () => renderer.root.findByProps({ className: 'wk-method-continue' }).props.onClick());
  expect(onContinue).not.toHaveBeenCalled(); expect(text(renderer)).toContain('Pickup availability changed');
  const updated = time().findAllByType('option').find(o => o.props.value !== 'ASAP');
  expect(Date.parse(updated.props.value)).toBeGreaterThanOrEqual(Date.now() + 30 * 60_000);
});

test('cart rechecks a chosen pickup slot before saving order settings', async () => {
  await act(async () => { renderer = create(React.createElement(CartOrderSettings, { menu: menu() })); });
  await act(async () => renderer.root.findByProps({ className: 'wk-order-settings-action' }).props.onClick());
  const time = renderer.root.findAllByType('select')[1];
  const slot = time.findAllByType('option').find(o => o.props.value !== 'ASAP');
  await act(async () => time.props.onChange({ target: { value: slot.props.value } }));
  jest.setSystemTime(new Date('2026-10-19T16:40:00Z'));
  await act(async () => renderer.root.findByProps({ className: 'wk-order-settings-action' }).props.onClick());
  expect(mockCart.commitOrderContext).not.toHaveBeenCalled();
  expect(text(renderer)).toContain('Pickup availability changed');
  const updated = renderer.root.findAllByType('select')[1].findAllByType('option').find(o => o.props.value !== 'ASAP');
  expect(Date.parse(updated.props.value)).toBeGreaterThanOrEqual(Date.now() + 30 * 60_000);
});

test('pickup times skip the nonexistent spring DST hour and remain chronological overnight', () => {
  const overnight = Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, time_from: '23:00', time_to: '04:00', is_closed: false }));
  const options = scheduling.buildScheduleTimeOptions({ fulfillmentType: 'PICKUP', selectedDateKey: '2027-03-14', config: oldConfig(),
    timezone: 'America/Toronto', hours: { pickup: overnight, delivery: hours, store: hours },
    now: new Date('2027-03-14T04:00:00Z'), pickupLeadMinutes: 30 });
  const instants = options.map(o => Date.parse(o.value));
  expect(instants).toEqual([...instants].sort((a, b) => a - b));
  expect(options.every(o => !o.label.startsWith('2:'))).toBe(true);
});
