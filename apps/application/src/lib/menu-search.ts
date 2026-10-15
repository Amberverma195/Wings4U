import type { MenuCategory } from './types';

/** Filter the loaded menu for the header controls without changing server data. */
export function filterMenuCategories(
  categories: MenuCategory[], query: string, availableOnly = false,
): MenuCategory[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized && !availableOnly) return categories;
  return categories.map(category => ({
    ...category,
    items: category.items.filter(item => {
      if (availableOnly && (!item.is_available || item.stock_status === 'UNAVAILABLE')) return false;
      return !normalized || [category.name, item.name, item.description ?? '']
        .some(value => value.toLocaleLowerCase().includes(normalized));
    }),
  })).filter(category => category.items.length > 0);
}
