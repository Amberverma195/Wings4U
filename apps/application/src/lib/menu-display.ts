import { combineSideCategories, sortMenuCategories } from '../../../../packages/contracts/src/menu-categories';
import type { MenuCategory, MenuItem } from './types';

const NOTE_ONLY_ITEM_SLUGS = new Set(['wrap-side-add', 'burger-side-add']);

/** Match the website category strip without changing any orderable item data. */
export function prepareMenuCategories(categories: MenuCategory[]): MenuCategory[] {
  const prepared = sortMenuCategories(combineSideCategories(categories)).map(category => ({
    ...category, items: category.items.filter(item => !NOTE_ONLY_ITEM_SLUGS.has(item.slug)),
  }));
  if (prepared.some(category => category.slug === 'salads')) return prepared;
  const wraps = prepared.findIndex(category => category.slug === 'wraps');
  const poutines = prepared.findIndex(category => category.slug === 'poutines-and-sides');
  const insertAt = wraps >= 0 ? wraps + 1 : poutines >= 0 ? poutines : prepared.length;
  prepared.splice(insertAt, 0, {
    id: '00000000-0000-4000-8000-0000000000ad', name: 'Salads', slug: 'salads', sort_order: 7, items: [],
  });
  return prepared;
}

/** The website displays quantity/size details on cards, while builders keep the original item. */
export function menuCardDetails(item: MenuItem, categorySlug: string) {
  const quantity = ['appetizers', 'appetizers-extras'].includes(categorySlug)
    ? /^(.*?)\s*\((\d+\s*pc\.?)\)\s*$/i.exec(item.name) : null;
  const normalizeSize = (value: string) => value.replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const sizeGroup = item.modifier_groups.find(group => group.context_key === 'size');
  const labelsOnly = ['poutines-and-sides', 'poutines-sides', 'breads'].includes(categorySlug);
  const sizeSummary = categorySlug !== 'salads' && sizeGroup?.options.length
    ? 'Sizes: ' + sizeGroup.options.map(option => normalizeSize(option.name) + (labelsOnly ? '' :
      ` $${((item.base_price_cents + option.price_delta_cents) / 100).toFixed(2)}`)).join(', ')
    : null;
  let description = item.description?.trim() ?? '';
  if (item.slug === 'wings-4u-special') {
    description = description.replace(/,\s*and\s+any\s+removals\s+or\s+extras\.?/gi, '')
      .replace(/\s+Pick wing type,\s*1 flavour,\s*salad,\s*(?:and\s+)?2 pops\.?/gi, '')
      .replace(/\s{2,}/g, ' ').trim();
  }
  return {
    name: quantity?.[1].trim() ?? item.name,
    description: [sizeSummary, quantity ? normalizeSize(quantity[2]) : null, description]
      .filter(Boolean).join(' · ') || null,
  };
}

export function categoryNote(slug: string): string | null {
  if (slug === 'burgers') return 'All buns are toasted with butter.';
  if (slug === 'wing-combos') return 'Side options for combos: Fries, Onion Rings, Wedges or Coleslaw';
  return null;
}
