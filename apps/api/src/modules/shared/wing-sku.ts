import { UnprocessableEntityException } from '@nestjs/common';

type WingSku = { name: string; slug?: string | null };

// Existing catalog.service.ts serialization rules, shared without new conversions.
export function getWingSkuWeightLb(item: WingSku): number | null {
  if (item.slug === 'wings-4u-special') return 2;
  const wings = item.name.match(/(\d+)\s*wings/i);
  const pounds = item.name.match(/([\d.]+)\s*pound/i);
  const weight = wings ? Number((Number.parseInt(wings[1], 10) / 15).toFixed(2))
    : pounds ? Number.parseFloat(pounds[1]) : NaN;
  return Number.isFinite(weight) && weight > 0 ? weight : null;
}

export function requireWingSkuWeightLb(item: WingSku | undefined): number {
  const weight = item ? getWingSkuWeightLb(item) : null;
  if (weight == null) {
    throw new UnprocessableEntityException({ message: 'Wing SKU weight is not configured unambiguously', field: 'items' });
  }
  return weight;
}
