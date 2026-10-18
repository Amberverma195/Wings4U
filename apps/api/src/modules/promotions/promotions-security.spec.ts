jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
import { PromotionsService, type PromoPricingLine } from './promotions.service';
import { firstOrderDealCode } from './first-order-deal';

const line = (slug: string, price: number, quantity = 1, categoryId = 'ordinary'): PromoPricingLine => ({
  menuItemId: slug, menuItemSlug: slug, categoryId, unitPriceCents: price, quantity,
});
const party75 = () => line('party-75-wings', 9000, 1, 'party');
const party100 = () => line('party-100-wings', 12000, 1, 'party');
const burger = (quantity = 1) => line('burger', 1500, quantity);

function fixture(type = 'PERCENT', overrides: Record<string, unknown> = {}) {
  const promo = { id: 'promo', code: 'SAVE', discountType: type, discountValue: 10, minSubtotalCents: 0,
    isActive: true, archivedAt: null, startsAt: null, endsAt: null, validTimeFrom: null, validTimeTo: null, validDays: [],
    maxDiscountCents: null, eligibleFulfillmentType: 'BOTH', usageLimitTotal: null, usageLimitPerCustomer: null,
    isOneTimePerCustomer: false, isFirstOrderOnly: false, rulePayloadJson: null,
    bxgyRule: { qualifyingProductId: null, qualifyingCategoryId: null, rewardProductId: null, rewardCategoryId: null,
      requiredQty: 1, rewardQty: 1, maxUsesPerOrder: 5 }, ...overrides };
  const db = { location: { findUnique: jest.fn().mockResolvedValue({ timezoneName: 'America/Toronto' }) },
    promoCode: { findFirst: jest.fn().mockResolvedValue(promo), findMany: jest.fn().mockResolvedValue([]) },
    promoRedemption: { count: jest.fn().mockResolvedValue(0) }, order: { count: jest.fn().mockResolvedValue(0) } };
  const service = new PromotionsService(db as never);
  const params = (lines: PromoPricingLine[]) => ({ locationId: 'store', userId: 'customer', code: 'SAVE', lines,
    // Deliberately untrusted aggregate cannot widen the eligible calculation.
    itemSubtotalCents: 9999999, deliveryFeeCents: 500, fulfillmentType: 'DELIVERY' as const });
  const run = (lines: PromoPricingLine[]) => service.evaluatePromo(params(lines));
  const first = (lines: PromoPricingLine[], existingDiscountCents = 0) => service.evaluateFirstOrderDeal({
    ...params(lines), explicitlyOptedIn: true, existingDiscountCents });
  const setFirst = (types: string[], minSubtotalCents = 0) => db.promoCode.findMany.mockResolvedValue(types.map(kind => ({
    ...promo, id: kind, code: firstOrderDealCode('store', kind as never), discountType: kind,
    discountValue: kind === 'PERCENT' ? 10 : 500, minSubtotalCents,
  })));
  return { db, service, promo, run, first, setFirst };
}

