jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
import { AdminMenuService } from './admin-menu.service';
import { assertBuilderCatalogValid } from '../shared/builder-catalog-validation';
import { customizationCatalog } from '@wings4u/customization';
import { CatalogService } from '../catalog/catalog.service';
const { planBuilderSync } = require('../../../../../packages/database/prisma/builder-sync-plan');

// Stateful fake: filters inactive options exactly as the Admin/public queries
// request. There is deliberately no hard-delete operation for options/orders.
function fixture(shared = false) {
  const item: any = { id: 'chicken', name: 'Chicken Burger', slug: 'chicken-burger', locationId: 'loc',
    isWingComboSide: false, isAvailable: true, isHidden: false, archivedAt: null, builderType: null,
    categoryId: 'burgers', stockStatus: 'NORMAL', allowedFulfillmentType: 'BOTH', basePriceCents: 999 };
  let serial = 0;
  const options: any[] = ['Add Avocado', 'Add Jalapenos', 'Extra Sauce', 'Add Bacon', 'Extra Cheese'].map((name, i) => ({
    id: 'option-' + i, modifierGroupId: 'extras', name, priceDeltaCents: i === 3 ? 150 : 50,
    addonMatchNormalized: i > 2 ? '__always__' : null, isActive: true, isDefault: false, sortOrder: i,
  }));
  const history = [{ modifierOptionId: 'option-0', modifierGroupId: 'extras', modifierNameSnapshot: 'Add Avocado', priceDeltaCents: 50 }];
  const groups: any[] = [{ id: 'extras', locationId: 'loc', name: 'Chicken Burger Extras', displayLabel: 'Extras',
    contextKey: 'addon', archivedAt: null, selectionMode: 'MULTI', minSelect: 0, maxSelect: 5, isRequired: false, sortOrder: 1 }];
  const links: any[] = [{ menuItemId: item.id, modifierGroupId: 'extras', contextKey: 'addon', sortOrder: 1 },
    ...(shared ? [{ menuItemId: 'other-burger', modifierGroupId: 'extras', contextKey: 'addon', sortOrder: 1 }] : [])];
  const ingredients = [{ id: 'lettuce', menuItemId: item.id, name: 'Lettuce', sortOrder: 1 }];
  const hydrate = (link: any, activeOnly = false) => ({ ...link, modifierGroup: {
    ...groups.find(g => g.id === link.modifierGroupId),
    menuItems: links.filter(l => l.modifierGroupId === link.modifierGroupId),
    options: options.filter(o => o.modifierGroupId === link.modifierGroupId && (!activeOnly || o.isActive)),
  } });
  const db: any = {
    location: { findUnique: jest.fn(async ({ include }: any) => {
      const itemQuery = include.menuCategories.include.menuItems;
      expect(itemQuery.where).toMatchObject({ isHidden: false, archivedAt: null });
      const activeOnly = itemQuery.include.modifierGroups.include.modifierGroup.include.options.where.isActive === true;
      return { id: 'loc', name: 'Fixture', isActive: true, timezoneName: 'America/Toronto', settings: null, hours: [],
        menuCategories: [{ id: 'burgers', name: 'Burgers', slug: 'burgers', sortOrder: 1,
          menuItems: item.isHidden || item.archivedAt ? [] : [{ ...item, schedules: [], removableIngredients: ingredients,
            modifierGroups: links.filter(l => l.menuItemId === item.id).map(l => hydrate(l, activeOnly)) }] }] };
    }) },
    menuCategory: { findFirst: jest.fn(async () => ({ id: 'burgers' })) },
    menuItem: {
      findFirst: jest.fn(async ({ include }: any) => include ? { ...item, removableIngredients: structuredClone(ingredients),
        schedules: [], modifierGroups: links.filter(l => l.menuItemId === item.id).map(l => hydrate(l, include.modifierGroups.include.modifierGroup.include.options.where.isActive === true)) } : { ...item }),
      update: jest.fn(async ({ data }: any) => Object.assign(item, data)),
    },
    modifierGroup: {
      count: jest.fn(async ({ where }: any) => groups.filter(g => where.id.in.includes(g.id)).length),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => { const g = { id: 'copy-' + ++serial, ...data }; groups.push(g); return g; }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(groups.find(g => g.id === where.id), data)),
    },
    modifierOption: {
      update: jest.fn(async ({ where, data }: any) => Object.assign(options.find(o => o.id === where.id), data)),
      create: jest.fn(async ({ data }: any) => { const o = { id: 'copy-option-' + ++serial, isActive: true, ...data }; options.push(o); return o; }),
      createMany: jest.fn(async ({ data }: any) => { for (const row of data) options.push({ id: 'new-option-' + ++serial, isActive: true, ...row }); }),
    },
    menuItemModifierGroup: {
      findMany: jest.fn(async ({ where }: any) => links.filter(l => l.menuItemId === where.menuItemId).map(l => hydrate(l))),
      deleteMany: jest.fn(async ({ where }: any) => { for (let i = links.length - 1; i >= 0; i--) {
        const l = links[i];
        if (l.menuItemId === where.menuItemId && (typeof where.modifierGroupId === 'string' ? l.modifierGroupId === where.modifierGroupId : !where.modifierGroupId.notIn.includes(l.modifierGroupId))) links.splice(i, 1);
      } }),
      create: jest.fn(async ({ data }: any) => { links.push(data); return data; }),
      createMany: jest.fn(async ({ data }: any) => links.push(...data)),
    },
    removableIngredient: {
      findMany: jest.fn(async () => structuredClone(ingredients)),
      update: jest.fn(async ({ where, data }: any) => Object.assign(ingredients.find(i => i.id === where.id)!, data)),
      deleteMany: jest.fn(async ({ where }: any) => { for (let i = ingredients.length - 1; i >= 0; i--) if (!where.id.notIn.includes(ingredients[i].id)) ingredients.splice(i, 1); }),
    },
    $transaction: jest.fn(async (callback: any) => callback(db)),
  };
  const cache = { invalidateLocation: jest.fn() }, web = { revalidateLocation: jest.fn() }, realtime = { emitCatalogUpdated: jest.fn() };
  const service = new AdminMenuService(db, cache as any, web as any, realtime as any);
  const publicMenu = () => new CatalogService(db, { getMenuBase: async () => ({ key: 'fixture', value: null }),
    setMenuBase: async () => {} } as any).getMenu('loc', 'PICKUP');
  const payload = () => ({ name: item.name, base_price_cents: item.basePriceCents, category_id: item.categoryId,
    stock_status: item.stockStatus, is_hidden: item.isHidden, is_wing_combo_side: item.isWingComboSide, allowed_fulfillment_type: item.allowedFulfillmentType });
  const save = (extra: any = {}) => service.updateItem('loc', item.id, { ...payload(), ...extra });
  const snapshot = () => ({ catalog: [{ id: item.id, slug: item.slug, archived_at: item.archivedAt, is_hidden: item.isHidden,
    removable_ingredients: structuredClone(ingredients), modifier_groups: links.filter(l => l.menuItemId === item.id).map(l => {
      const { modifierGroup: g } = hydrate(l);
      return { id: g.id, name: g.name, display_label: g.displayLabel, context_key: g.contextKey, selection_mode: g.selectionMode,
        min_select: g.minSelect, max_select: g.maxSelect, is_required: g.isRequired, sort_order: g.sortOrder,
        addon_scope_menu_item_id: !g.name.endsWith(' [shared copy]') && g.menuItems.length === 1 ? item.id : null,
        options: g.options.map((o: any) => ({ id: o.id, name: o.name, price_delta_cents: o.priceDeltaCents,
          addon_match_normalized: o.addonMatchNormalized, is_active: o.isActive, is_default: o.isDefault })) };
    }) }] });
  const validate = (ids: string[]) => assertBuilderCatalogValid({ db, locationId: 'loc', menuItem: { ...item,
    removableIngredients: ingredients, modifierGroups: links.filter(l => l.menuItemId === item.id) } as any,
    modifierOptionIds: ids, fulfillmentType: 'PICKUP', context: { timezone: 'America/Toronto', dow: 1, hhmm: 720 }, wingFlavourMap: new Map() });
  const activeRows = (editor: any): Array<{ id: string; name: string; price_delta_cents: number; matches_ingredient: string }> => editor.modifierGroups.flatMap((l: any) => l.modifierGroup.options.map((o: any) => ({
    id: o.id, name: o.name, price_delta_cents: o.priceDeltaCents,
    matches_ingredient: o.addonMatchNormalized === '__always__' ? '' : o.addonMatchNormalized ?? '__unconfigured__',
  })));
  return { item, options, groups, links, ingredients, history, db, service, save, snapshot, validate, activeRows, cache, web, realtime, publicMenu };
}

