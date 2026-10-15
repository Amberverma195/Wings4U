import type { ImageSource } from 'expo-image';

/**
 * A single promotional banner shown in the Home carousel.
 *
 * `categorySlug` is the canonical backend category slug this banner deep-links
 * to. The Menu screen resolves it against the live (prepared) menu so aliases
 * keep working — e.g. the "specialty-fries" category is merged into "sides" on
 * mobile by `combineSideCategories`. See `resolveCategorySlug`.
 */
export type PromotionalBanner = {
  key: string;
  /** Human-readable label used for accessibility + indicator hints. */
  label: string;
  /** Bundled local image (static require so it ships with the app). */
  source: ImageSource;
  /** Canonical menu category slug this banner opens. */
  categorySlug: string;
};

/**
 * Banners in display order: Wings -> Tenders -> Burgers -> Specialty Fries.
 * Keeping the config here (separate from the carousel animation logic) means
 * the ordering/targets can change without touching the component.
 */
export const PROMOTIONAL_BANNERS: PromotionalBanner[] = [
  {
    key: 'wings',
    label: 'Wings',
    source: require('../../assets/banners/wings-banner.png'),
    categorySlug: 'wings',
  },
  {
    key: 'tenders',
    label: 'Tenders',
    source: require('../../assets/banners/tenders-banner.png'),
    categorySlug: 'tenders',
  },
  {
    key: 'burgers',
    label: 'Burgers',
    source: require('../../assets/banners/burgers-banner.png'),
    categorySlug: 'burgers',
  },
  {
    key: 'specialty-fries',
    label: 'Specialty Fries',
    source: require('../../assets/banners/specialty-fries-banner.png'),
    categorySlug: 'specialty-fries',
  },
];
