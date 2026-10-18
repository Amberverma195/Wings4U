jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
import { PromotionsService } from './promotions.service';
import { firstOrderDealCode } from './first-order-deal';
import { DELIVERY_CAP_MESSAGE, PROMO_SCHEDULE_MESSAGE } from './promotion-schedule';

const clockTime = (value: string) => new Date(`1970-01-01T${value}Z`);
const restriction = (days: number[] = [], from: string | null = null, to: string | null = null) => ({
  validDays: days.map(dayOfWeek => ({ dayOfWeek })), validTimeFrom: from ? clockTime(from) : null, validTimeTo: to ? clockTime(to) : null,
});
function fixture(type = 'PERCENT', cap: number | null = null) {
  const promo = { id: 'regular', code: 'SAVE', name: 'Save', discountType: type, discountValue: 10, minSubtotalCents: 0,
    maxDiscountCents: cap, eligibleFulfillmentType: 'BOTH', usageLimitTotal: null, usageLimitPerCustomer: null,
    isOneTimePerCustomer: false, isFirstOrderOnly: false, rulePayloadJson: { publicCode: 'FIRSTCUSTOM' }, bxgyRule: null,
    isActive: true, archivedAt: null as Date | null, startsAt: null as Date | null, endsAt: null as Date | null, ...restriction() };
  const firstRows = [{ ...promo, id: 'first', code: firstOrderDealCode('store', type as never) }];
  const regularRows = [promo];
  const db = { location: { findUnique: jest.fn().mockResolvedValue({ timezoneName: 'America/Toronto' }) },
    promoCode: { findFirst: jest.fn().mockResolvedValue(promo), findMany: jest.fn(async (args: any) => args.where.code?.in ? firstRows : regularRows) },
    promoRedemption: { count: jest.fn().mockResolvedValue(0) }, order: { count: jest.fn().mockResolvedValue(0) } };
  const service = new PromotionsService(db as never);
  const params = { locationId: 'store', userId: 'customer', code: 'SAVE', itemSubtotalCents: 2000, deliveryFeeCents: 500,
    fulfillmentType: 'DELIVERY' as 'PICKUP' | 'DELIVERY', lines: [{ menuItemId: 'burger', menuItemSlug: 'burger', categoryId: 'food', quantity: 1, unitPriceCents: 2000 }] };
  return { promo, firstRows, regularRows, db, service, params,
    run: () => service.evaluatePromo(params), first: () => service.evaluateFirstOrderDeal({ ...params, explicitlyOptedIn: true }) };
}

