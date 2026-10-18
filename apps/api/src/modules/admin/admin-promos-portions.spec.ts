import { AdminPromosService } from './admin-promos.service';

describe('promotion size lookup uses official SKU equivalents', () => {
  it.each([['party-75-wings', 8, '75 wings'], ['party-100-wings', 11, '100 wings'], ['wings-1.5lb', 1.5, '1.5lb']] as const)('%s has a stable identity and correct internal size', async (slug, weight, label) => {
    const db = { menuItem: { findFirst: jest.fn().mockResolvedValue({ id: 'sku', slug, name: 'Display label', builderType: 'WINGS', modifierGroups: [] }) } };
    const result = await new AdminPromosService(db as never).listTargetItemSizes('location', 'sku');
    expect(result.sizes).toEqual([{ kind: 'weight_lb', weightLb: weight, label, menuItemId: 'sku' }]);
  });
});
