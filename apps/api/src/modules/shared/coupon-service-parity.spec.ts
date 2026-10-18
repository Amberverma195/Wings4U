jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../database/order-number', () => ({ allocateNextOrderNumber: jest.fn().mockResolvedValue(1) }));
jest.mock('../customers/customer-addresses.service', () => ({ ensureCustomerAddressExists: jest.fn().mockResolvedValue({}) }));
import { CartService } from '../cart/cart.service';
import { CheckoutService } from '../checkout/checkout.service';
import { PromotionsService } from '../promotions/promotions.service';
import { firstOrderDealCode } from '../promotions/first-order-deal';

describe('authoritative coupon pricing through real quote and checkout services', () => {
  const stop = new Error('STOP_AT_MOCK_ORDER_WRITE');
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-19T16:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  function fixture(type: string, options: { first?: boolean; minimum?: number; burgerQty?: number; party?: string; onlyParty?: boolean; delivery?: boolean; standardFreeThreshold?: number; taxDiscount?: boolean } = {}) {
    const category = { id: 'ordinary', name: 'Menu', slug: 'burgers', availableFromMinutes: null, availableUntilMinutes: null };
    const base = { locationId: 'store', isAvailable: true, stockStatus: 'NORMAL', archivedAt: null, allowedFulfillmentType: 'BOTH', requiresSpecialInstructions: false,
      categoryId: 'ordinary', category, schedules: [], modifierGroups: [], removableIngredients: [], builderType: null };
    const slug = options.party ?? 'party-75-wings';
    const party = { ...base, id: 'party', slug, name: slug === 'party-75-wings' ? '75 Wings - 5 Flavours' : '100 Wings - 5 Flavours', builderType: 'WINGS',
      basePriceCents: slug === 'party-75-wings' ? 9000 : 12000, categoryId: 'party-category', category: { ...category, id: 'party-category', slug: 'party-specials' } };
    const burger = { ...base, id: 'burger', slug: 'veggie-burger', name: 'Burger', basePriceCents: 1500 };
    const groups = [{ menuItemId: 'party', modifierGroupId: 'type', sortOrder: 0, contextKey: null,
      modifierGroup: { id: 'type', name: 'Wing Type', displayLabel: 'Wing Type', locationId: 'store', archivedAt: null, selectionMode: 'SINGLE',
        isRequired: true, minSelect: 1, maxSelect: 1, options: [{ id: 'breaded', modifierGroupId: 'type', name: 'House Breaded Bone-In', isActive: true, priceDeltaCents: 0, linkedFlavourId: null }] } },
      ...Array.from({ length: 5 }, (_, index) => ({ menuItemId: 'party', modifierGroupId: `flavour-${index}`, sortOrder: index + 1, contextKey: null,
        modifierGroup: { id: `flavour-${index}`, name: `Flavour ${index + 1}`, displayLabel: 'Flavour', locationId: 'store', archivedAt: null, selectionMode: 'SINGLE',
          isRequired: true, minSelect: 1, maxSelect: 1, options: [{ id: `plain-${index}`, modifierGroupId: `flavour-${index}`, name: 'Plain', isActive: true, priceDeltaCents: 0, linkedFlavourId: 'plain' }] } }))];
    Object.assign(party, { modifierGroups: groups });
    const settings = { taxRateBps: 1300, taxDeliveryFee: false, taxTip: false, discountsReduceTaxableBase: options.taxDiscount !== false,
      defaultPrepTimeMinutes: 15, freeDeliveryThresholdCents: options.standardFreeThreshold ?? null, minimumDeliverySubtotalCents: 0,
      prepaymentThresholdNoShows: 3, allowedPostalCodes: [] };
    const promo = { id: 'promo', code: 'SAVE', name: 'Save', discountType: type, discountValue: type === 'FIXED_AMOUNT' ? 5000 : 10,
      minSubtotalCents: options.minimum ?? 0, maxDiscountCents: null, eligibleFulfillmentType: 'BOTH', usageLimitTotal: null,
      usageLimitPerCustomer: null, isOneTimePerCustomer: false, isFirstOrderOnly: false, rulePayloadJson: {}, productTargets: [], categoryTargets: [],
      bxgyRule: { qualifyingProductId: null, qualifyingCategoryId: null, rewardProductId: null, rewardCategoryId: null, requiredQty: 1, rewardQty: 1, maxUsesPerOrder: 5 } };
    const first = options.first ? [{ ...promo, code: firstOrderDealCode('store', type as never) }] : [];
    const db = {
      location: { findUnique: jest.fn().mockResolvedValue({ id: 'store', isActive: true, timezoneName: 'America/Toronto', settings }) },
      locationSettings: { findUnique: jest.fn().mockResolvedValue(settings) }, locationHours: { findMany: jest.fn().mockResolvedValue([]) },
      menuItem: { findMany: jest.fn().mockResolvedValue([party, burger]) }, menuCategory: { findMany: jest.fn().mockResolvedValue([category, party.category]) },
      menuItemModifierGroup: { findMany: jest.fn().mockResolvedValue(groups) }, menuItemSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      removableIngredient: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue(groups.flatMap<Record<string, unknown>>(group => group.modifierGroup.options)) },
      modifierGroup: { findMany: jest.fn().mockResolvedValue(groups.map(group => group.modifierGroup)) },
      wingFlavour: { findMany: jest.fn().mockResolvedValue([{ id: 'plain', name: 'Plain', isPlain: true, heatLevel: 'PLAIN', isActive: true, archivedAt: null }]) },
      promoCode: { findFirst: jest.fn().mockResolvedValue(promo), findMany: jest.fn().mockResolvedValue(first) }, promoRedemption: { count: jest.fn().mockResolvedValue(0) },
      order: { create: jest.fn().mockRejectedValue(stop), count: jest.fn().mockResolvedValue(0) },
      checkoutIdempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'customer', isActive: true, displayName: 'Fixture' }) },
      userIdentity: { findMany: jest.fn().mockResolvedValue([{ phoneE164: '+15195550123' }]) },
      customerProfile: { findUnique: jest.fn().mockResolvedValue({ totalNoShows: 0 }) }, $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation(callback => callback(db));
    const rewards = { computeEligibility: jest.fn().mockResolvedValue({ eligible: false, availableStamps: 0, poundsInCart: 0 }) };
    const promotions = new PromotionsService(db as never);
    const verifier = { verifyForDelivery: jest.fn().mockReturnValue({ delivery_fee_cents: 500 }) };
    const cart = new CartService(db as never, rewards as never, promotions, verifier as never);
    const checkout = new CheckoutService(db as never, {} as never, {} as never, rewards as never, promotions, {} as never, verifier as never);
    const payload = { builder_type: 'WINGS', weight_lb: slug === 'party-75-wings' ? 8 : 11, wing_type: 'BONE_IN', preparation: 'BREADED', saucing_method: 'ON_WINGS',
      flavour_slots: Array.from({ length: 5 }, (_, i) => ({ slot_no: i + 1, wing_flavour_id: 'plain', flavour_name: 'Plain', placement: 'ON_WINGS' })) };
    const items = [{ menu_item_id: 'party', quantity: 1, builder_payload: payload, modifier_selections: [{ modifier_option_id: 'breaded' }],
      // Extra client fields must never replace catalogue slug, name or price.
      menu_item_slug: 'veggie-burger', name: 'Burger', unit_price_cents: 1 },
      ...(options.onlyParty ? [] : [{ menu_item_id: 'burger', quantity: options.burgerQty ?? 1, modifier_selections: [], menu_item_slug: 'party-75-wings', name: 'Party', unit_price_cents: 999999 }])];
    const code = options.first ? 'MYFIRSTORDER' : 'SAVE';
    const fulfillment = options.delivery ? 'DELIVERY' : 'PICKUP';
    const address = { line1: '12 Main St', city: 'London', postal_code: 'N5Y 4J7' };
    return { db, party, burger, settings, payload,
      quote: (reward = false) => cart.computeQuote('store', fulfillment, items as never, code, 0, 0, undefined, 'customer', reward, 'token', address),
      place: (reward = false) => checkout.placeOrder({ userId: 'customer', locationId: 'store', fulfillmentType: fulfillment, promoCode: code, applyWingsReward: reward,
        idempotencyKey: 'fixture', deliveryQuoteToken: 'token', addressSnapshotJson: address,
        items: items.map(item => ({ ...item, menuItemId: item.menu_item_id, builderPayload: item.builder_payload,
          modifierSelections: item.modifier_selections.map(selection => ({ modifierOptionId: selection.modifier_option_id })) })) } as never),
    };
  }

  it.each([
    { type: 'PERCENT', discount: 150, subtotal: 10500, tax: 1346, total: 11696 },
    { type: 'FIXED_AMOUNT', discount: 1500, subtotal: 10500, tax: 1170, total: 10170 },
    { type: 'PERCENT', burgerQty: 3, discount: 450, subtotal: 13500, tax: 1697, total: 14747 },
    { type: 'BXGY', burgerQty: 2, discount: 1500, subtotal: 12000, tax: 1365, total: 11865 },
    { type: 'PERCENT', party: 'party-100-wings', discount: 150, subtotal: 13500, tax: 1736, total: 15086 },
    { type: 'PERCENT', first: true, discount: 150, subtotal: 10500, tax: 1346, total: 11696 },
    { type: 'FIXED_AMOUNT', first: true, discount: 1500, subtotal: 10500, tax: 1170, total: 10170 },
    { type: 'FREE_DELIVERY', delivery: true, discount: 0, subtotal: 10500, tax: 1365, total: 11865 },
    { type: 'FREE_DELIVERY', delivery: true, first: true, discount: 0, subtotal: 10500, tax: 1365, total: 11865 },
    { type: 'PERCENT', taxDiscount: false, discount: 150, subtotal: 10500, tax: 1365, total: 11715 },
  ])('$type first=$first delivery=$delivery discounts eligible merchandise by $discount with quote/checkout parity', async row => {
    const f = fixture(row.type, row);
    const quote = await f.quote().catch(error => { throw new Error(JSON.stringify(error.response ?? error.message)); });
    expect(quote).toMatchObject({ item_subtotal_cents: row.subtotal, promo_discount_cents: row.discount, tax_cents: row.tax, final_payable_cents: row.total });
    expect(quote.lines[0]).toMatchObject({ menu_item_id: 'party', name: f.party.name, unit_price_cents: f.party.basePriceCents });
    await expect(f.place()).rejects.toBe(stop);
    expect(f.db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ itemSubtotalCents: row.subtotal,
      orderDiscountTotalCents: row.discount, taxCents: row.tax, finalPayableCents: row.total }) }));
  });
  it.each(['PERCENT', 'FIXED_AMOUNT', 'BXGY', 'FREE_DELIVERY', 'FIRST'])('%s rejects Party-only coupons through both services without order writes', async type => {
    const f = fixture(type === 'FIRST' ? 'PERCENT' : type, { onlyParty: true, first: type === 'FIRST', delivery: type === 'FREE_DELIVERY' });
    await expect(f.quote()).rejects.toThrow('Party Specials are excluded');
    await expect(f.place()).rejects.toThrow('Party Specials are excluded');
    expect(f.db.order.create).not.toHaveBeenCalled();
  });
  it.each(['PERCENT', 'FREE_DELIVERY', 'FIRST'])('%s threshold cannot be reached through excluded Party value', async type => {
    const f = fixture(type === 'FIRST' ? 'PERCENT' : type, { minimum: 2500, first: type === 'FIRST', delivery: type === 'FREE_DELIVERY' });
    await expect(f.quote()).rejects.toThrow('Minimum order'); await expect(f.place()).rejects.toThrow('Minimum order');
    expect(f.db.order.create).not.toHaveBeenCalled();
  });
  it('mixed eligible merchandise can meet the minimum independently', async () => {
    const f = fixture('PERCENT', { minimum: 2500, burgerQty: 2 });
    expect(await f.quote()).toMatchObject({ promo_discount_cents: 300 });
    await expect(f.place()).rejects.toBe(stop);
    expect(f.db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderDiscountTotalCents: 300 }) }));
  });
  it('standard non-promotional free-delivery threshold still includes the entire merchandise amount', async () => {
    const f = fixture('PERCENT', { delivery: true, standardFreeThreshold: 10000 });
    expect(await f.quote()).toMatchObject({ delivery_fee_cents: 0, promo_discount_cents: 150 });
    await expect(f.place()).rejects.toBe(stop);
    expect(f.db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryFeeCents: 0, orderDiscountTotalCents: 150 }) }));
  });
  it('coupon and loyalty redemption stacking protection remains enforced', async () => {
    const f = fixture('PERCENT');
    await expect(f.quote(true)).rejects.toThrow('Only one deal'); await expect(f.place(true)).rejects.toThrow('Only one deal');
    expect(f.db.order.create).not.toHaveBeenCalled();
  });
});
