import { assertBuilderPayloadValid, ValidationMenuItem } from './order-validation';
import { getBuilderPriceDelta, getLunchAddonOptionIds } from './pricing';
import { assertBuilderCatalogValid, loadBuilderCatalogContext } from './builder-catalog-validation';
import type { Prisma, WingFlavour } from '@prisma/client';

const item: ValidationMenuItem = {
  id: 'wings', name: '1 Pound ? 1 Flavour', slug: 'wings-1lb', builderType: 'WINGS',
  isAvailable: true, stockStatus: 'NORMAL', archivedAt: null, allowedFulfillmentType: 'BOTH',
  requiresSpecialInstructions: false, schedules: [], modifierGroups: [],
};

describe('ordering integrity reproductions', () => {
  it('requires a wings builder', () => {
    expect(() => assertBuilderPayloadValid({ menuItem: item })).toThrow();
  });
  it('rejects malformed lunch add-ons during ID extraction', () => {
    expect(() => getLunchAddonOptionIds({ builder_type: 'LUNCH_SPECIAL', child_addons: [{}] })).toThrow();
  });
  it('fails closed without authoritative add-on pricing', () => {
    expect(() => getBuilderPriceDelta({ builder_type: 'LUNCH_SPECIAL', child_addons: [
      { modifier_option_id: 'unknown', price_delta_cents: 1 },
    ] })).toThrow();
  });
  it('rejects arbitrary bundle contents', () => {
    expect(() => assertBuilderPayloadValid({ menuItem: { ...item, builderType: null, slug: 'veggie-burger' },
      builderPayload: { builder_type: 'ITEM_CUSTOMIZATION', side_pop_bundle: { side_label: 'Lobster', pop_label: 'Coke' } },
    })).toThrow();
  });
});

