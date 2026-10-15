import { ACTIVE_STATUSES, type ActivePromo, type OrderSummary } from './types';

export type AccountTabGate = 'loading' | 'guest' | 'content';

/** Shared gate for Deals and Orders. Guests never see invented balances. */
export function accountTabGate(input: {
  sessionLoaded: boolean;
  authenticated: boolean;
  loading: boolean;
}): AccountTabGate {
  if (!input.sessionLoaded) return 'loading';
  if (!input.authenticated) return 'guest';
  if (input.loading) return 'loading';
  return 'content';
}

export type SectionContentState = 'error' | 'empty' | 'ready';

export function sectionContentState(error: string | null | undefined, count: number): SectionContentState {
  if (error && count === 0) return 'error';
  if (count === 0) return 'empty';
  return 'ready';
}

export type RewardProgress = {
  stampsPerReward: number;
  availableStamps: number;
  stampsToNext: number;
  eligible: boolean;
  lifetimeStamps: number;
  lifetimeRedemptions: number;
};

/**
 * Progress toward the free 1lb wings reward.
 * The threshold is the API `stamps_per_reward` value. A missing summary is not
 * replaced with a placeholder balance.
 */
export function rewardProgress(summary: {
  available_stamps: number;
  lifetime_stamps: number;
  lifetime_redemptions: number;
  stamps_per_reward: number;
} | null): RewardProgress | null {
  if (!summary || summary.stamps_per_reward <= 0) return null;
  const stampsPerReward = summary.stamps_per_reward;
  const availableStamps = Math.min(Math.max(0, summary.available_stamps), stampsPerReward);
  return {
    stampsPerReward,
    availableStamps,
    stampsToNext: Math.max(0, stampsPerReward - availableStamps),
    eligible: availableStamps >= stampsPerReward,
    lifetimeStamps: summary.lifetime_stamps,
    lifetimeRedemptions: summary.lifetime_redemptions,
  };
}

export function formatBxgyDetails(promo: Pick<ActivePromo, 'bxgyRule'>): string | null {
  const rule = promo.bxgyRule;
  if (!rule) return null;
  const qualifying = rule.qualifyingLabel
    || rule.qualifyingSize?.label
    || (rule.qualifyingProductId || rule.qualifyingCategoryId ? 'Selected items' : 'Any item');
  const reward = rule.rewardLabel
    || rule.rewardSize?.label
    || (rule.rewardProductId || rule.rewardCategoryId ? 'Selected items' : 'Any item');
  return `Buy ${rule.requiredQty}: ${qualifying} -> Get ${rule.rewardQty}: ${reward}`;
}

/** Discount line from the promotion payload. Never invents a code or amount. */
export function promoBenefitLabel(promo: Pick<ActivePromo, 'benefitSummary' | 'discountType' | 'discountValue' | 'bxgyRule'>): string {
  if (promo.benefitSummary) return promo.benefitSummary;
  if (promo.discountType === 'PERCENT') return `${promo.discountValue}% OFF`;
  if (promo.discountType === 'FIXED_AMOUNT') return `$${(promo.discountValue / 100).toFixed(2)} OFF`;
  if (promo.discountType === 'FREE_DELIVERY') return 'FREE DELIVERY';
  return formatBxgyDetails(promo) ? 'BXGY' : 'BOGO';
}

export function promoFulfillmentLabel(type: string): string | null {
  if (type === 'PICKUP') return 'Pickup only';
  if (type === 'DELIVERY') return 'Delivery only';
  return null;
}

export function partitionOrders<T extends Pick<OrderSummary, 'status'>>(orders: T[]): { active: T[]; past: T[] } {
  const active: T[] = [];
  const past: T[] = [];
  for (const order of orders) {
    (ACTIVE_STATUSES.has(order.status) ? active : past).push(order);
  }
  return { active, past };
}