describe('Party Special coupon exclusions across every supported promo type', () => {
  it.each(['PERCENT', 'FIXED_AMOUNT', 'FREE_DELIVERY', 'BXGY'].flatMap(type =>
    [party75, party100].map(makeParty => ({ type, slug: makeParty().menuItemSlug, makeParty }))))(
    '$type rejects a $slug-only cart with a helpful promo error', async ({ type, makeParty }) => {
      await expect(fixture(type).run([makeParty()])).rejects.toMatchObject({ response: {
        message: 'No eligible items for this promo. Party Specials are excluded from coupons.', field: 'promo_code',
      } });
    },
  );
  it.each([party75, party100])('MYFIRSTORDER cannot discount or waive delivery for a Party-only cart', async makeParty => {
    const f = fixture(); f.setFirst(['FREE_DELIVERY', 'PERCENT', 'FIXED_AMOUNT']);
    await expect(f.first([makeParty()])).rejects.toThrow('Party Specials are excluded');
  });
  it.each([
    { lines: [party75(), burger()], expected: 150 },
    { lines: [party100(), burger(3), line('fries', 500, 2)], expected: 550 },
    { lines: [burger(2)], expected: 300 },
  ])('percentage discounts only eligible merchandise ($expected cents)', async ({ lines, expected }) => {
    expect(await fixture().run(lines)).toMatchObject({ discountCents: expected, redemptionValueCents: expected });
  });
  it.each(['PERCENT', 'FIXED_AMOUNT'])('%s cannot exceed eligible merchandise or become negative', async type => {
    expect(await fixture(type, { discountValue: 99999 }).run([party75(), burger()])).toMatchObject({ discountCents: 1500, redemptionValueCents: 1500 });
    expect(await fixture(type, { discountValue: -10 }).run([party75(), burger()])).toMatchObject({ discountCents: 0, redemptionValueCents: 0 });
    expect(await fixture(type, { discountValue: 1000, maxDiscountCents: 100 }).run([party75(), burger()])).toMatchObject({ discountCents: 100 });
  });
  it.each(['PERCENT', 'FIXED_AMOUNT', 'FREE_DELIVERY', 'BXGY'])('%s minimum spend ignores Party value', async type => {
    const f = fixture(type, { minSubtotalCents: 2500 });
    await expect(f.run([party75(), burger()])).rejects.toThrow('Minimum order');
    const result = await f.run([party75(), burger(2)]);
    expect(result.discountCents).toBeLessThanOrEqual(3000);
    expect(result.waivesDelivery).toBe(type === 'FREE_DELIVERY');
  });
  it.each(['product', 'category'])('BXGY excludes Party qualifiers and rewards for %s targeting', async target => {
    const f = fixture('BXGY');
    Object.assign(f.promo.bxgyRule!, target === 'product'
      ? { qualifyingProductId: 'party-75-wings', rewardProductId: 'burger' }
      : { qualifyingCategoryId: 'party', rewardCategoryId: 'ordinary' });
    await expect(f.run([party75(), burger()])).rejects.toThrow('Buy X Get Y');
    Object.assign(f.promo.bxgyRule!, target === 'product'
      ? { qualifyingProductId: 'burger', rewardProductId: 'party-75-wings' }
      : { qualifyingCategoryId: 'ordinary', rewardCategoryId: 'party' });
    await expect(f.run([party75(), burger(2)])).rejects.toThrow('Buy X Get Y');
  });
  it.each(['PERCENT', 'FIXED_AMOUNT', 'FREE_DELIVERY', 'BXGY'].flatMap(type => ['product', 'category'].map(target => ({ type, target }))))(
    '$type respects $target target records without admitting Party lines', async ({ type, target }) => {
      const f = fixture(type, target === 'product' ? { productTargets: [{ menuItemId: 'party-75-wings' }] } : { categoryTargets: [{ menuCategoryId: 'party' }] });
      await expect(f.run([party75(), burger(2)])).rejects.toThrow('No eligible items');
      Object.assign(f.promo, target === 'product' ? { productTargets: [{ menuItemId: 'burger' }] } : { categoryTargets: [{ menuCategoryId: 'ordinary' }] });
      const result = await f.run([party75(), burger(2), line('unrelated', 5000, 1, 'other')]);
      expect(result).toMatchObject({ discountCents: type === 'PERCENT' ? 300 : type === 'BXGY' ? 1500 : type === 'FIXED_AMOUNT' ? 10 : 0,
        waivesDelivery: type === 'FREE_DELIVERY' });
    },
  );
  it.each([5, 6.67, 8, 11])('legacy/current Party payload weight %s cannot change BOGO eligibility', async weight => {
    const party = { ...party75(), quantity: 10, builderPayload: { builder_type: 'WINGS', weight_lb: weight } };
    expect(await fixture('BXGY').run([party, burger(2)])).toMatchObject({ discountCents: 1500 });
    const f = fixture('BXGY', { rulePayloadJson: { bxgy: { qualifyingSize: { kind: 'weight_lb', weightLb: weight } } } });
    await expect(f.run([party, burger()])).rejects.toThrow('Buy X Get Y');
  });
  it('preserves legitimate non-party size-restricted and product-specific BOGO', async () => {
    const f = fixture('BXGY', { rulePayloadJson: { bxgy: { qualifyingSize: { kind: 'weight_lb', weightLb: 1.5 } } } });
    Object.assign(f.promo.bxgyRule!, { qualifyingProductId: 'combo-1.5lb', rewardProductId: 'burger' });
    expect(await f.run([{ ...line('combo-1.5lb', 2000), builderPayload: { builder_type: 'WING_COMBO', weight_lb: 1.5 } }, burger()])).toMatchObject({ discountCents: 1500 });
  });
  it('first-order percent/fixed/free-delivery benefits share eligible bases and retain their combined cap', async () => {
    const f = fixture(); f.setFirst(['FREE_DELIVERY', 'PERCENT', 'FIXED_AMOUNT']);
    expect(await f.first([party75(), burger()])).toMatchObject({ discountCents: 650, waivesDelivery: true,
      redemptions: [{ promoId: 'FREE_DELIVERY', discountAmountCents: 500 }, { promoId: 'PERCENT', discountAmountCents: 150 }, { promoId: 'FIXED_AMOUNT', discountAmountCents: 500 }] });
    expect(await f.first([party75(), burger()], 1400)).toMatchObject({ discountCents: 100 });
  });
  it.each(['PERCENT', 'FIXED_AMOUNT', 'FREE_DELIVERY'])('first-order %s respects eligible-only minimum spend', async type => {
    const f = fixture(); f.setFirst([type], 2500);
    await expect(f.first([party100(), burger()])).rejects.toThrow('Minimum order');
    expect(await f.first([party100(), burger(2)])).toMatchObject(type === 'FREE_DELIVERY' ? { waivesDelivery: true } : { discountCents: type === 'PERCENT' ? 300 : 500 });
  });
  it.each(['PERCENT', 'FIXED_AMOUNT', 'FREE_DELIVERY'])('first-order %s cannot target an exempt Party SKU in a mixed cart', async type => {
    const f = fixture(type, { productTargets: [{ menuItemId: 'party-75-wings' }] }); f.setFirst([type]);
    await expect(f.first([party75(), burger()])).rejects.toThrow('No eligible items');
  });
  it('retains first-order opt-in, prior-order, usage and fulfillment protections', async () => {
    const f = fixture('PERCENT', { usageLimitTotal: 1 }); f.db.promoRedemption.count.mockResolvedValue(1);
    await expect(f.run([burger()])).rejects.toThrow('usage limit');
    const pickup = fixture('FREE_DELIVERY', { eligibleFulfillmentType: 'PICKUP' });
    await expect(pickup.run([burger()])).rejects.toThrow('pickup');
    f.setFirst(['PERCENT']); f.db.order.count.mockResolvedValue(1);
    expect(await f.first([party75(), burger()])).toBeNull();
  });
  it('unidentified SKU lines fail closed instead of authorizing coupons from aggregate prices', async () => {
    await expect(fixture().run([{ ...burger(), menuItemSlug: null }])).rejects.toThrow('No eligible items');
  });
});