describe('catalogue-backed builder validation', () => {
  function group(id: string, contextKey: string | null, options: Record<string, unknown>[], required = true) {
    return { modifierGroupId: id, contextKey, sortOrder: 1, modifierGroup: {
      id, locationId: 'local', name: id, displayLabel: id, contextKey,
      minSelect: required ? 1 : 0, maxSelect: 1, selectionMode: 'SINGLE', isRequired: required, archivedAt: null,
      options: options.map(option => ({ isActive: true, priceDeltaCents: 0, linkedFlavourId: null, ...option })),
    } };
  }
  const flavour = { id: 'hot', name: 'Hot', isActive: true, archivedAt: null, isPlain: false, heatLevel: 'HOT' } as WingFlavour;
  const flavourMap = new Map([['hot', flavour], ['plain', { ...flavour, id: 'plain', isPlain: true, heatLevel: 'PLAIN' }]]);
  function fixture() {
    const flavourGroup = group('flavour', null, [{ id: 'flavour-option', linkedFlavourId: 'hot' }, { id: 'plain-option', linkedFlavourId: 'plain' }]);
    const mappings = [group('Wing Type', null, [{ id: 'type', name: 'House Breaded Bone-In' }, { id: 'boneless', name: 'Boneless' }]), flavourGroup];
    const db = { menuItemModifierGroup: { findMany: jest.fn().mockResolvedValue(mappings) }, menuItem: { findFirst: jest.fn() } };
    const payload: Record<string, unknown> = { builder_type: 'WINGS', weight_lb: 1, wing_type: 'BONE_IN', preparation: 'BREADED', saucing_method: 'ON_WINGS',
      flavour_slots: [{ slot_no: 1, wing_flavour_id: 'hot', placement: 'ON_WINGS' }] };
    const params = { db: db as unknown as Prisma.TransactionClient, locationId: 'local', menuItem: item, builderPayload: payload,
      modifierOptionIds: ['type'] as string[], fulfillmentType: 'PICKUP' as const,
      context: { timezone: 'America/Toronto', dow: 1, hhmm: 720 }, wingFlavourMap: flavourMap };
    return { db, params, payload, mappings, flavourGroup };
  }
  it('accepts valid web/mobile wings and an edited JSON round trip', async () => {
    const { params } = fixture();
    await expect(assertBuilderCatalogValid(params)).resolves.toBeUndefined();
    await expect(assertBuilderCatalogValid({ ...params, builderPayload: JSON.parse(JSON.stringify(params.builderPayload)) })).resolves.toBeUndefined();
  });
  it('rejects a client weight that does not match the purchased SKU', async () => {
    const { params, payload } = fixture();
    payload.weight_lb = 100;
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow();
  });
  it.each([undefined, null, '1', '', -1, 0, NaN, Infinity, -Infinity, {}, 1.5])('rejects invalid or mismatched weight %j', async weight => {
    const { params, payload } = fixture(); payload.weight_lb = weight;
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow('weight');
  });
  it.each([
    ['wings-1lb', '1 Pound – 1 Flavour', 1], ['wings-1.5lb', '1.5 Pound – 1 Flavour', 1.5],
    ['wings-2lb', '2 Pound – 1 Flavour', 2], ['wings-3lb', '3 Pound – 2 Flavours', 3],
    ['wings-4lb', '4 Pound – 2 Flavours', 4], ['wings-5lb', '5 Pound – 3 Flavours', 5],
    ['wings-2.5lb', '2.5 Pound – 2 Flavours', 2.5],
    ['wings-4u-special', 'Wings-4-U Special', 2], ['party-75-wings', '75 Wings — 5 Flavours', 8],
    ['party-100-wings', '100 Wings — 5 Flavours', 11], ['lunch-5-wings', '5 Wings + Fries + Pop', 0.33],
  ])('accepts catalogue weight for %s without client-derived conversion', async (slug, name, weight) => {
    const { params, payload } = fixture();
    params.menuItem = { ...item, slug: slug as string, name: name as string }; payload.weight_lb = weight;
    await expect(assertBuilderCatalogValid(params)).resolves.toBeUndefined();
  });
  it('fails closed if the catalogue weight cannot be determined', async () => {
    const { params, payload } = fixture(); params.menuItem = { ...item, slug: 'unknown-pack', name: 'Unspecified pack' }; payload.weight_lb = 1;
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow('not configured');
  });
  it('batches distinct SKUs and duplicate child IDs without sharing state across requests', async () => {
    const { db } = fixture();
    Object.assign(db.menuItem, { findMany: jest.fn().mockResolvedValue([]) });
    const params = { db: db as unknown as Prisma.TransactionClient, locationId: 'local',
      menuItems: [item, { ...item, id: 'second' }], builderPayloads: [1, 2, 3].map(() => ({ builder_type: 'LUNCH_SPECIAL', child_menu_item_id: 'burger' })) };
    await loadBuilderCatalogContext(params);
    expect(db.menuItemModifierGroup.findMany).toHaveBeenCalledTimes(1);
    expect(db.menuItemModifierGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { menuItemId: { in: ['wings', 'second'] }, menuItem: { locationId: 'local' } },
      orderBy: [{ sortOrder: 'asc' }, { modifierGroupId: 'asc' }],
    }));
    expect((db.menuItem as any).findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['burger'] }, locationId: 'local' } }));
  });
  it.each([
    { wing_type: 'ALIEN' }, { preparation: 'RAW' }, { wing_type: 'BONELESS', preparation: 'NON_BREADED' },
    { flavour_slots: [] }, { flavour_slots: [{ slot_no: 2, wing_flavour_id: 'hot', placement: 'ON_WINGS' }] },
    { flavour_slots: [{ slot_no: 1, wing_flavour_id: 'unknown', placement: 'ON_WINGS' }] },
    { flavour_slots: [{ slot_no: 1, wing_flavour_id: 'hot', placement: 'ON_SIDE' }] },
    { saucing_method: 'HACKED' }, { side_flavour_slot_no: 1 },
    { extra_flavour: {} }, { extra_flavour: { wing_flavour_id: 'plain', placement: 'ON_SIDE' } },
  ])('rejects incomplete or manipulated wing fields: %j', async fields => {
    const { params, payload } = fixture();
    await expect(assertBuilderCatalogValid({ ...params, builderPayload: { ...payload, ...fields } })).rejects.toThrow();
  });
  it('rejects inactive flavours and inactive linked options', async () => {
    const { params, mappings } = fixture();
    await expect(assertBuilderCatalogValid({ ...params, wingFlavourMap: new Map([['hot', { ...flavour, isActive: false }]]) })).rejects.toThrow();
    mappings[1].modifierGroup.options[0].isActive = false;
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow();
  });
  it('accepts plain wings without a saucing method', async () => {
    const { params, payload } = fixture();
    payload.flavour_slots = [{ slot_no: 1, wing_flavour_id: 'plain', placement: 'ON_WINGS' }];
    delete payload.saucing_method;
    await expect(assertBuilderCatalogValid(params)).resolves.toBeUndefined();
  });
  it('requires the preparation modifier and rejects contradictory or excessive selections', async () => {
    const { params, payload } = fixture();
    params.modifierOptionIds = [];
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow('Invalid selections');
    params.modifierOptionIds = ['boneless'];
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow('does not match');
    payload.wing_type = 'BONELESS';
    await expect(assertBuilderCatalogValid(params)).resolves.toBeUndefined();
    params.modifierOptionIds.push('type');
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow();
  });
  it('preserves the required salad selection for Wings-4-U Special', async () => {
    const { params, mappings, payload } = fixture();
    params.menuItem = { ...item, slug: 'wings-4u-special' }; payload.weight_lb = 2;
    mappings.push(group('salads', 'salad', [{ id: 'garden', name: 'Garden Salad' }]));
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow('Invalid selections');
    payload.salad_customization = {};
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow('Invalid salad');
    delete payload.salad_customization;
    params.modifierOptionIds.push('garden');
    await expect(assertBuilderCatalogValid(params)).resolves.toBeUndefined();
  });
  it('validates side sauce placement against a non-plain slot', async () => {
    const { params, payload, mappings, flavourGroup } = fixture();
    mappings.push({ ...flavourGroup, modifierGroupId: 'second', modifierGroup: { ...flavourGroup.modifierGroup, id: 'second' } });
    payload.flavour_slots = [1, 2].map(slot_no => ({ slot_no, wing_flavour_id: 'hot', placement: slot_no === 2 ? 'ON_SIDE' : 'ON_WINGS' }));
    payload.saucing_method = 'SIDE'; payload.side_flavour_slot_no = 2;
    await expect(assertBuilderCatalogValid(params)).resolves.toBeUndefined();
    payload.side_flavour_slot_no = 9;
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow();
  });
  it.each([3, 5])('preserves %i-slot special pack rules and requires tell-us-how notes', async count => {
    const { params, payload, mappings, flavourGroup } = fixture();
    for (let n = 1; n < count; n++) mappings.push({ ...flavourGroup, modifierGroupId: 'slot-' + n, modifierGroup: { ...flavourGroup.modifierGroup, id: 'slot-' + n } });
    params.menuItem = { ...item, name: count === 5 ? '75 Wings ? 5 Flavours' : '5 Pound ? 3 Flavours', slug: count === 5 ? 'party-75-wings' : 'wings-5lb' };
    payload.weight_lb = count === 5 ? 8 : 5;
    payload.flavour_slots = Array.from({ length: count }, (_, n) => ({ slot_no: n + 1, wing_flavour_id: 'hot', placement: 'ON_WINGS' }));
    payload.saucing_method = 'TELL_US_HOW';
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow('Saucing instructions');
    payload.saucing_customer_note = 'Separate into boxes';
    await expect(assertBuilderCatalogValid(params)).resolves.toBeUndefined();
  });
  it('enforces combo sides/drinks, group ownership and limits', async () => {
    const { params, payload, mappings } = fixture();
    params.menuItem = { ...item, builderType: 'WING_COMBO' }; payload.builder_type = 'WING_COMBO';
    mappings.push(group('sides', 'side', [{ id: 'fries' }, { id: 'wedges' }]), group('drinks', 'drink', [{ id: 'pepsi' }]));
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow();
    params.modifierOptionIds = ['type', 'fries', 'pepsi']; payload.side_selections = ['fries']; payload.drink_selections = ['pepsi'];
    await expect(assertBuilderCatalogValid(params)).resolves.toBeUndefined();
    payload.side_selections = ['pepsi'];
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow();
    payload.side_selections = ['fries']; params.modifierOptionIds.push('wedges');
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow();
    params.modifierOptionIds = ['fries', 'unrelated'];
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow();
  });
  function lunchFixture() {
    const f = fixture(); f.params.modifierOptionIds = []; f.params.menuItem = { ...item, slug: 'lunch-burger', builderType: null };
    f.db.menuItemModifierGroup.findMany.mockResolvedValue([]);
    const child = { ...item, id: 'burger', slug: 'veggie-burger', builderType: null, category: { slug: 'burgers' },
      locationId: 'local', isHidden: false, stockStatus: 'NORMAL', removableIngredients: [{ id: 'onion', name: 'Onion' }],
      modifierGroups: [group('extras', 'addon', [{ id: 'cheese', priceDeltaCents: 150 }], false)] };
    f.db.menuItem.findFirst.mockResolvedValue(child);
    f.params.builderPayload = { builder_type: 'LUNCH_SPECIAL', child_menu_item_id: 'burger', child_addons: [{ modifier_option_id: 'cheese', price_delta_cents: 0 }], removed_ingredients: [{ id: 'onion', name: 'Onion' }] };
    return { ...f, child };
  }
  it.each(['lunch-burger', 'lunch-wrap'])('accepts established %s child relationships and removals', async slug => {
    const { params, child } = lunchFixture(); params.menuItem = { ...params.menuItem, slug };
    child.category.slug = slug === 'lunch-wrap' ? 'wraps' : 'burgers';
    await expect(assertBuilderCatalogValid(params)).resolves.toBeUndefined();
  });
  it('queries children within the order location and rejects missing cross-location children', async () => {
    const { params, db } = lunchFixture(); db.menuItem.findFirst.mockResolvedValue(null);
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow();
    expect(db.menuItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'burger', locationId: 'local' } }));
  });
  it.each(['unrelated', 'inactive', 'archived', 'hidden', 'fulfillment', 'schedule', 'category-schedule', 'helper', 'unrelated-addon', 'inactive-addon', 'removal'])('rejects invalid lunch child: %s', async issue => {
    const { params, child } = lunchFixture();
    if (issue === 'unrelated') child.category.slug = 'salads';
    if (issue === 'inactive') child.isAvailable = false;
    if (issue === 'archived') child.archivedAt = new Date();
    if (issue === 'hidden') child.isHidden = true;
    if (issue === 'fulfillment') child.allowedFulfillmentType = 'DELIVERY';
    if (issue === 'schedule') child.schedules = [{ dayOfWeek: 2, timeFrom: new Date(), timeTo: new Date() }];
    if (issue === 'category-schedule') Object.assign(child.category, { availableFromMinutes: 900, availableUntilMinutes: 1000 });
    if (issue === 'helper') child.slug = 'burger-side-add';
    if (issue === 'unrelated-addon') params.builderPayload!.child_addons = [{ modifier_option_id: 'unknown' }];
    if (issue === 'inactive-addon') child.modifierGroups[0].modifierGroup.options[0].isActive = false;
    if (issue === 'removal') params.builderPayload!.removed_ingredients = [{ id: 'unrelated', name: 'Lobster' }];
    await expect(assertBuilderCatalogValid(params)).rejects.toThrow();
  });
  it('preserves optional builders on ordinary items without catalogue reads', async () => {
    const { params, db } = fixture(); params.menuItem = { ...item, builderType: null };
    await expect(assertBuilderCatalogValid({ ...params, builderPayload: undefined })).resolves.toBeUndefined();
    expect(db.menuItemModifierGroup.findMany).not.toHaveBeenCalled();
  });
});

