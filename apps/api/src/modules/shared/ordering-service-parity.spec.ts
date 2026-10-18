// Never import the environment-loading PrismaService in this isolated suite.
jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../database/order-number', () => ({ allocateNextOrderNumber: jest.fn().mockResolvedValue(1) }));
import { CartService } from '../cart/cart.service';
import { CheckoutService } from '../checkout/checkout.service';
import { PosService } from '../pos/pos.service';

describe('quote / checkout / POS ordering integrity parity', () => {
  const stop = new Error('STOP_BEFORE_PERSISTENCE');
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-19T16:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  function fixture() {
    const settings = { taxRateBps: 1300, taxDeliveryFee: false, taxTip: false, discountsReduceTaxableBase: true, defaultPrepTimeMinutes: 15 };
    const category = { id: 'category', slug: 'lunch-specials', name: 'Lunch', availableFromMinutes: 660, availableUntilMinutes: 900 };
    const item = { id: 'lunch', locationId: 'local', name: 'Lunch Burger', slug: 'lunch-burger', categoryId: category.id,
      basePriceCents: 1000, isAvailable: true, archivedAt: null, builderType: null, allowedFulfillmentType: 'BOTH', requiresSpecialInstructions: false,
      category, schedules: [], modifierGroups: [], removableIngredients: [] };
    const option = { id: 'cheese', modifierGroupId: 'extras', isActive: true, priceDeltaCents: 150, name: 'Cheese', modifierGroup: { name: 'Extras' } };
    const child = { ...item, id: 'burger', slug: 'veggie-burger', stockStatus: 'NORMAL', isHidden: false, category: { ...category, slug: 'burgers' },
      modifierGroups: [{ contextKey: 'addon', modifierGroup: { id: 'extras', name: 'Extras', displayLabel: 'Extras', contextKey: 'addon', locationId: 'local',
        archivedAt: null, minSelect: 0, maxSelect: 2, isRequired: false, selectionMode: 'MULTI', options: [option] } }] };
    const db = {
      location: { findUnique: jest.fn().mockResolvedValue({ id: 'local', isActive: true, timezoneName: 'America/Toronto', settings }) },
      locationSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
      locationHours: { findMany: jest.fn().mockResolvedValue([]) },
      menuItem: { findMany: jest.fn().mockResolvedValue([item]), findFirst: jest.fn().mockResolvedValue(child) },
      menuCategory: { findMany: jest.fn().mockResolvedValue([category]) },
      menuItemModifierGroup: { findMany: jest.fn().mockResolvedValue([]) },
      menuItemSchedule: { findMany: jest.fn().mockResolvedValue([]) }, removableIngredient: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([option]) }, wingFlavour: { findMany: jest.fn().mockResolvedValue([]) },
      modifierGroup: { findMany: jest.fn().mockResolvedValue([{ id: 'extras', name: 'Extras' }]) },
      checkoutIdempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'customer', isActive: true, displayName: 'Fixture' }) },
      userIdentity: { findMany: jest.fn().mockResolvedValue([]) },
      order: { create: jest.fn().mockRejectedValue(stop) },
      $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation(callback => callback(db));
    const rewards = { computeEligibility: jest.fn().mockResolvedValue({ eligible: false, availableStamps: 0, poundsInCart: 0 }) };
    const promos = { isFirstOrderDealPublicCode: jest.fn().mockResolvedValue(false), evaluateFirstOrderDeal: jest.fn().mockResolvedValue(null) };
    const cart = new CartService(db as never, rewards as never, promos as never, {} as never);
    const checkout = new CheckoutService(db as never, {} as never, {} as never, rewards as never, promos as never, {} as never, {} as never);
    const pos = new PosService(db as never, {} as never);
    const payload: Record<string, unknown> = { builder_type: 'LUNCH_SPECIAL', child_menu_item_id: 'burger', child_addons: [{ modifier_option_id: 'cheese', price_delta_cents: -900 }] };
    const run = (path: string) => path === 'quote'
      ? cart.computeQuote('local', 'PICKUP', [{ menu_item_id: item.id, quantity: 2, builder_payload: payload }])
      : path === 'checkout'
        ? checkout.placeOrder({ userId: 'customer', locationId: 'local', fulfillmentType: 'PICKUP', idempotencyKey: 'fixture', items: [{ menuItemId: item.id, quantity: 2, builderPayload: payload }] })
        : pos.createPosOrder({ locationId: 'local', fulfillmentType: 'PICKUP', orderSource: 'POS', paymentMethod: 'CASH', items: [{ menuItemId: item.id, quantity: 2, builderPayload: payload }] } as never);
    return { db, child, item, payload, run };
  }
  it.each(['quote', 'checkout', 'pos'])('%s prices paid lunch add-ons from the catalogue', async path => {
    const { db, run } = fixture();
    if (path === 'quote') expect(await run(path)).toMatchObject({ item_subtotal_cents: 2300, lines: [{ unit_price_cents: 1150 }] });
    else {
      await expect(run(path)).rejects.toBe(stop);
      expect(db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ itemSubtotalCents: 2300 }) }));
    }
  });
  it.each(['quote', 'checkout', 'pos'])('%s rejects a foreign child before persistence', async path => {
    const { run, child, db } = fixture(); child.category.slug = 'salads';
    await expect(run(path)).rejects.toThrow('Invalid lunch child');
    expect(db.order.create).not.toHaveBeenCalled();
  });
  it.each(['quote', 'checkout', 'pos'])('%s rejects malformed add-ons before persistence', async path => {
    const { run, payload, db } = fixture(); payload.child_addons = [{}];
    await expect(run(path)).rejects.toThrow('modifier_option_id');
    expect(db.order.create).not.toHaveBeenCalled();
  });
  it.each(['quote', 'checkout', 'pos'])('%s requires the wing builder for a concrete wing SKU', async path => {
    const { run, item, payload, db } = fixture(); item.builderType = 'WINGS' as never;
    delete payload.builder_type;
    await expect(run(path)).rejects.toThrow('Required builder');
    expect(db.order.create).not.toHaveBeenCalled();
  });
  it.each(['quote', 'checkout', 'pos'])('%s rejects unsupported bundle contents', async path => {
    const { run, item, payload, db } = fixture(); item.slug = 'veggie-burger';
    Object.assign(payload, { builder_type: 'ITEM_CUSTOMIZATION', side_pop_bundle: { side_label: 'Lobster', pop_label: 'Pepsi' } });
    await expect(run(path)).rejects.toThrow('Unsupported side');
    expect(db.order.create).not.toHaveBeenCalled();
  });
  it.each(['quote', 'checkout', 'pos'])('%s prices a valid bundle at 499 cents', async path => {
    const { run, item, payload, db } = fixture(); item.slug = 'veggie-burger';
    Object.assign(payload, { builder_type: 'ITEM_CUSTOMIZATION', side_pop_bundle: { side_label: 'Wedges', pop_label: 'Coke Zero', price_cents: 0 } });
    if (path === 'quote') expect(await run(path)).toMatchObject({ item_subtotal_cents: 2998 });
    else {
      await expect(run(path)).rejects.toBe(stop);
      expect(db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ itemSubtotalCents: 2998 }) }));
    }
  });
});