describe('permanent Admin removal with offline builder planning', () => {
  it('permits intentional recreation through Admin while retaining the old inactive historical row', async () => {
    const f = fixture();
    const editor = await f.service.getItem('loc', f.item.id);
    await f.save({ additional_ingredients: f.activeRows(editor).filter(o => o.name !== 'Extra Sauce') });
    const reopened = await f.service.getItem('loc', f.item.id);
    await f.save({ additional_ingredients: [...f.activeRows(reopened), { name: 'Extra Sauce', price_delta_cents: 75, matches_ingredient: '' }] });
    expect(f.options.find(o => o.id === 'option-2').isActive).toBe(false);
    const restored = f.options.find(o => o.name === 'Extra Sauce' && o.isActive);
    expect(restored.id).not.toBe('option-2');
    expect(restored).toMatchObject({ priceDeltaCents: 75, addonMatchNormalized: '__always__' });
    await expect(f.validate([restored.id])).resolves.toBeUndefined();
  });

  it.each([false, true])('only an explicit side-membership enable may restore an inactive combo option (was enabled=%s)', async wasEnabled => {
    const f = fixture(); f.item.isWingComboSide = wasEnabled;
    const side = { id: 'side-option', name: f.item.name, isActive: false, linkedMenuItemId: f.item.id, sortOrder: 1 };
    f.options.push(side);
    f.db.modifierGroup.findMany.mockResolvedValue([{ id: 'side-group', options: [side] }]);
    await f.save({ is_wing_combo_side: true });
    expect(side.isActive).toBe(!wasEnabled);
    expect(f.db.modifierOption.create).not.toHaveBeenCalled();
  });

  it('unrelated side product saves cannot recreate a missing option in another group', async () => {
    const f = fixture(); f.item.isWingComboSide = true;
    f.db.modifierGroup.findMany.mockResolvedValue([{ id: 'side-group', options: [] }]);
    await f.save({ description: 'Changed description' }); await f.save();
    expect(f.db.modifierOption.create).not.toHaveBeenCalled();
  });

  it.each(['Add Avocado', 'Add Jalapenos', 'Extra Sauce'])('removes Chicken Burger / %s, reopens, saves again and never restores through sync', async name => {
    const f = fixture(), beforeHistory = structuredClone(f.history);
    const removed = f.options.find(o => o.name === name);
    const before = structuredClone(f.options.filter(o => o.id !== removed.id));
    const editor = await f.service.getItem('loc', f.item.id);
    await f.save({ modifier_groups: [{ id: 'extras' }], additional_ingredients: f.activeRows(editor).filter(o => o.id !== removed.id) });
    expect(removed.isActive).toBe(false);
    expect(f.options).toHaveLength(5); // Historical row retained, not recreated.
    expect(f.options.filter(o => o.id !== removed.id)).toEqual(before);
    const reopen = await f.service.getItem('loc', f.item.id);
    expect(f.activeRows(reopen).some(o => o.id === removed.id)).toBe(false);
    await f.save({ description: 'Unrelated change' });
    await f.save({ additional_ingredients: f.activeRows(reopen) });
    for (let i = 0; i < 2; i++) {
      const snapshot = f.snapshot(), original = structuredClone(snapshot);
      expect(planBuilderSync(snapshot).writes).toBe(0);
      expect(snapshot).toEqual(original);
    }
    await expect(f.validate([removed.id])).rejects.toThrow();
    const bacon = f.options.find(o => o.name === 'Add Bacon');
    await expect(f.validate([bacon.id])).resolves.toBeUndefined();
    const publicProduct = (await f.publicMenu()).categories[0].items[0];
    expect(publicProduct.modifier_groups.flatMap(g => g.options).some(o => o.id === removed.id)).toBe(false);
    expect(customizationCatalog(publicProduct).groups.flatMap(g => g.options).some(o => o.id === removed.id)).toBe(false);
    expect(bacon).toMatchObject({ id: 'option-3', priceDeltaCents: 150, addonMatchNormalized: '__always__' });
    expect(f.history).toEqual(beforeHistory);
    expect(f.db.modifierOption.create).not.toHaveBeenCalled();
    expect(f.cache.invalidateLocation).toHaveBeenCalledTimes(3);
    expect(f.web.revalidateLocation).toHaveBeenCalledTimes(3);
    expect(f.realtime.emitCatalogUpdated).toHaveBeenCalledTimes(3);
  });

  it('shared-group removal only changes the edited item; neither sync nor a repeated save reattaches the original', async () => {
    const f = fixture(true), original = structuredClone(f.options);
    const editor = await f.service.getItem('loc', f.item.id);
    await f.save({ modifier_groups: [{ id: 'extras' }], additional_ingredients: f.activeRows(editor).filter(o => o.name !== 'Add Avocado') });
    expect(f.options.filter(o => o.modifierGroupId === 'extras')).toEqual(original);
    expect(f.links).toContainEqual(expect.objectContaining({ menuItemId: 'other-burger', modifierGroupId: 'extras' }));
    expect(f.links).not.toContainEqual(expect.objectContaining({ menuItemId: 'chicken', modifierGroupId: 'extras' }));
    const reopened = await f.service.getItem('loc', f.item.id);
    expect(f.activeRows(reopened).some(o => o.name === 'Add Avocado')).toBe(false);
    await f.save({ modifier_groups: reopened.modifierGroups.map(l => ({ id: l.modifierGroupId })), additional_ingredients: f.activeRows(reopened) });
    const before = f.snapshot(); planBuilderSync(before); planBuilderSync(before);
    expect(f.snapshot()).toEqual(before);
    await expect(f.validate(['option-0'])).rejects.toThrow();
    // Shared __always__ values remain unscoped rather than becoming approvals.
    const catalog = f.snapshot().catalog[0];
    expect(catalog.modifier_groups[0].addon_scope_menu_item_id).toBeNull();
  });

  it('unlinked groups, removed recipe rows and hidden/archived items stay absent after repeated planning', async () => {
    const f = fixture();
    await f.save({ modifier_groups: [], removable_ingredients: [], is_hidden: true });
    await f.service.deleteItem('loc', f.item.id);
    const before = f.snapshot();
    expect(before.catalog[0]).toMatchObject({ is_hidden: true, modifier_groups: [], removable_ingredients: [] });
    expect(before.catalog[0].archived_at).toBeInstanceOf(Date);
    expect(planBuilderSync(before).writes).toBe(0); expect(planBuilderSync(before).writes).toBe(0);
    expect(f.snapshot()).toEqual(before);
    await expect(f.validate(['option-3'])).rejects.toThrow();
  });
});
