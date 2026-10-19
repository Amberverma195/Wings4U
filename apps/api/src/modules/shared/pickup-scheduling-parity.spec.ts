jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
import { CatalogService } from '../catalog/catalog.service';
import { assertScheduledOrderingTime, assertLocationOpenForFulfillment, getScheduleContext } from './order-validation';
const { buildScheduleTimeOptions, normalizeSchedulingConfig, formatEtaLabel } = require('../../../../web/src/lib/order-scheduling');

describe('fixed pickup advertisement with authoritative kitchen scheduling', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-19T16:00:30Z')); });
  afterEach(() => jest.useRealTimers());
  const hours = Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, time_from: '11:00', time_to: '23:00', is_closed: false }));
  const dbHours = hours.map(h => ({ dayOfWeek: h.day_of_week, serviceType: 'PICKUP', isClosed: false,
    timeFrom: new Date('1970-01-01T11:00:00Z'), timeTo: new Date('1970-01-01T23:00:00Z') }));
  it.each([
    { busyModeEnabled: false, busyModePrepTimeMinutes: null, defaultPrepTimeMinutes: 30 },
    { busyModeEnabled: true, busyModePrepTimeMinutes: 45, defaultPrepTimeMinutes: 30 },
    { busyModeEnabled: true, busyModePrepTimeMinutes: 0, defaultPrepTimeMinutes: 30 },
    { busyModeEnabled: false, busyModePrepTimeMinutes: 60, defaultPrepTimeMinutes: 15 },
  ])('offers slots accepted by real lead-time and hours validators: %j', async operational => {
    const settings = { ...operational, defaultPickupMinMinutes: 30, defaultPickupMaxMinutes: 39,
      defaultDeliveryMinMinutes: 40, defaultDeliveryMaxMinutes: 60 };
    const db: any = { location: { findUnique: jest.fn(async () => ({ id: 'fixture', name: 'Fixture', isActive: true,
      timezoneName: 'America/Toronto', settings, hours: [], menuCategories: [] })) },
      locationHours: { findMany: jest.fn(async () => dbHours) } };
    const cache: any = { getMenuBase: async () => ({ key: 'fixture', value: null }), setMenuBase: async () => {} };
    const menu = await new CatalogService(db, cache).getMenu('fixture', 'PICKUP');
    const config = normalizeSchedulingConfig({ pickup: { minMinutes: menu.location.pickup_min_minutes, maxMinutes: menu.location.pickup_max_minutes },
      delivery: { minMinutes: menu.location.delivery_min_minutes, maxMinutes: menu.location.delivery_max_minutes } });
    expect(formatEtaLabel('PICKUP', config)).toBe('ASAP (15\u201320 min)');
    expect(formatEtaLabel('DELIVERY', config)).toBe('ASAP (40-60 min)');
    const lead = operational.busyModeEnabled && operational.busyModePrepTimeMinutes ? operational.busyModePrepTimeMinutes : operational.defaultPrepTimeMinutes;
    expect(menu.location.estimated_prep_minutes).toBe(lead);
    // Serialization keeps operational settings for existing API/mobile consumers.
    expect(menu.location.pickup_min_minutes).toBe(30); expect(menu.location.pickup_max_minutes).toBe(39);
    const slots = buildScheduleTimeOptions({ fulfillmentType: 'PICKUP', selectedDateKey: '2026-10-19', config,
      hours: { pickup: hours, delivery: hours, store: hours }, timezone: menu.location.timezone,
      now: new Date(), pickupLeadMinutes: menu.location.estimated_prep_minutes });
    expect(slots.length).toBeGreaterThan(1);
    for (const slot of slots.filter((s: any) => s.value !== 'ASAP')) {
      expect(() => assertScheduledOrderingTime(slot.value, settings)).not.toThrow();
      await expect(assertLocationOpenForFulfillment({ db, locationId: 'fixture', fulfillmentType: 'PICKUP',
        context: getScheduleContext(new Date(slot.value), menu.location.timezone) })).resolves.toBeUndefined();
    }
    expect(() => assertScheduledOrderingTime(new Date(Date.now() + (lead - 1) * 60_000).toISOString(), settings)).toThrow();
    // Existing orders and checkout retain real operational prep, not the ad.
    expect(settings).toEqual(expect.objectContaining(operational));
  });

  it('does not offer closed-time ASAP or scheduled pickup after the final slot', async () => {
    const now = new Date('2026-10-20T03:00:00Z'); jest.setSystemTime(now);
    const db: any = { locationHours: { findMany: async () => dbHours } };
    const context = getScheduleContext(now, 'America/Toronto');
    await expect(assertLocationOpenForFulfillment({ db, locationId: 'fixture', fulfillmentType: 'PICKUP', context })).rejects.toThrow();
    expect(buildScheduleTimeOptions({ fulfillmentType: 'PICKUP', selectedDateKey: '2026-10-19', config: normalizeSchedulingConfig(null),
      hours: { pickup: hours, delivery: hours, store: hours }, timezone: 'America/Toronto', now, pickupLeadMinutes: 45 })).toEqual([]);
  });
});
