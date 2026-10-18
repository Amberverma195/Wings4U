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
    db.menuItem.findMany.mockImplementation(async (args: any) => args.include?.modifierGroups?.include ? [child] : [item]);
    db.$transaction.mockImplementation(callback => callback(db));
    const rewards = { computeEligibility: jest.fn().mockResolvedValue({ eligible: false, availableStamps: 0, poundsInCart: 0 }) };
    const promos = { isFirstOrderDealPublicCode: jest.fn().mockResolvedValue(false), evaluateFirstOrderDeal: jest.fn().mockResolvedValue(null) };
    const cart = new CartService(db as never, rewards as never, promos as never, {} as never);
    const checkout = new CheckoutService(db as never, {} as never, {} as never, rewards as never, promos as never, {} as never, {} as never);
    const pos = new PosService(db as never, {} as never);
    const payload: Record<string, unknown> = { builder_type: 'LUNCH_SPECIAL', child_menu_item_id: 'burger', child_addons: [{ modifier_option_id: 'cheese', price_delta_cents: -900 }] };
    const selectionIds: string[] = [];
    const request = { lineCount: 1 };
    const run = (path: string) => {
      const lines = Array.from({ length: request.lineCount }, () => ({ menuItemId: item.id, quantity: 2, builderPayload: payload,
        modifierSelections: selectionIds.map(id => ({ modifierOptionId: id })) }));
      return path === 'quote'
        ? cart.computeQuote('local', 'PICKUP', lines.map(line => ({ menu_item_id: line.menuItemId, quantity: line.quantity, builder_payload: line.builderPayload,
          modifier_selections: selectionIds.map(id => ({ modifier_option_id: id })) })))
        : path === 'checkout'
          ? checkout.placeOrder({ userId: 'customer', locationId: 'local', fulfillmentType: 'PICKUP', idempotencyKey: 'fixture', items: lines })
          : pos.createPosOrder({ locationId: 'local', fulfillmentType: 'PICKUP', orderSource: 'POS', paymentMethod: 'CASH', items: lines } as never);
    };
    return { db, child, item, payload, run, selectionIds, request, pos };
  }
  function wingFixture(combo = false) {
    const f = fixture();
    Object.assign(f.item, { id: 'wings-1.5lb', name: '1.5 Pound – 1 Flavour', slug: 'wings-1.5lb', builderType: combo ? 'WING_COMBO' : 'WINGS' });
    for (const key of Object.keys(f.payload)) delete f.payload[key];
    Object.assign(f.payload, { builder_type: combo ? 'WING_COMBO' : 'WINGS', weight_lb: 1.5, wing_type: 'BONELESS', preparation: 'BREADED', saucing_method: 'ON_SIDE',
      flavour_slots: [{ slot_no: 1, wing_flavour_id: 'hot', flavour_name: 'Untrusted client label', placement: 'ON_SIDE' }],
      extra_flavour: { wing_flavour_id: 'hot', placement: 'ON_WINGS' },
    });
    const makeGroup = (id: string, contextKey: string | null, name: string, options: any[], minSelect = 1) => ({ menuItemId: f.item.id, modifierGroupId: id, sortOrder: 1, contextKey,
      modifierGroup: { id, locationId: 'local', name, displayLabel: name, archivedAt: null, contextKey, selectionMode: 'SINGLE', minSelect, maxSelect: 1, isRequired: minSelect > 0,
        options: options.map(option => ({ modifierGroupId: id, isActive: true, priceDeltaCents: 0, linkedFlavourId: null, ...option })) } });
    const groups = [
      makeGroup('type', null, 'Wing Type', [{ id: 'boneless', name: 'Boneless' }]),
      makeGroup('flavour', null, 'Flavour 1', [{ id: 'hot-option', linkedFlavourId: 'hot' }]),
      makeGroup('addons', 'addon', 'Extras', [{ id: 'dip', name: 'Dip', priceDeltaCents: 150 }], 0),
    ];
    f.selectionIds.push('boneless', 'dip');
    if (combo) {
      groups.push(makeGroup('sides', 'side', 'Side', [{ id: 'fries', name: 'Fries', priceDeltaCents: 200 }]),
        makeGroup('drinks', 'drink', 'Drink', [{ id: 'pop', name: 'Pepsi' }]));
      f.selectionIds.push('fries', 'pop'); f.payload.side_selections = ['fries']; f.payload.drink_selections = ['pop'];
    }
    Object.assign(f.item, { modifierGroups: groups });
    f.db.menuItemModifierGroup.findMany.mockResolvedValue(groups);
    f.db.modifierOption.findMany.mockResolvedValue(groups.flatMap(group => group.modifierGroup.options.map(option => ({ ...option, modifierGroup: group.modifierGroup }))) as never);
    f.db.modifierGroup.findMany.mockResolvedValue(groups.map(group => group.modifierGroup) as never);
    f.db.wingFlavour.findMany.mockResolvedValue([{ id: 'hot', name: 'Catalogue Hot', heatLevel: 'HOT', isPlain: false, isActive: true, archivedAt: null }] as never);
    return { ...f, groups };
  }
  it.each(['quote', 'checkout', 'pos'])('%s accepts a valid fractional SKU with paid modifiers and extra flavour', async path => {
    const { run, db } = wingFixture();
    if (path === 'quote') expect(await run(path)).toMatchObject({ item_subtotal_cents: 2700, lines: [{ unit_price_cents: 1350 }] });
    else {
      await expect(run(path)).rejects.toBe(stop);
      expect(db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ itemSubtotalCents: 2700 }) }));
    }
  });
  it.each(['quote', 'checkout', 'pos'])('%s accepts a valid combo with exact side/drink charges', async path => {
    const { run, db } = wingFixture(true);
    if (path === 'quote') expect(await run(path)).toMatchObject({ item_subtotal_cents: 3100 });
    else {
      await expect(run(path)).rejects.toBe(stop);
      expect(db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ itemSubtotalCents: 3100 }) }));
    }
  });
  it.each(['quote', 'checkout', 'pos'])('%s rejects a tampered SKU weight before persistence', async path => {
    const { run, db, payload } = wingFixture(); payload.weight_lb = 5;
    await expect(run(path)).rejects.toThrow('Wing weight');
    expect(db.order.create).not.toHaveBeenCalled();
  });
  it.each([
    { path: 'checkout', twoSlots: false }, { path: 'pos', twoSlots: false },
    { path: 'checkout', twoSlots: true }, { path: 'pos', twoSlots: true },
  ])('$path persists trusted weight and sauce slots (twoSlots=$twoSlots) using mocked writes', async ({ path, twoSlots }) => {
    const { run, db, groups, item, payload } = wingFixture();
    if (twoSlots) {
      Object.assign(item, { id: 'wings-3lb', slug: 'wings-3lb', name: '3 Pound – 2 Flavours' });
      for (const group of groups) group.menuItemId = item.id;
      groups.push({ ...groups[1], modifierGroupId: 'flavour-2', sortOrder: 2,
        modifierGroup: { ...groups[1].modifierGroup, id: 'flavour-2' } });
      payload.weight_lb = 3; payload.saucing_method = 'SIDE'; payload.side_flavour_slot_no = 2;
      payload.flavour_slots = [
        { slot_no: 1, wing_flavour_id: 'hot', placement: 'ON_WINGS' },
        { slot_no: 2, wing_flavour_id: 'hot', placement: 'ON_SIDE' },
      ];
    }
    // Allow only mocked writes through the wing configuration/flavour serialization,
    // then stop before payment or transaction completion.
    const writes = { orderItemWingConfig: { create: jest.fn().mockResolvedValue({}) }, orderItemFlavour: { create: jest.fn().mockResolvedValue({}) },
      orderItem: { create: jest.fn().mockResolvedValue({ id: 'line' }) }, orderItemModifier: { create: jest.fn().mockResolvedValue({}) },
      orderStatusEvent: { create: jest.fn().mockResolvedValue({}) }, orderPayment: { create: jest.fn().mockRejectedValue(stop) } };
    Object.assign(db, writes);
    db.order.create.mockResolvedValue({ id: 'order', orderItems: [{ id: 'line' }] } as never);
    db.checkoutIdempotencyKey.create.mockResolvedValue({});
    const update = jest.fn().mockRejectedValue(stop); Object.assign(db.checkoutIdempotencyKey, { update });
    await expect(run(path)).rejects.toBe(stop);
    expect(writes.orderItemWingConfig.create).toHaveBeenCalledWith({ data: expect.objectContaining({ weightLb: twoSlots ? 3 : 1.5, wingType: 'BONELESS', preparation: 'BREADED', requiredFlavourCount: twoSlots ? 2 : 1,
      saucingMethod: twoSlots ? 'SIDE' : 'ON_SIDE', sideFlavourSlot: twoSlots ? 2 : null }) });
    expect(writes.orderItemFlavour.create.mock.calls.map(call => call[0].data)).toEqual([
      expect.objectContaining({ slotNo: 1, flavourRole: 'STANDARD', flavourNameSnapshot: 'Catalogue Hot', placement: twoSlots ? 'ON_WINGS' : 'ON_SIDE' }),
      ...(twoSlots ? [expect.objectContaining({ slotNo: 2, flavourRole: 'STANDARD', flavourNameSnapshot: 'Catalogue Hot', placement: 'ON_SIDE' })] : []),
      expect.objectContaining({ slotNo: 99, flavourRole: 'EXTRA', flavourNameSnapshot: 'Catalogue Hot', placement: 'ON_WINGS' }),
    ]);
  });
  it.each(['quote', 'checkout', 'pos'])('%s prices paid lunch add-ons from the catalogue', async path => {
    const { db, run } = fixture();
    if (path === 'quote') expect(await run(path)).toMatchObject({ item_subtotal_cents: 2300, lines: [{ unit_price_cents: 1150 }] });
    else {
      await expect(run(path)).rejects.toBe(stop);
      expect(db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ itemSubtotalCents: 2300 }) }));
    }
  });
  it.each(['quote', 'checkout', 'pos'])('%s batches 25 duplicate lunch configurations into two validator reads', async path => {
    const { db, run, request } = fixture(); request.lineCount = 25;
    if (path === 'quote') expect(await run(path)).toMatchObject({ item_subtotal_cents: 57500 });
    else await expect(run(path)).rejects.toBe(stop);
    const validationReads = db.menuItemModifierGroup.findMany.mock.calls.filter((call: any[]) => call[0].include);
    expect(validationReads).toHaveLength(1);
    expect(db.menuItem.findMany.mock.calls.filter((call: any[]) => call[0].include?.modifierGroups?.include)).toHaveLength(1);
    expect(db.menuItem.findFirst).not.toHaveBeenCalled();
  });
  it('never reuses availability between independent quote requests', async () => {
    const { run, child, db } = fixture();
    await run('quote'); child.isAvailable = false;
    await expect(run('quote')).rejects.toThrow('unavailable');
    expect(db.menuItemModifierGroup.findMany).toHaveBeenCalledTimes(2);
  });
  it('preserves POS open-food pricing without builder catalogue reads', async () => {
    const { pos, db } = fixture(); db.menuItem.findMany.mockResolvedValue([]);
    await expect(pos.createPosOrder({ locationId: 'local', fulfillmentType: 'PICKUP', orderSource: 'POS', paymentMethod: 'CASH',
      items: [{ name: 'Open Food', unitPriceCents: 550, quantity: 2 }] } as never)).rejects.toBe(stop);
    expect(db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ itemSubtotalCents: 1100 }) }));
    expect(db.menuItemModifierGroup.findMany).not.toHaveBeenCalled();
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
