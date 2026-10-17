import type { CartItem, FulfillmentType, MenuCategory, MenuItem } from './types';

export type PopularItem = { title: string; categorySlug: string; item: MenuItem | null; category: MenuCategory | null };

export function isOrderable(item: MenuItem, fulfillment: FulfillmentType) {
  return item.is_available && item.stock_status !== 'UNAVAILABLE' &&
    (item.allowed_fulfillment_type === 'BOTH' || item.allowed_fulfillment_type === fulfillment);
}

/** Curated families only; all commercial data and orderable IDs come from the menu API. */
export function popularItems(categories: MenuCategory[], fulfillment: FulfillmentType): PopularItem[] {
  const find = (slug: string) => categories.find(category => category.slug === slug) ?? null;
  const wings = find('wings'), tenders = find('tenders'), combos = find('wing-combos');
  const tenderItems = (tenders?.items ?? []).filter(item => /tender/i.test(`${item.slug} ${item.name}`) && !/combo/i.test(`${item.slug} ${item.name}`));
  const tender = [...tenderItems].sort((a, b) =>
    Number(isOrderable(b, fulfillment)) - Number(isOrderable(a, fulfillment)) || a.base_price_cents - b.base_price_cents)[0] ?? null;
  return [
    { title: 'Wings (By the Pound)', categorySlug: 'wings', category: wings,
      item: wings?.items.find(item => item.slug === 'wings-by-the-pound' && item.builder_type === 'WINGS') ?? null },
    { title: 'Chicken Tenders', categorySlug: 'tenders', category: tenders, item: tender },
    { title: 'Wing Combo', categorySlug: 'wing-combos', category: combos,
      item: combos?.items.find(item => item.slug === 'wing-combo-builder' && item.builder_type === 'WING_COMBO') ?? null },
  ];
}

export function cartLineForPopularItem(item: MenuItem, lines: CartItem[]): CartItem | null {
  const ids = new Set([item.id, ...(item.weight_options ?? []).map(option => option.menu_item_id),
    ...(item.combo_options ?? []).map(option => option.menu_item_id)]);
  return [...lines].reverse().find(line => ids.has(line.menu_item_id)) ?? null;
}

export function needsCustomization(item: MenuItem) {
  return Boolean(item.builder_type || item.requires_special_instructions || item.modifier_groups.length || item.removable_ingredients?.length);
}
