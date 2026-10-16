import type { PromotionalBanner } from './promotional-banners';
import type { FulfillmentType, MenuCategory, MenuItem } from './types';

/** Numeric poster order, verified against the catalog's Lunch Specials SKUs. */
export const FOOTER_PROMOTIONAL_BANNERS: PromotionalBanner[] = [
  { key: 'lunch-1', label: 'Lunch Special 1: 3pc Chicken Tender + Small Fry + Pop',
    source: require('../../assets/footer carousol/Wings4U Lunch Specials Banner 1.png'),
    categorySlug: 'lunch-specials', itemSlug: 'lunch-3-tender', contentFit: 'contain' },
  { key: 'lunch-2', label: 'Lunch Special 2: 5 Wings + Small Fry + Pop',
    source: require('../../assets/footer carousol/Wings4U Lunch Specials Banner 2.png'),
    categorySlug: 'lunch-specials', itemSlug: 'lunch-5-wings', contentFit: 'contain' },
  { key: 'lunch-3', label: 'Lunch Special 3: 6pc Chicken Nuggets + Small Fry + Pop',
    source: require('../../assets/footer carousol/Wings4U Lunch Specials Banner 3.png'),
    categorySlug: 'lunch-specials', itemSlug: 'lunch-6-nuggets', contentFit: 'contain' },
  { key: 'lunch-4', label: 'Lunch Special 4: Any Burger + Small Fry + Pop',
    source: require('../../assets/footer carousol/Wings4U Lunch Specials Banner 4.png'),
    categorySlug: 'lunch-specials', itemSlug: 'lunch-burger', contentFit: 'contain' },
  { key: 'lunch-5', label: 'Lunch Special 5: Any Wrap + Small Fry + Pop',
    source: require('../../assets/footer carousol/Wings4U Lunch Specials Banner 5.png'),
    categorySlug: 'lunch-specials', itemSlug: 'lunch-wrap', contentFit: 'contain' },
  { key: 'lunch-6', label: 'Lunch Special 6: Large Poutine + Pop',
    source: require('../../assets/footer carousol/Wings4U Lunch Specials Banner 6.png'),
    categorySlug: 'lunch-specials', itemSlug: 'lunch-poutine', contentFit: 'contain' },
  { key: 'party', label: 'Party Specials: 75 or 100 Wings',
    source: require('../../assets/footer carousol/Wings4U Party Specials Banner.png'),
    categorySlug: 'party-specials', contentFit: 'contain' },
];

export type PromotionTarget = { category: MenuCategory; item: MenuItem | null };

/** Resolve only orderable targets returned by the current backend menu. */
export function resolveFooterPromotion(
  categories: MenuCategory[], categorySlug: string, itemSlug: string | undefined, fulfillmentType: FulfillmentType,
): PromotionTarget | null {
  const category = categories.find(category => category.slug === categorySlug);
  if (!category) return null;
  const available = (item: MenuItem) => item.is_available && item.stock_status !== 'UNAVAILABLE' &&
    (item.allowed_fulfillment_type === 'BOTH' || item.allowed_fulfillment_type === fulfillmentType);
  if (!itemSlug) return category.items.some(available) ? { category, item: null } : null;
  const item = category.items.find(item => item.slug === itemSlug);
  return item && available(item) ? { category, item } : null;
}