describe('coupon schedules use restaurant-local server evaluation time', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-16T22:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  it.each([false, true].flatMap(first => [
    { at: '2026-10-16T22:00:00Z', allowed: true, label: 'Friday 18:00' },
    { at: '2026-10-16T20:59:59.999Z', allowed: false, label: 'before opening' },
    { at: '2026-10-16T21:00:00Z', allowed: true, label: 'exact opening' },
    { at: '2026-10-17T01:59:59.999Z', allowed: true, label: 'last instant before close' },
    { at: '2026-10-17T02:00:00Z', allowed: false, label: 'exact closing' },
    { at: '2026-10-17T02:01:00Z', allowed: false, label: 'after closing' },
    { at: '2026-10-13T22:00:00Z', allowed: false, label: 'Tuesday 18:00' },
  ].map(row => ({ first, ...row }))))('first=$first $label ($at) => $allowed', async ({ first, at, allowed }) => {
    const f = fixture(); Object.assign(f.promo, restriction([5], '17:00:00', '22:00:00')); Object.assign(f.firstRows[0], restriction([5], '17:00:00', '22:00:00'));
    jest.setSystemTime(new Date(at));
    const run = first ? f.first : f.run;
    if (allowed) expect(await run()).toMatchObject({ discountCents: 200 });
    else await expect(run()).rejects.toMatchObject({ response: { message: PROMO_SCHEDULE_MESSAGE, field: 'promo_code' } });
    expect(f.db.location.findUnique).toHaveBeenCalledWith({ where: { id: 'store' }, select: { timezoneName: true } });
  });
  it.each([false, true].flatMap(first => [
    { name: 'empty restrictions', data: {}, allowed: true },
    { name: 'future start', data: { startsAt: new Date('2026-10-16T22:00:00.001Z') }, allowed: false },
    { name: 'exact start date', data: { startsAt: new Date('2026-10-16T22:00:00Z') }, allowed: true },
    { name: 'expired date', data: { endsAt: new Date('2026-10-16T21:59:59.999Z') }, allowed: false },
    { name: 'exact end date', data: { endsAt: new Date('2026-10-16T22:00:00Z') }, allowed: true },
    { name: 'inactive', data: { isActive: false }, allowed: false },
    { name: 'archived', data: { archivedAt: new Date() }, allowed: false },
  ].map(row => ({ first, ...row }))))('first=$first preserves $name', async ({ first, data, allowed }) => {
    const f = fixture(); Object.assign(f.promo, data); Object.assign(f.firstRows[0], data);
    if (allowed) expect(await (first ? f.first() : f.run())).toMatchObject({ discountCents: 200 });
    else await expect(first ? f.first() : f.run()).rejects.toThrow(PROMO_SCHEDULE_MESSAGE);
  });
  it.each([
    { at: '2026-11-01T05:30:00Z', from: '01:00:00', to: '02:00:00', allowed: true },
    { at: '2026-11-01T06:30:00Z', from: '01:00:00', to: '02:00:00', allowed: true },
    { at: '2026-11-01T07:00:00Z', from: '01:00:00', to: '02:00:00', allowed: false },
    { at: '2026-03-08T06:59:59Z', from: '03:00:00', to: '04:00:00', allowed: false },
    { at: '2026-03-08T07:00:00Z', from: '03:00:00', to: '04:00:00', allowed: true },
    { at: '2026-03-08T07:00:00Z', from: '02:00:00', to: '03:00:00', allowed: false },
  ])('Toronto DST at $at in [$from, $to) => $allowed', async ({ at, from, to, allowed }) => {
    const f = fixture(); Object.assign(f.promo, restriction([0], from, to)); jest.setSystemTime(new Date(at));
    if (allowed) expect(await f.run()).toMatchObject({ discountCents: 200 }); else await expect(f.run()).rejects.toThrow(PROMO_SCHEDULE_MESSAGE);
  });
  it('uses the requested location zone rather than fixed Toronto, UTC or server local hours', async () => {
    const f = fixture(); Object.assign(f.promo, restriction([5], '17:00:00', '22:00:00'));
    f.db.location.findUnique.mockResolvedValue({ timezoneName: 'America/Vancouver' });
    await expect(f.run()).rejects.toThrow(PROMO_SCHEDULE_MESSAGE); // 15:00 in Vancouver, 18:00 in Toronto, 22:00 UTC.
    f.db.location.findUnique.mockResolvedValue({ timezoneName: 'Invalid/Zone' });
    await expect(f.run()).rejects.toThrow(PROMO_SCHEDULE_MESSAGE);
  });
  it.each([
    restriction([5], '22:00:00', '02:00:00'), restriction([], '17:00:00', '17:00:00'),
    restriction([], '17:00:00', null), restriction([], null, '22:00:00'), restriction([9]),
  ])('ambiguous or invalid stored schedules do not authorize a benefit: %j', async data => {
    const f = fixture(); Object.assign(f.promo, data); await expect(f.run()).rejects.toThrow(PROMO_SCHEDULE_MESSAGE);
    expect(await f.service.getActivePromos('store')).toEqual([]);
  });
  it('first-order scheduling filters components and active discovery summarizes only available components', async () => {
    const f = fixture('FREE_DELIVERY');
    f.firstRows.push({ ...f.firstRows[0], id: 'percent', code: firstOrderDealCode('store', 'PERCENT'), discountType: 'PERCENT', ...restriction([2]) },
      { ...f.firstRows[0], id: 'fixed', code: firstOrderDealCode('store', 'FIXED_AMOUNT'), discountType: 'FIXED_AMOUNT', discountValue: 300 });
    expect(await f.first()).toMatchObject({ discountCents: 300, waivesDelivery: true,
      redemptions: [{ promoId: 'first', discountAmountCents: 500 }, { promoId: 'fixed', discountAmountCents: 300 }] });
    Object.assign(f.promo, restriction([2]));
    const offers = await f.service.getActivePromos('store', 'customer');
    expect(offers).toHaveLength(1); expect(offers[0]).toMatchObject({ code: 'FIRSTCUSTOM', benefitSummary: 'Free delivery + $3.00 off' });
    expect(offers[0].benefitSummary).not.toContain('10%');
  });
  it('recognizes a custom first-order code even when its schedule/status is unavailable, then rejects eligibility', async () => {
    const f = fixture(); Object.assign(f.firstRows[0], { ...restriction([2]), isActive: false });
    expect(await f.service.isFirstOrderDealPublicCode({ locationId: 'store', code: 'FIRSTCUSTOM' })).toBe(true);
    await expect(f.first()).rejects.toThrow(PROMO_SCHEDULE_MESSAGE);
    expect(await f.service.getActivePromos('store', 'customer')).toHaveLength(1); // Regular SAVE only.
  });
  it('loads day relations for both evaluation and discovery and preserves active/date database filters', async () => {
    const f = fixture(); await f.run(); await f.service.getActivePromos('store');
    expect(f.db.promoCode.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isActive: true, archivedAt: null,
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] }] }),
      include: expect.objectContaining({ validDays: true }) }));
    expect(f.db.promoCode.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ validDays: true }) }));
  });
});

