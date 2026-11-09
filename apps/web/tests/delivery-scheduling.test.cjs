const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
let renderer, mockCart;
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter, usePathname: () => '/order', useSearchParams: () => mockSearchParams }));
jest.mock('next/link', () => props => React.createElement('a', props, props.children));
jest.mock('@/lib/api', () => ({ apiJson: jest.fn() }));
jest.mock('@/lib/env', () => ({ DEFAULT_LOCATION_ID: 'fixture' }));
jest.mock('@/lib/cart', () => ({ useCart: () => mockCart }));
jest.mock('@/components/delivery-address-provider', () => ({ useDeliveryAddress: () => ({
  address: { line1: 'Fixture Street', city: 'London', postalCode: 'N6K 1A1' }, openAddressPicker: jest.fn() }) }));
const { apiJson } = require('../src/lib/api');
const schedule = require('../src/lib/order-scheduling');
const restriction = require('../src/lib/delivery-restrictions');
const { CartOrderSettings } = require('../src/Wings4u/components/cart-order-settings');
const { OrderMethodModal } = require('../src/Wings4u/components/order-method-modal');
const { MenuPage } = require('../src/Wings4u/components/menu-page');
const hours = Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, time_from: '11:00', time_to: '23:00', is_closed: false }));
const menu = overrides => ({ categories: [], location: { id: 'fixture', timezone: 'America/Toronto',
  pickup_min_minutes: 30, pickup_max_minutes: 40, delivery_min_minutes: 40, delivery_max_minutes: 60,
  estimated_prep_minutes: 30, pickup_hours: hours, delivery_hours: hours, store_hours: hours,
  delivery_available_from_minutes: 12 * 60, delivery_available_until_minutes: 22 * 60,
  delivery_disabled: false, delivery_currently_available: false, ...overrides } });
const params = extra => ({ fulfillmentType: 'DELIVERY', selectedDateKey: '2026-11-09', config: schedule.DEFAULT_SCHEDULING_CONFIG,
  timezone: 'America/Toronto', hours: { pickup: hours, delivery: hours, store: hours,
    deliveryAvailableFromMinutes: 12 * 60, deliveryAvailableUntilMinutes: 22 * 60 }, pickupLeadMinutes: 30, ...extra });
const screen = () => JSON.stringify(renderer.toJSON());
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-09T05:10:00Z'));
  global.window = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }),
    sessionStorage: { getItem: () => null, setItem: jest.fn(), removeItem: jest.fn() }, localStorage: { getItem: () => null },
    scrollTo: jest.fn(), setTimeout, clearTimeout, innerWidth: 1200, scrollY: 0, location: { hash: '' } });
  global.document = Object.assign(new EventTarget(), { activeElement: null, querySelector: () => null, getElementById: () => null });
  global.requestAnimationFrame = jest.fn(); global.cancelAnimationFrame = jest.fn();
  mockCart = { items: [], hasCommittedOrderContext: true, fulfillmentType: 'PICKUP', scheduledFor: null,
    schedulingConfig: schedule.DEFAULT_SCHEDULING_CONFIG, commitOrderContext: jest.fn(), setSchedulingConfig: jest.fn(),
    setLocationTimezone: jest.fn(), setFulfillmentType: jest.fn() };
  apiJson.mockResolvedValue({ data: menu() });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null;
  jest.useRealTimers(); jest.clearAllMocks(); delete global.window; delete global.document;
  delete global.requestAnimationFrame; delete global.cancelAnimationFrame; });

test('closed now permits a future valid delivery but rejects ASAP, opening/closing violations and insufficient lead', () => {
  expect(restriction.getDeliveryRestrictionMessage(menu())).toBeNull();
  expect(restriction.getDeliveryScheduleMessage(menu(), '2026-11-09', '2026-11-09T17:45:00.000Z')).toBeNull();
  expect(restriction.getDeliveryScheduleMessage(menu(), '2026-11-10', '2026-11-10T17:45:00.000Z')).toBeNull();
  expect(restriction.getDeliveryScheduleMessage(menu(), '2026-11-09', 'ASAP')).toContain('closed right now');
  for (const time of ['2026-11-09T16:45:00.000Z', '2026-11-10T03:00:00.000Z', '2026-11-10T03:15:00.000Z']) {
    expect(restriction.getDeliveryScheduleMessage(menu(), '2026-11-09', time)).toBeTruthy();
  }
  jest.setSystemTime(new Date('2026-11-09T17:20:30Z'));
  expect(restriction.getDeliveryScheduleMessage(menu(), '2026-11-09', '2026-11-09T17:45:00.000Z')).toBeTruthy();
  const slots = schedule.buildScheduleTimeOptions(params({ pickupLeadMinutes: 90 }));
  expect(slots.filter(s => s.value !== 'ASAP').every(s => Date.parse(s.value) >= Date.now() + 90 * 60_000)).toBe(true);
});