describe('lunch pricing and bundle attack regression matrix', () => {
  const catalogue = new Map([['paid', { priceDeltaCents: 150, isActive: true }], ['free', { priceDeltaCents: 0, isActive: true }], ['inactive', { priceDeltaCents: 200, isActive: false }]]);
  it.each([-999, 0, 999999999999])('ignores client money %i for paid and free catalogue options', price => {
    expect(getBuilderPriceDelta({ builder_type: 'LUNCH_SPECIAL', child_addons: [{ modifier_option_id: 'paid', price_delta_cents: price }] }, catalogue)).toBe(150);
    expect(getBuilderPriceDelta({ builder_type: 'LUNCH_SPECIAL', child_addons: [{ modifier_option_id: 'free', price_delta_cents: price }] }, catalogue)).toBe(0);
  });
  it.each([null, {}, [], 'paid', { modifier_option_id: '' }, { modifier_option_id: '  ' }, { modifier_option_id: 123 }, { modifier_option_id: 'unknown' }, { modifier_option_id: 'inactive' }])('rejects malformed or unresolved lunch entry %j', row => {
    expect(() => getBuilderPriceDelta({ builder_type: 'LUNCH_SPECIAL', child_addons: [row] }, catalogue)).toThrow();
  });
  it('rejects duplicates and non-array add-ons', () => {
    expect(() => getBuilderPriceDelta({ builder_type: 'LUNCH_SPECIAL', child_addons: [{ modifier_option_id: 'paid' }, { modifier_option_id: 'paid' }] }, catalogue)).toThrow();
    expect(() => getLunchAddonOptionIds({ builder_type: 'LUNCH_SPECIAL', child_addons: {} })).toThrow();
  });
  it.each([null, {}, [], { side_label: 'Fries' }, { side_label: 'Fries', pop_label: 'Champagne' }, { side_label: '<script>', pop_label: 'Coke' }])('rejects malformed bundle %j', bundle => {
    expect(() => assertBuilderPayloadValid({ menuItem: { ...item, builderType: null, slug: 'veggie-burger' }, builderPayload: { builder_type: 'ITEM_CUSTOMIZATION', side_pop_bundle: bundle } })).toThrow();
  });
  it.each(['Fries', 'Onion rings', 'Wedges', 'Coleslaw'])('accepts established bundle side %s at exactly 499 cents', side => {
    const payload = { builder_type: 'ITEM_CUSTOMIZATION', side_pop_bundle: { side_label: side, pop_label: 'Pepsi', price_cents: -10000 } };
    expect(() => assertBuilderPayloadValid({ menuItem: { ...item, builderType: null, slug: 'veggie-burger' }, builderPayload: payload })).not.toThrow();
    expect(getBuilderPriceDelta(payload)).toBe(499);
  });
});