describe('free-delivery cap accounting', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-16T22:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  it.each([false, true].flatMap(first => [
    { fee: 500, cap: null, allowed: true }, { fee: 500, cap: 1000, allowed: true }, { fee: 500, cap: 500, allowed: true },
    { fee: 500, cap: 200, allowed: false }, { fee: 0, cap: 500, allowed: false }, { fee: 750, cap: 1000, allowed: true },
  ].map(row => ({ first, ...row }))))('first=$first fee=$fee cap=$cap => $allowed', async ({ first, fee, cap, allowed }) => {
    const f = fixture('FREE_DELIVERY', cap); f.params.deliveryFeeCents = fee;
    if (allowed) expect(await (first ? f.first() : f.run())).toMatchObject(first
      ? { discountCents: 0, waivesDelivery: true, redemptions: [{ promoId: 'first', discountAmountCents: fee }] }
      : { discountCents: 0, waivesDelivery: true, redemptionValueCents: fee });
    else await expect(first ? f.first() : f.run()).rejects.toThrow(fee === 0 ? 'already free' : DELIVERY_CAP_MESSAGE);
  });
  it.each([false, true])('pickup never receives free delivery (first=%s)', async first => {
    const f = fixture('FREE_DELIVERY'); f.params.fulfillmentType = 'PICKUP'; await expect(first ? f.first() : f.run()).rejects.toThrow('only valid for delivery');
  });
  it.each(['PERCENT', 'FIXED_AMOUNT'])('a rejected first-order delivery component preserves valid %s and records only its benefit', async type => {
    const f = fixture('FREE_DELIVERY', 200); f.firstRows.push({ ...f.firstRows[0], id: 'other', code: firstOrderDealCode('store', type as never),
      discountType: type, discountValue: type === 'PERCENT' ? 10 : 300, maxDiscountCents: null });
    expect(await f.first()).toMatchObject({ discountCents: type === 'PERCENT' ? 200 : 300, waivesDelivery: false,
      redemptions: [{ promoId: 'other', discountAmountCents: type === 'PERCENT' ? 200 : 300 }] });
  });
});
