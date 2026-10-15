/** Customer-facing category order shared by web and native ordering surfaces. */
const CATEGORY_ORDER = [
  'lunch-specials', 'wings', 'wing-combos', 'burgers', 'tenders', 'wraps',
  'salads', 'poutines-and-sides', 'sides', 'appetizers', 'breads', 'specials',
  'party-specials', 'drinks', 'dessert', 'dips',
];

export function sortMenuCategories<T extends { slug: string; sort_order: number }>(categories: T[]): T[] {
  return [...categories].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.slug);
    const bi = CATEGORY_ORDER.indexOf(b.slug);
    const aKey = ai === -1 ? 1000 + a.sort_order : ai;
    const bKey = bi === -1 ? 1000 + b.sort_order : bi;
    return aKey - bKey || a.sort_order - b.sort_order;
  });
}

/** Merge legacy specialty fries into Sides, preserving real item IDs and prices. */
export function combineSideCategories<T extends {
  id: string; slug: string; name: string; items: Array<{ id: string }>;
}>(categories: T[]): T[] {
  const sides = categories.find(category => category.slug === 'sides');
  const specialty = categories.filter(category => category.slug === 'specialty-fries');
  if (!sides || specialty.length === 0) return categories;
  const seen = new Set<string>();
  const items = [sides, ...specialty].flatMap(category => category.items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }));
  return categories.flatMap(category => category.slug === 'specialty-fries' ? [] :
    category.id === sides.id ? [{ ...sides, name: 'Sides', items }] : [category]);
}