test.each([{ delivery_disabled: true }, { delivery_blocked_due_to_no_shows: true }])('permanent restrictions cannot be bypassed by a future schedule: %j', override => {
  expect(restriction.getDeliveryScheduleMessage(menu(override), '2026-11-09', '2026-11-09T17:45:00.000Z')).toBeTruthy();
  expect(restriction.getDeliveryRestrictionMessage(menu(override))).toContain(override.delivery_disabled ? 'disabled by the restaurant' : 'order history');
});

test('service hours and management window intersect, with explicit closed days and store fallback', () => {
  const limited = hours.map(h => ({ ...h, time_from: '13:00', time_to: '21:00' }));
  const slots = schedule.buildScheduleTimeOptions(params({ hours: { ...params().hours, delivery: limited } }));
  expect(slots[0].value).toBe('2026-11-09T18:00:00.000Z');
  expect(slots.at(-1).value).toBe('2026-11-10T01:45:00.000Z');
  expect(schedule.buildScheduleTimeOptions(params({ hours: { ...params().hours, delivery: hours.map(h => ({ ...h, is_closed: true })) } }))).toEqual([]);
  expect(schedule.buildScheduleTimeOptions(params({ hours: { ...params().hours, delivery: [], store: limited } }))).toEqual(slots);
});

test('Toronto date keys, UTC timestamps and DST remain independent of browser timezone', () => {
  const now = new Date('2026-11-09T04:30:00Z');
  expect(schedule.getSelectedDateKey(null, now)).toBe('2026-11-08');
  expect(schedule.buildScheduleDateOptions('DELIVERY', params().hours, 'America/Toronto', now)[0].value).toBe('2026-11-08');
  expect(schedule.buildScheduleTimeOptions(params())[0].value).toBe('2026-11-09T17:00:00.000Z');
  const overnight = hours.map(h => ({ ...h, time_from: '23:00', time_to: '04:00' }));
  for (const [date, now] of [['2027-03-14', '2027-03-14T04:00:00Z'], ['2026-11-01', '2026-11-01T03:00:00Z']]) {
    const slots = schedule.buildScheduleTimeOptions(params({ selectedDateKey: date, now: new Date(now),
      hours: { pickup: hours, delivery: overnight, store: hours } }));
    const instants = slots.map(s => Date.parse(s.value));
    expect(instants).toEqual([...instants].sort((a, b) => a - b));
    expect(new Set(instants).size).toBe(instants.length);
    if (date.includes('03-14')) expect(slots.some(s => s.label.startsWith('2:'))).toBe(false);
    else {
      const repeated = slots.filter(s => s.label.startsWith('1:30'));
      expect(repeated).toHaveLength(2);
      expect(repeated[0].label).not.toBe(repeated[1].label);
    }
  }
});

test.each([['cart', CartOrderSettings], ['menu', MenuPage]])('%s lets Delivery unlock future slots and commits draft schedule despite closed committed catalog', async (_name, Component) => {
  await act(async () => { renderer = create(React.createElement(Component, { menu: menu() })); });
  await act(async () => renderer.root.findByProps({ className: 'wk-order-settings-action' }).props.onClick());
  const delivery = renderer.root.findAllByType('button').find(b => b.props.role === 'radio' && b.children.includes('DELIVERY'));
  expect(delivery.props.disabled).toBe(false);
  await act(async () => delivery.props.onClick());
  let selects = renderer.root.findAllByType('select');
  expect(selects[1].findAllByType('option').some(o => o.props.value === 'ASAP')).toBe(false);
  await act(async () => selects[1].props.onChange({ target: { value: '2026-11-09T17:45:00.000Z' } }));
  await act(async () => renderer.root.findByProps({ className: 'wk-order-settings-action' }).props.onClick());
  expect(mockCart.commitOrderContext).toHaveBeenCalledWith({ fulfillmentType: 'DELIVERY', scheduledFor: '2026-11-09T17:45:00.000Z' });
});

