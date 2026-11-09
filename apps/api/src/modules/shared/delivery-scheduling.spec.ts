jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
import { getDeliveryAvailability, assertDeliveryAvailable } from '../../common/utils/delivery-availability';
import { assertLocationOpenForFulfillment, assertScheduledOrderingTime, getScheduleContext } from './order-validation';
import { CatalogService } from '../catalog/catalog.service';
import { DeliveryPricingService } from '../delivery-pricing/delivery-pricing.service';
import { DeliveryQuoteTokenService } from '../delivery-pricing/delivery-quote-token.service';
const { buildScheduleTimeOptions, DEFAULT_SCHEDULING_CONFIG } = require('../../../../web/src/lib/order-scheduling');

const timezone = 'America/Toronto';
const settings = { deliveryDisabled: false, deliveryAvailableFromMinutes: 12 * 60, deliveryAvailableUntilMinutes: 22 * 60,
  busyModeEnabled: false, busyModePrepTimeMinutes: null, defaultPrepTimeMinutes: 30,
  defaultDeliveryMinMinutes: 40, defaultDeliveryMaxMinutes: 60 };
const hours = Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, time_from: '11:00', time_to: '23:00', is_closed: false }));
const dbHours = hours.map(h => ({ serviceType: 'DELIVERY', dayOfWeek: h.day_of_week, isClosed: false,
  timeFrom: new Date('1970-01-01T11:00:00Z'), timeTo: new Date('1970-01-01T23:00:00Z') }));
const now = new Date('2026-11-09T05:10:00Z');
const address = { line1: 'Fixture Street', city: 'London', postal_code: 'N6K 1A1' };
function fixture(overrides = {}, serviceHours = dbHours, metres = 14000) {
  const effectiveSettings = { ...settings, ...overrides };
  const db: any = { location: { findUnique: jest.fn(async () => ({ id: 'fixture', name: 'Fixture', isActive: true,
    timezoneName: timezone, settings: effectiveSettings, hours: serviceHours, menuCategories: [] })) },
    locationSettings: { findUnique: jest.fn(async () => effectiveSettings) },
    locationHours: { findMany: jest.fn(async () => serviceHours) } };
  const google: any = { computeDrivingDistanceMetres: jest.fn(async () => metres) };
  const redis: any = { getJson: jest.fn(async () => null), setJson: jest.fn(async () => true) };
  const rateLimiter: any = { check: jest.fn(async () => ({ allowed: true })) };
  const quotes = new DeliveryPricingService(db, google, new DeliveryQuoteTokenService(), redis, rateLimiter);
  return { db, google, quotes, effectiveSettings };
}

