import { assertBuilderCatalogValid } from './builder-catalog-validation';

function fixture() {
  const product: any = { id: 'burger', name: 'Burger', slug: 'chicken-burger', builderType: null,
    removableIngredients: [{ id: 'lettuce', name: 'Lettuce' }], modifierGroups: [{ modifierGroupId: 'extras' }] };
  const group: any = { id: 'extras', name: 'Burger Extras', displayLabel: 'Extras', locationId: 'store', archivedAt: null,
    contextKey: 'addon', sortOrder: 1, minSelect: 0, maxSelect: 10, isRequired: false, selectionMode: 'MULTI', menuItems: [{ menuItemId: 'burger' }],
    options: [
      { id: 'lettuce-extra', name: 'Extra Lettuce', addonMatchNormalized: 'lettuce', priceDeltaCents: 50, isActive: true },
      { id: 'avocado', name: 'Add Avocado', addonMatchNormalized: null, priceDeltaCents: 200, isActive: true },
      { id: 'bacon', name: 'Add Bacon', addonMatchNormalized: '__always__', priceDeltaCents: 150, isActive: true },
    ] };
  const mappings: any[] = [{ menuItemId: 'burger', modifierGroup: group, contextKey: 'addon' }];
  const db: any = { menuItemModifierGroup: { findMany: jest.fn(async () => mappings) } };
  const run = (ids: string[]) => assertBuilderCatalogValid({ db, locationId: 'store', menuItem: product, modifierOptionIds: ids,
    fulfillmentType: 'PICKUP', context: { timezone: 'America/Toronto', dow: 1, hhmm: 720 }, wingFlavourMap: new Map() });
  return { product, group, mappings, db, run };
}

it('rejects an unrelated option even when it belongs to the linked group', async () => {
  const f = fixture(); await expect(f.run(['avocado'])).rejects.toThrow('unauthorized');
});
it('accepts an ingredient-scoped extra and explicit item approval', async () => {
  const f = fixture(); await expect(f.run(['lettuce-extra', 'bacon'])).resolves.toBeUndefined();
});
it('rejects ingredient-scoped selections after admin removes the ingredient', async () => {
  const f = fixture(); f.product.removableIngredients = []; await expect(f.run(['lettuce-extra'])).rejects.toThrow('unauthorized');
});
it('never treats __always__ on a shared group as global authorization', async () => {
  const f = fixture(); f.group.menuItems.push({ menuItemId: 'wrap' }); await expect(f.run(['bacon'])).rejects.toThrow('unauthorized');
});
it('rejects removed and inactive selections with current catalog rows', async () => {
  const f = fixture(); f.group.options[0].isActive = false;
  await expect(f.run(['lettuce-extra'])).rejects.toThrow(); await expect(f.run(['deleted-id'])).rejects.toThrow();
});
it('rejects duplicate charges through equivalent optional extras', async () => {
  const f = fixture(); f.group.options.push({ ...f.group.options[0], id: 'lettuce-duplicate' });
  await expect(f.run(['lettuce-extra', 'lettuce-duplicate'])).rejects.toThrow('unauthorized');
});
it('rejects conflicting prices rather than selecting a price silently', async () => {
  const f = fixture(); f.group.options.push({ ...f.group.options[0], id: 'lettuce-duplicate', priceDeltaCents: 200 });
  await expect(f.run(['lettuce-extra'])).rejects.toThrow('unauthorized');
});
it('dedicated additional ingredient configuration overrides old shared configuration', async () => {
  const f = fixture();
  f.mappings.push({ menuItemId: 'burger', contextKey: 'addon', modifierGroup: { ...f.group, id: 'editor', name: 'Burger Additional Ingredients', menuItems: [{ menuItemId: 'burger' }], options: [] } });
  // The old group is exclusively mapped too, but the editor remains authoritative.
  f.group.menuItems.push({ menuItemId: 'wrap' });
  await expect(f.run(['lettuce-extra'])).rejects.toThrow('unauthorized');
});
