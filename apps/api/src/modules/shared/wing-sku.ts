import { UnprocessableEntityException } from '@nestjs/common';

type WingSku = { name: string; slug?: string | null };

// Owner-confirmed portions. SKU lookup does not create or enable catalogue items.
export const REGULAR_WING_PORTIONS = [
  { weightLb: 1, pieces: 9 }, { weightLb: 1.5, pieces: 14 },
  { weightLb: 2, pieces: 18 }, { weightLb: 2.5, pieces: 22 },
  { weightLb: 3, pieces: 27 }, { weightLb: 4, pieces: 36 }, { weightLb: 5, pieces: 45 },
] as const;

export function getWingSkuPortion(slug?: string | null): { weightLb: number; pieces: number | null; earnsStamps: boolean } | null {
  for (const portion of REGULAR_WING_PORTIONS) {
    if (slug === `wings-${portion.weightLb}lb` || slug === `combo-${portion.weightLb}lb`) {
      return { ...portion, earnsStamps: true };
    }
  }
  if (slug === 'party-75-wings') return { weightLb: 8, pieces: 75, earnsStamps: true };
  if (slug === 'party-100-wings') return { weightLb: 11, pieces: 100, earnsStamps: true };
  if (slug === 'wings-4u-special') return { weightLb: 2, pieces: null, earnsStamps: false };
  // Compatibility only: retain this SKU's previous value; its official weight
  // and stamp policy remain unspecified. Never generalize it to other products.
  if (slug === 'lunch-5-wings') return { weightLb: 0.33, pieces: 5, earnsStamps: false };
  return null;
}

export function getWingSkuWeightLb(item: WingSku): number | null {
  return getWingSkuPortion(item.slug)?.weightLb ?? null;
}

export function requireWingSkuWeightLb(item: WingSku | undefined): number {
  const weight = item ? getWingSkuWeightLb(item) : null;
  if (weight == null) {
    throw new UnprocessableEntityException({ message: 'Wing SKU weight is not configured unambiguously', field: 'items' });
  }
  return weight;
}