describe('scheduled delivery availability uses restaurant time, not current closure', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
  afterEach(() => jest.useRealTimers());

  it('catalog and quote permit future delivery while the current schedule is closed', async () => {
    const { db, quotes, google } = fixture();
    const cache: any = { getMenuBase: async () => ({ key: 'fixture', value: null }), setMenuBase: async () => {} };
    const catalog = new CatalogService(db, cache);
    expect((await catalog.getMenu('fixture', 'DELIVERY')).location.delivery_currently_available).toBe(false);
    expect((await catalog.getMenu('fixture', 'DELIVERY', '2026-11-09T17:45:00Z')).location.delivery_currently_available).toBe(true);
    for (const scheduledFor of ['2026-11-09T17:45:00Z', '2026-11-10T17:45:00Z']) {
      await expect(quotes.createQuote({ locationId: 'fixture', addressSnapshotJson: address, scheduledFor }))
        .resolves.toMatchObject({ delivery_fee_cents: 1700 });
    }
    expect(google.computeDrivingDistanceMetres).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '2026-11-09T16:45:00Z', '2026-11-10T03:00:00Z', '2026-11-10T03:15:00Z'])('rejects closed ASAP / out-of-window quote %s before routing', async scheduledFor => {
    const { quotes, google } = fixture();
    await expect(quotes.createQuote({ locationId: 'fixture', addressSnapshotJson: address, scheduledFor })).rejects.toMatchObject({ status: 422 });
    expect(google.computeDrivingDistanceMetres).not.toHaveBeenCalled();
  });

  it('manual disable applies to every date and has distinct copy', async () => {
    const { quotes, google } = fixture({ deliveryDisabled: true });
    for (const scheduledFor of [undefined, '2026-11-09T17:45:00Z', '2026-11-10T17:45:00Z']) {
      await expect(quotes.createQuote({ locationId: 'fixture', addressSnapshotJson: address, scheduledFor }))
        .rejects.toThrow('disabled by the restaurant');
    }
    expect(google.computeDrivingDistanceMetres).not.toHaveBeenCalled();
  });

  it('delivery service hours independently reject a time inside the management window', async () => {
    const { quotes, google } = fixture({}, dbHours.map(h => ({ ...h, isClosed: true })));
    await expect(quotes.createQuote({ locationId: 'fixture', addressSnapshotJson: address, scheduledFor: '2026-11-09T17:45:00Z' }))
      .rejects.toThrow('not open for delivery');
    expect(google.computeDrivingDistanceMetres).not.toHaveBeenCalled();
  });

  it('every offered slot passes the existing authoritative checkout/cart validators, including busy prep and tomorrow', async () => {
    jest.setSystemTime(new Date('2026-11-09T17:20:30Z'));
    const { db, effectiveSettings } = fixture({ busyModeEnabled: true, busyModePrepTimeMinutes: 90 });
    const timeOptions = (date: string) => buildScheduleTimeOptions({ fulfillmentType: 'DELIVERY', selectedDateKey: date,
      config: DEFAULT_SCHEDULING_CONFIG, timezone, pickupLeadMinutes: 90, now: new Date(),
      hours: { pickup: hours, delivery: hours, store: hours,
        deliveryAvailableFromMinutes: settings.deliveryAvailableFromMinutes, deliveryAvailableUntilMinutes: settings.deliveryAvailableUntilMinutes } });
    for (const date of ['2026-11-09', '2026-11-10']) {
      const slots = timeOptions(date).filter((s: any) => s.value !== 'ASAP');
      expect(slots.length).toBeGreaterThan(0);
      for (const slot of slots) {
        expect(() => assertScheduledOrderingTime(slot.value, effectiveSettings)).not.toThrow();
        expect(() => assertDeliveryAvailable({ settings: effectiveSettings, timezone, referenceDate: new Date(slot.value) })).not.toThrow();
        await expect(assertLocationOpenForFulfillment({ db, locationId: 'fixture', fulfillmentType: 'DELIVERY',
          context: getScheduleContext(new Date(slot.value), timezone) })).resolves.toBeUndefined();
      }
    }
    expect(() => assertScheduledOrderingTime('2026-11-09T17:45:00Z', effectiveSettings)).toThrow('at least 90 minutes');
  });

  it.each([[20000, 2300], [20001, null]])('future scheduling preserves the strict driving limit at %i metres', async (metres, fee) => {
    const { quotes } = fixture({}, dbHours, metres);
    const quote = quotes.createQuote({ locationId: 'fixture', addressSnapshotJson: address, scheduledFor: '2026-11-09T17:45:00Z' });
    if (fee == null) await expect(quote).rejects.toMatchObject({ status: 422 });
    else await expect(quote).resolves.toMatchObject({ delivery_fee_cents: fee });
  });

  it('Toronto overnight management windows cross midnight and exclude the closing minute', () => {
    const overnight = { ...settings, deliveryAvailableFromMinutes: 23 * 60, deliveryAvailableUntilMinutes: 2 * 60 };
    expect(getDeliveryAvailability({ settings: overnight, timezone, referenceDate: new Date('2026-11-10T05:45:00Z') }).available).toBe(true);
    expect(getDeliveryAvailability({ settings: overnight, timezone, referenceDate: new Date('2026-11-10T07:00:00Z') }).available).toBe(false);
  });
});
