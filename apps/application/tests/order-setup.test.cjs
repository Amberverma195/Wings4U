const {
  ORDER_SETUP_TTL_MS, readOrderSetup, normalizeDeliveryAddress, validDeliveryAddress,
  buildOrderSlots, serviceAvailable,
} = require('../src/lib/order-setup');

const now = Date.parse('2026-10-17T16:00:00Z'); // Noon in Toronto, Saturday.
const hours = [{ day_of_week: 6, time_from: '11:00', time_to: '15:00', is_closed: false }];
const location = {
  timezone: 'America/Toronto', pickup_hours: hours, delivery_hours: hours, store_hours: hours,
  pickup_min_minutes: 15, delivery_min_minutes: 40, delivery_max_minutes: 60, estimated_prep_minutes: 15,
};
const selection = {
  v: 1, lastActiveAt: now, fulfillmentType: 'DELIVERY', scheduledFor: null,
  deliveryAddress: normalizeDeliveryAddress(' 12  Main St unit 2 ', 'n5y4j7'),
};

test('restores within fifteen minutes and expires at the boundary', () => {
  expect(readOrderSetup(JSON.stringify(selection), now + ORDER_SETUP_TTL_MS - 1)).toEqual(selection);
  expect(readOrderSetup(JSON.stringify(selection), now + ORDER_SETUP_TTL_MS)).toBeNull();
});

test('rejects corrupt, expired scheduled, and incomplete delivery selections', () => {
  for (const value of [null, '{}', '{', JSON.stringify({ ...selection, lastActiveAt: now + 1 }),
    JSON.stringify({ ...selection, deliveryAddress: null }),
    JSON.stringify({ ...selection, fulfillmentType: 'PICKUP', deliveryAddress: 7 }),
    JSON.stringify({ ...selection, fulfillmentType: 'PICKUP', deliveryAddress: { line1: 12 } }),
    JSON.stringify({ ...selection, scheduledFor: 'bad date' }),
    JSON.stringify({ ...selection, scheduledFor: new Date(now).toISOString() })]) {
    expect(readOrderSetup(value, now)).toBeNull();
  }
  expect(validDeliveryAddress(selection.deliveryAddress)).toBe(true);
  expect(validDeliveryAddress(normalizeDeliveryAddress('', 'n5y4j7'))).toBe(false);
  expect(validDeliveryAddress(normalizeDeliveryAddress('12 Main', 'invalid'))).toBe(false);
});

test('only offers future slots in store-local hours with the right lead time', () => {
  const pickup = buildOrderSlots(location, 'PICKUP', now);
  const delivery = buildOrderSlots(location, 'DELIVERY', now);
  expect(pickup[0].value).toBe('2026-10-17T16:15:00.000Z');
  expect(pickup.at(-1).value).toBe('2026-10-17T18:45:00.000Z');
  expect(delivery[0].value).toBe('2026-10-17T16:45:00.000Z');
  expect(pickup.every(slot => slot.dateKey === '2026-10-17')).toBe(true);
  expect(buildOrderSlots({ ...location, pickup_hours: [], store_hours: [] }, 'PICKUP', now)).toEqual([]);
});

test('handles overnight hours and delivery restrictions independently of pickup', () => {
  const overnight = [{ day_of_week: 6, time_from: '22:00', time_to: '02:00', is_closed: false }];
  const store = { ...location, pickup_hours: overnight, store_hours: overnight };
  expect(serviceAvailable(store, 'PICKUP', new Date('2026-10-18T05:45:00Z'))).toBe(true);
  expect(serviceAvailable(store, 'PICKUP', new Date('2026-10-18T06:00:00Z'))).toBe(false);
  const restricted = { ...location, delivery_available_from_minutes: 13 * 60, delivery_available_until_minutes: 14 * 60 };
  expect(serviceAvailable(restricted, 'DELIVERY', new Date(now))).toBe(false);
  expect(serviceAvailable(restricted, 'PICKUP', new Date(now))).toBe(true);
  expect(buildOrderSlots(restricted, 'DELIVERY', now).map(s => s.value)).toEqual([
    '2026-10-17T17:00:00.000Z', '2026-10-17T17:15:00.000Z', '2026-10-17T17:30:00.000Z', '2026-10-17T17:45:00.000Z',
  ]);
  expect(buildOrderSlots({ ...location, delivery_disabled: true }, 'DELIVERY', now)).toEqual([]);
});

test('keeps both repeated clock times distinct across the fall DST change', () => {
  const sunday = [{ day_of_week: 0, time_from: '00:00', time_to: '03:00', is_closed: false }];
  const slots = buildOrderSlots({ ...location, pickup_hours: sunday, store_hours: sunday }, 'PICKUP', Date.parse('2026-11-01T04:00:00Z'));
  const repeated = slots.filter(s => s.label.startsWith('1:30'));
  expect(repeated).toHaveLength(2);
  expect(repeated.map(s => s.value)).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']);
  expect(repeated[0].label).not.toBe(repeated[1].label);
});