test('changing draft date immediately updates options and replaces an unavailable time instead of committing it', async () => {
  await act(async () => { renderer = create(React.createElement(CartOrderSettings, { menu: menu() })); });
  await act(async () => renderer.root.findByProps({ className: 'wk-order-settings-action' }).props.onClick());
  await act(async () => renderer.root.findAllByType('button').find(b => b.props.role === 'radio' && b.children.includes('DELIVERY')).props.onClick());
  await act(async () => renderer.root.findAllByType('select')[0].props.onChange({ target: { value: '2026-11-10' } }));
  const times = renderer.root.findAllByType('select')[1].findAllByType('option');
  expect(times.every(t => t.props.value.startsWith('2026-11-10T') || t.props.value.startsWith('2026-11-11T'))).toBe(true);
  // Simulate a stale DOM event bypassing the options list.
  await act(async () => {
    renderer.root.findAllByType('select')[1].props.onChange({ target: { value: 'ASAP' } });
  });
  expect(renderer.root.findAllByType('select')[1].props.value).not.toBe('ASAP');
  await act(async () => renderer.root.findByProps({ className: 'wk-order-settings-action' }).props.onClick());
  expect(mockCart.commitOrderContext).toHaveBeenCalledWith(expect.objectContaining({ scheduledFor: '2026-11-10T17:00:00.000Z' }));
});

test.each([{ delivery_disabled: true }, { delivery_blocked_due_to_no_shows: true }])('cart keeps Delivery disabled for management/account restrictions %j', async override => {
  await act(async () => { renderer = create(React.createElement(CartOrderSettings, { menu: menu(override) })); });
  await act(async () => renderer.root.findByProps({ className: 'wk-order-settings-action' }).props.onClick());
  expect(renderer.root.findAllByType('button').find(b => b.children.includes('DELIVERY')).props.disabled).toBe(true);
});

test('a delivery slot that becomes too soon while the panel is open is rechecked before saving', async () => {
  await act(async () => { renderer = create(React.createElement(CartOrderSettings, { menu: menu() })); });
  await act(async () => renderer.root.findByProps({ className: 'wk-order-settings-action' }).props.onClick());
  await act(async () => renderer.root.findAllByType('button').find(b => b.props.role === 'radio' && b.children.includes('DELIVERY')).props.onClick());
  await act(async () => renderer.root.findAllByType('select')[1].props.onChange({ target: { value: '2026-11-09T17:45:00.000Z' } }));
  jest.setSystemTime(new Date('2026-11-09T17:20:30Z'));
  await act(async () => renderer.root.findByProps({ className: 'wk-order-settings-action' }).props.onClick());
  expect(mockCart.commitOrderContext).not.toHaveBeenCalled();
  expect(screen()).toContain('unavailable or too soon');
});

test('a 24-hour weekly service window carries into the following day using the backend semantics', () => {
  const continuous = [{ day_of_week: 1, time_from: '12:00', time_to: '12:00', is_closed: false }];
  const deliveryHours = { pickup: hours, delivery: continuous, store: [] };
  const monday = schedule.buildScheduleTimeOptions(params({ hours: deliveryHours }));
  expect(monday[0].value).toBe('2026-11-09T17:00:00.000Z');
  const tuesday = schedule.buildScheduleTimeOptions(params({ selectedDateKey: '2026-11-10', hours: deliveryHours }));
  expect(tuesday[0].value).toBe('2026-11-10T05:00:00.000Z');
  expect(tuesday.at(-1).value).toBe('2026-11-10T16:45:00.000Z');
});

test('initial order method modal offers scheduled delivery while currently closed', async () => {
  await act(async () => { renderer = create(React.createElement(OrderMethodModal, { open: true, defaultMethod: 'DELIVERY', onClose: jest.fn(), onContinue: jest.fn() })); });
  const delivery = renderer.root.findAllByType('button').find(b => b.props.role === 'radio' && String(b.props['aria-label']).startsWith('Delivery'));
  expect(delivery.props.disabled).toBe(false);
  expect(screen()).toContain('closed right now');
  expect(screen()).toContain('FROM $8');
  await act(async () => renderer.root.findByProps({ className: 'wk-method-continue' }).props.onClick());
  expect(screen()).not.toContain('ASAP (40-60');
  expect(renderer.root.findByProps({ className: 'wk-method-continue' }).props.disabled).toBe(false);
  await act(async () => renderer.root.findByProps({ className: 'wk-method-continue' }).props.onClick());
  expect(screen()).toContain('WHERE SHOULD WE DELIVER');
});
