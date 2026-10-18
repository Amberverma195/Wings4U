jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
import { CartService } from '../cart/cart.service';
import { previewReorder } from './reorder-preview';
import { rebuildReorderBuilder } from './reorder-builder';

const clock = (time: string) => new Date(`1970-01-01T${time}:00Z`);
const category = { id: 'food', name: 'Food', slug: 'burgers', availableFromMinutes: null, availableUntilMinutes: null };
function product(id = 'burger'): any {
  return { id, slug: id, name: id, locationId: 'store', basePriceCents: 1500, imageUrl: 'current-image', builderType: null,
    isActive: true, isAvailable: true, isHidden: false, stockStatus: 'NORMAL', archivedAt: null, allowedFulfillmentType: 'BOTH',
    requiresSpecialInstructions: false, categoryId: 'food', category: { ...category }, schedules: [], modifierGroups: [], removableIngredients: [] };
}
function group(item: any, id: string, context: string | null, opts: any[], min = 1, max = 1): any {
  const value = { menuItemId: item.id, modifierGroupId: id, contextKey: context, sortOrder: item.modifierGroups.length,
    modifierGroup: { id, locationId: 'store', name: context === 'addon' ? `${id} Extras` : id, menuItems: [{ menuItemId: item.id }], sortOrder: 0, displayLabel: id, contextKey: context, archivedAt: null,
      isRequired: min > 0, minSelect: min, maxSelect: max, selectionMode: max === 1 ? 'SINGLE' : 'MULTI',
      options: opts.map(opt => ({ modifierGroupId: id, name: opt.id, addonMatchNormalized: context === 'addon' ? '__always__' : null, linkedFlavourId: null, isActive: true, priceDeltaCents: 0, ...opt })) } };
  item.modifierGroups.push(value); return value;
}
function fixture() {
  const current = product(), catalog = [current];
  const source: any = { menuItemId: current.id, productNameSnapshot: 'Historical Burger', unitPriceCents: 1000, quantity: 2,
    modifiers: [], flavours: [], specialInstructions: 'Cut in half', builderPayloadJson: null };
  const order: any = { id: 'past', customerUserId: 'owner', locationId: 'store', status: 'DELIVERED', fulfillmentType: 'PICKUP', orderItems: [source] };
  const settings = { defaultPrepTimeMinutes: 15, busyModeEnabled: false, busyModePrepTimeMinutes: null, deliveryDisabled: false,
    taxRateBps: 1300, taxDeliveryFee: false, taxTip: false, discountsReduceTaxableBase: true, minimumDeliverySubtotalCents: 0, freeDeliveryThresholdCents: null };
  const location = { id: 'store', timezoneName: 'America/Toronto', isActive: true };
  const options = () => catalog.flatMap(item => item.modifierGroups.flatMap((row: any) => row.modifierGroup.options.map((option: any) => ({ ...option, modifierGroup: row.modifierGroup }))));
  const db = {
    order: { findUnique: jest.fn().mockResolvedValue(order), create: jest.fn() },
    menuItem: { findMany: jest.fn(async (args: any) => catalog.filter(item => args.where.id.in.includes(item.id) && item.locationId === 'store')) },
    modifierOption: { findMany: jest.fn(async (args: any) => options().filter(option => args.where.id.in.includes(option.id) && (!args.where.isActive || option.isActive))) },
    menuItemModifierGroup: { findMany: jest.fn(async (args: any) => catalog.flatMap(item => item.modifierGroups).filter(row => args.where.menuItemId.in.includes(row.menuItemId))) },
    wingFlavour: { findMany: jest.fn().mockResolvedValue([{ id: 'hot', name: 'Hot', isActive: true, archivedAt: null, isPlain: false, heatLevel: 'HOT' }]) },
    location: { findUnique: jest.fn().mockResolvedValue(location) }, locationSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
    locationHours: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const cart = new CartService(db as never, {} as never, {} as never, {} as never);
  const run = (context = {}) => previewReorder(db as never, cart, 'past', 'owner', context, 'store');
  const select = (id: string, name = id) => source.modifiers.push({ modifierOptionId: id, modifierNameSnapshot: name, modifierKind: 'ADD' });
  const wing = (slug: string, weight: number, combo = false, slots = 1) => {
    Object.assign(current, { id: slug, slug, builderType: combo ? 'WING_COMBO' : 'WINGS' }); source.menuItemId = slug;
    group(current, 'Wing Type', null, [{ id: 'type', name: 'House Breaded Bone-In' }]); select('type', 'House Breaded Bone-In');
    for (let n = 1; n <= slots; n++) group(current, 'flavour' + n, null, [{ id: 'hot-option' + n, linkedFlavourId: 'hot' }]);
    source.builderPayloadJson = { builder_type: current.builderType, wing_type: 'BONE_IN', preparation: 'BREADED', weight_lb: weight,
      flavour_slots: Array.from({ length: slots }, (_, index) => ({ slot_no: index + 1, wing_flavour_id: 'hot', flavour_name: 'Old Hot', placement: 'ON_WINGS' })),
      saucing_method: slots === 1 ? 'ON_WINGS' : 'SPLIT_EVENLY' };
    if (combo) {
      group(current, 'sides', 'side', [{ id: 'fries', priceDeltaCents: 150 }]); group(current, 'drinks', 'drink', [{ id: 'pepsi' }]);
      select('fries'); select('pepsi'); source.builderPayloadJson.side_selections = ['fries']; source.builderPayloadJson.drink_selections = ['pepsi'];
    }
  };
  return { db, cart, current, source, order, catalog, settings, location, run, select, wing };
}
describe('read-only reorder using authoritative Cart Quote validation', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-19T16:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  it('preserves the web contract and server prices without writing an order', async () => {
    const f = fixture(); const result = await f.run();
    expect(result).toMatchObject({ order_id: 'past', location_id: 'store', fulfillment_type_hint: 'PICKUP', all_unavailable: false,
      items: [{ menu_item_id: 'burger', base_price_cents: 1500, quantity: 2, image_url: 'current-image', special_instructions: 'Cut in half' }],
      diff: { skipped: [], modifier_changes: [], price_changes: [{ old_cents: 1000, new_cents: 1500 }] } });
    expect(f.db.order.create).not.toHaveBeenCalled();
    expect(await previewReorder(f.db as never, f.cart, 'past', 'owner')).toMatchObject({ items: result.items }); // existing web has no context body
  });
  it.each(['owner', 'scope', 'active', 'missing'])('rejects %s failures before catalogue reads', async issue => {
    const f = fixture();
    if (issue === 'owner') f.order.customerUserId = 'another';
    if (issue === 'active') f.order.status = 'PREPARING';
    if (issue === 'missing') f.db.order.findUnique.mockResolvedValue(null);
    await expect(previewReorder(f.db as never, f.cart, 'past', 'owner', {}, issue === 'scope' ? 'other-store' : 'store')).rejects.toThrow();
    expect(f.db.menuItem.findMany).not.toHaveBeenCalled(); expect(f.db.order.create).not.toHaveBeenCalled();
  });
  it.each(['PICKED_UP', 'DELIVERED', 'NO_SHOW_PICKUP', 'NO_SHOW_DELIVERY', 'NO_PIN_DELIVERY', 'CANCELLED'])('allows website terminal status %s', async status => {
    const f = fixture(); f.order.status = status; expect((await f.run()).items).toHaveLength(1);
  });
  it.each(['stock', 'disabled', 'archived', 'location', 'deleted'])('skips %s and preserves other valid lines', async issue => {
    const f = fixture(), valid = product('drink'); f.catalog.push(valid); f.order.orderItems.push({ ...f.source, menuItemId: 'drink', modifiers: [] });
    if (issue === 'stock') f.current.stockStatus = 'UNAVAILABLE';
    if (issue === 'disabled') f.current.isAvailable = false;
    if (issue === 'archived') f.current.archivedAt = new Date();
    if (issue === 'location') f.current.locationId = 'other';
    if (issue === 'deleted') f.source.menuItemId = null;
    const result = await f.run(); expect(result.items.map(item => item.menu_item_id)).toEqual(['drink']); expect(result.diff.skipped).toHaveLength(1);
  });
  it('all unavailable never returns an addable item', async () => {
    const f = fixture(); f.current.stockStatus = 'UNAVAILABLE'; expect(await f.run()).toMatchObject({ items: [], all_unavailable: true });
  });
  it('drops unavailable optional modifiers and obsolete removals; discloses renamed choices and actual pricing', async () => {
    const f = fixture(); group(f.current, 'Extras', 'addon', [{ id: 'cheese', name: 'New Cheese', priceDeltaCents: 200 }, { id: 'sauce', isActive: false }], 0, 2);
    f.select('cheese', 'Old Cheese'); f.select('sauce');
    f.source.modifiers.push({ modifierKind: 'REMOVE_INGREDIENT', modifierNameSnapshot: 'Onion' });
    f.source.builderPayloadJson = { builder_type: 'ITEM_CUSTOMIZATION', removed_ingredients: [{ id: 'old', name: 'Onion' }], price_cents: -999 };
    const result = await f.run(); expect(result.items[0].modifier_selections).toEqual([expect.objectContaining({ option_name: 'New Cheese', price_delta_cents: 200 })]);
    expect(result.items[0].removed_ingredients).toEqual([]); expect(result.items[0].builder_payload).not.toHaveProperty('price_cents');
    expect(result.diff.modifier_changes[0].dropped).toEqual(expect.arrayContaining(['sauce', 'No Onion (removal no longer offered)']));
    expect(result.diff.configuration_changes![0].changes).toContain('Old Cheese → New Cheese'); expect(result.diff.price_changes[0].new_cents).toBe(1700);
  });
  it.each(['minimum', 'maximum', 'archived-group', 'foreign-group'])('ordinary products enforce modifier group %s', async issue => {
    const f = fixture(); const mapping = group(f.current, 'Extras', 'addon', [{ id: 'one' }, { id: 'two' }], 1, 1);
    if (issue !== 'minimum') f.select('one'); if (issue === 'maximum') f.select('two');
    if (issue === 'archived-group') mapping.modifierGroup.archivedAt = new Date();
    if (issue === 'foreign-group') mapping.modifierGroup.locationId = 'other';
    expect(await f.run()).toMatchObject({ all_unavailable: true, diff: { skipped: [{ reason: 'required_group_missing' }] } });
  });
  it('reconciles legacy payload-only ingredient removals against current IDs without losing the choice', async () => {
    const f = fixture(); f.current.removableIngredients = [{ id: 'current-onion', name: 'Onion' }];
    f.source.builderPayloadJson = { builder_type: 'ITEM_CUSTOMIZATION', removed_ingredients: [{ id: 'old-onion', name: 'Onion' }] };
    const result = await f.run();
    expect(result.items[0].removed_ingredients).toEqual([{ id: 'current-onion', name: 'Onion' }]);
    expect(result.items[0].builder_payload).toMatchObject({ removed_ingredients: [{ id: 'current-onion', name: 'Onion' }] });
  });
  it.each([-1, 0, 1.5, NaN, Infinity])('rejects invalid historical quantity %s', async quantity => {
    const f = fixture(); f.source.quantity = quantity; expect((await f.run()).all_unavailable).toBe(true);
  });
  it.each([
    ['wings-1lb', 1, false, 1], ['wings-1.5lb', 1.5, false, 1], ['wings-2.5lb', 2.5, false, 1],
    ['combo-1.5lb', 1.5, true, 1], ['party-75-wings', 8, false, 5], ['party-100-wings', 11, false, 5], ['wings-4u-special', 2, false, 1],
  ])('restores %s from validated SKU and ordered flavour slots', async (slug, weight, combo, slots) => {
    const f = fixture(); f.wing(slug as string, weight as number, combo as boolean, slots as number);
    f.source.builderPayloadJson.extra_flavour = { wing_flavour_id: 'hot', flavour_name: 'Hot', placement: 'ON_SIDE' };
    const result = await f.run(); expect(result.all_unavailable).toBe(false);
    expect(result.items[0].builder_payload).toMatchObject({ weight_lb: weight, flavour_slots: Array.from({ length: slots as number }, (_, n) => ({ slot_no: n + 1, flavour_name: 'Hot' })), extra_flavour: { placement: 'ON_SIDE' } });
    expect(result.diff.price_changes[0].new_cents).toBe(combo ? 1750 : 1600);
  });
  it.each(['weight', 'flavour', 'slot', 'prep', 'sauce', 'option', 'missing', 'unknown', 'unknown-paid-option'])('skips unsafe historical builder %s rather than changing the configuration', async issue => {
    const f = fixture(); f.wing('party-75-wings', 8, false, 5); const payload = f.source.builderPayloadJson;
    if (issue === 'weight') payload.weight_lb = 5;
    if (issue === 'flavour') payload.flavour_slots[0].wing_flavour_id = 'missing';
    if (issue === 'slot') payload.flavour_slots[0].slot_no = 99;
    if (issue === 'prep') payload.preparation = 'RAW';
    if (issue === 'sauce') payload.saucing_method = 'UNKNOWN';
    if (issue === 'option') f.source.modifiers[0].modifierOptionId = 'gone';
    if (issue === 'missing') f.source.builderPayloadJson = null;
    if (issue === 'unknown') payload.builder_type = 'UNKNOWN';
    if (issue === 'unknown-paid-option') payload.old_paid_sauce = 'not-supported';
    const result = await f.run(); expect(result.all_unavailable).toBe(true); expect(result.diff.skipped[0].detail).toBeTruthy();
  });
  it('preserves side sauce slot selection without reordering flavours', async () => {
    const f = fixture(); f.wing('wings-2lb', 2, false, 2);
    Object.assign(f.source.builderPayloadJson, { saucing_method: 'SIDE', side_flavour_slot_no: 2 });
    f.source.builderPayloadJson.flavour_slots[1].placement = 'ON_SIDE';
    expect((await f.run()).items[0].builder_payload).toMatchObject({ side_flavour_slot_no: 2, flavour_slots: [{ slot_no: 1, placement: 'ON_WINGS' }, { slot_no: 2, placement: 'ON_SIDE' }] });
  });
  it.each(['lunch-burger', 'lunch-wrap'])('restores %s using current child/add-on prices', async slug => {
    const f = fixture(); Object.assign(f.current, { slug, category: { ...category, slug: 'lunch-specials' } });
    const child = product('child'); child.category.slug = slug === 'lunch-burger' ? 'burgers' : 'wraps'; f.catalog.push(child);
    group(child, 'child-extras', 'addon', [{ id: 'cheese', priceDeltaCents: 250 }], 0, 2);
    f.source.builderPayloadJson = { builder_type: 'LUNCH_SPECIAL', child_menu_item_id: child.id, child_name: 'Old', child_slug: 'old',
      child_addons: [{ modifier_option_id: 'cheese', name: 'Old Cheese', price_delta_cents: -9999 }], removed_ingredients: [] };
    const result = await f.run(); expect(result.items[0].builder_payload).toMatchObject({ child_name: 'child', child_slug: 'child', child_addons: [{ modifier_option_id: 'cheese', price_delta_cents: 250 }] });
    expect(result.diff.price_changes[0].new_cents).toBe(1750);
    child.stockStatus = 'UNAVAILABLE'; expect((await f.run()).all_unavailable).toBe(true);
  });
  it.each(['salad', 'wings-special'])('revalidates %s selections, removals and child availability', async family => {
    const f = fixture(), salad = family === 'salad' ? f.current : product('salad');
    salad.removableIngredients = [{ id: 'onion', name: 'Onion' }];
    group(salad, 'salad-size', 'size', [{ id: 'large', priceDeltaCents: 300 }]);
    if (family === 'wings-special') {
      f.catalog.push(salad); f.wing('wings-4u-special', 2); f.source.builderPayloadJson.salad_customization = {
        salad_menu_item_id: 'salad', salad_name: 'Old Salad', salad_slug: 'old', removed_ingredients: [{ id: 'onion', name: 'Onion' }],
        modifier_selections: [{ modifier_option_id: 'large', name: 'Large', price_delta_cents: -1000 }],
      };
    }
    f.select('large'); f.source.modifiers.push({ modifierKind: 'REMOVE_INGREDIENT', modifierNameSnapshot: 'Onion' });
    const result = await f.run(); expect(result.all_unavailable).toBe(false); expect(result.diff.price_changes[0].new_cents).toBe(1800);
    salad.isAvailable = false; expect((await f.run()).all_unavailable).toBe(true);
  });
  it('a newly required child option prevents restoring an incomplete lunch configuration', async () => {
    const f = fixture(); f.current.slug = 'lunch-burger';
    const child = product('child'); f.catalog.push(child);
    group(child, 'required-size', 'size', [{ id: 'size' }]);
    f.source.builderPayloadJson = { builder_type: 'LUNCH_SPECIAL', child_menu_item_id: child.id, child_name: 'child', child_slug: 'child', child_addons: [], removed_ingredients: [] };
    expect((await f.run()).all_unavailable).toBe(true);
  });
  it.each(['veggie-burger', 'chicken-caesar-wrap'])('reprices %s side/pop bundle without trusting old price', async slug => {
    const f = fixture(); f.current.slug = slug;
    f.source.builderPayloadJson = { builder_type: 'ITEM_CUSTOMIZATION', removed_ingredients: [], side_pop_bundle: { price_cents: -999, side_label: 'Fries', pop_label: 'Pepsi' } };
    const result = await f.run(); expect(result.items[0].builder_payload).toMatchObject({ side_pop_bundle: { price_cents: 499 } }); expect(result.diff.price_changes[0].new_cents).toBe(1999);
  });
  it.each(['tenders', 'poutine', 'sides', 'drinks'])('restores fixed-price %s without transferring historical financial data', async slug => {
    const f = fixture(); f.current.slug = slug; f.order.promoCode = 'EXPIRED'; f.order.driverTipCents = 999;
    const result = await f.run(); expect(result.items[0]).not.toHaveProperty('promo_code'); expect(result.items[0]).not.toHaveProperty('driver_tip_cents');
  });
  it.each(['category', 'item', 'hours', 'service', 'delivery-disabled', 'past', 'lead', 'inactive-location', 'timezone', 'invalid-timezone'])('enforces %s availability in the actual ordering context', async issue => {
    const f = fixture(); let context: { fulfillment_type?: 'PICKUP' | 'DELIVERY'; scheduled_for?: string } = {};
    if (issue === 'category') Object.assign(f.current.category, { availableFromMinutes: 13 * 60, availableUntilMinutes: 15 * 60 });
    if (issue === 'item') f.current.schedules = [{ dayOfWeek: 2, timeFrom: clock('11:00'), timeTo: clock('15:00') }];
    if (issue === 'hours') f.db.locationHours.findMany.mockResolvedValue([{ serviceType: 'PICKUP', dayOfWeek: 1, timeFrom: clock('11:00'), timeTo: clock('13:00'), isClosed: true }] as never);
    if (issue === 'service') { f.current.allowedFulfillmentType = 'PICKUP'; context.fulfillment_type = 'DELIVERY'; }
    if (issue === 'delivery-disabled') { f.settings.deliveryDisabled = true; context.fulfillment_type = 'DELIVERY'; }
    if (issue === 'past') context.scheduled_for = '2026-10-18T16:00:00Z';
    if (issue === 'lead') context.scheduled_for = '2026-10-19T16:01:00Z';
    if (issue === 'inactive-location') f.location.isActive = false;
    if (issue === 'timezone') f.location.timezoneName = 'America/Vancouver'; // 09:00 there, before default opening.
    if (issue === 'invalid-timezone') f.location.timezoneName = 'Invalid/Zone';
    const result = await f.run(context); expect(result.all_unavailable).toBe(true); expect(result.diff.skipped[0].detail).toBeTruthy();
  });
  it('uses selected future local time and revalidates later stock in fresh quotation', async () => {
    const f = fixture(); Object.assign(f.current.category, { availableFromMinutes: 13 * 60, availableUntilMinutes: 15 * 60 });
    expect((await f.run()).all_unavailable).toBe(true);
    const result = await f.run({ scheduled_for: '2026-10-19T18:00:00Z' }); expect(result.items).toHaveLength(1);
    f.current.stockStatus = 'UNAVAILABLE';
    await expect(f.cart.computeQuote('store', 'PICKUP', result.items.map(item => ({ ...item, builder_payload: item.builder_payload ?? undefined })), undefined, 0, 0, '2026-10-19T18:00:00Z')).rejects.toThrow();
  });
  it('rejects unsupported raw payloads instead of treating them as empty customization', () => {
    expect(() => rebuildReorderBuilder({ builder_type: 'unknown', price: 1 }, [])).toThrow();
    expect(() => rebuildReorderBuilder([], [])).toThrow();
  });
});
