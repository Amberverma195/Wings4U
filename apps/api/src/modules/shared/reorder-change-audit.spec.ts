import { assertScheduledOrderingTime } from './order-validation';
import { assertBuilderCatalogValid } from './builder-catalog-validation';

describe('d9feb2e -> 1b54a95 scheduled lead-time compatibility audit', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-19T16:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  const settings = [
    { busyModeEnabled: false, busyModePrepTimeMinutes: 30, defaultPrepTimeMinutes: 15 },
    { busyModeEnabled: true, busyModePrepTimeMinutes: 30, defaultPrepTimeMinutes: 15 },
    { busyModeEnabled: true, busyModePrepTimeMinutes: 0, defaultPrepTimeMinutes: 15 },
    { busyModeEnabled: true, busyModePrepTimeMinutes: null, defaultPrepTimeMinutes: 15 },
  ];
  it.each(settings.flatMap(config => [-1, 0, 1].map(offset => ({ config, offset }))))(
    'matches the previous checkout boundary for $config with offset $offset ms', ({ config, offset }) => {
      // The previous checkout block's formula, captured from d9feb2e for this audit.
      const previousLead = config.busyModeEnabled && config.busyModePrepTimeMinutes ? config.busyModePrepTimeMinutes : config.defaultPrepTimeMinutes;
      const scheduledFor = new Date(Date.now() + previousLead * 60_000 + offset).toISOString();
      const previouslyRejected = new Date(scheduledFor) < new Date(Date.now() + previousLead * 60 * 1000);
      if (previouslyRejected) {
        try { assertScheduledOrderingTime(scheduledFor, config); throw new Error('Expected rejection'); }
        catch (error) {
          expect((error as { getStatus(): number }).getStatus()).toBe(422);
          expect((error as { getResponse(): unknown }).getResponse()).toEqual({ message: `Scheduled time must be at least ${previousLead} minutes from now`, field: 'scheduled_for' });
        }
      } else expect(() => assertScheduledOrderingTime(scheduledFor, config)).not.toThrow();
    });
  it.each([undefined, ''])('keeps unscheduled/ASAP requests unchanged (%s)', value => {
    expect(() => assertScheduledOrderingTime(value, settings[0])).not.toThrow();
  });
  it('treats equivalent offset and UTC timestamps equally', () => {
    expect(() => assertScheduledOrderingTime('2026-10-19T12:15:00-04:00', settings[0])).not.toThrow();
    expect(() => assertScheduledOrderingTime('2026-10-19T16:15:00Z', settings[0])).not.toThrow();
  });
  it('explicitly rejects a malformed timestamp; this is intentional stricter validation', () => {
    expect(() => assertScheduledOrderingTime('not-a-date', settings[0])).toThrow('Scheduled time must be at least');
  });
});

it('an independent salad still requires its own size selection', async () => {
  const size = { menuItemId: 'salad', modifierGroupId: 'size', contextKey: 'size', modifierGroup: {
    id: 'size', locationId: 'local', archivedAt: null, name: 'Size', displayLabel: 'Size', contextKey: 'size',
    minSelect: 1, maxSelect: 1, isRequired: true, selectionMode: 'SINGLE', options: [{ id: 'small', isActive: true }],
  } };
  const db = { menuItemModifierGroup: { findMany: jest.fn().mockResolvedValue([size]) } };
  await expect(assertBuilderCatalogValid({ db: db as never, locationId: 'local',
    menuItem: { id: 'salad', name: 'Caesar Salad', slug: 'caesar-salad', builderType: null, modifierGroups: [size] } as never,
    modifierOptionIds: [], fulfillmentType: 'PICKUP', context: { timezone: 'America/Toronto', dow: 1, hhmm: 720 }, wingFlavourMap: new Map() })).rejects.toThrow('Invalid selections for Size');
});
