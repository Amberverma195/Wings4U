/**
 * Shared promo/reward selection rules for the mobile cart + checkout flow.
 *
 * This module intentionally contains NO discount math. All totals are computed
 * server-side by `/api/v1/cart/quote`, `/api/v1/checkout`, and the Stripe
 * payment-intent endpoint. These helpers only decide WHICH promotion the
 * customer selected and translate that selection into request params, matching
 * the website's cart-to-checkout behavior.
 */

import type { CartQuoteResponse } from './types';

/**
 * The customer's current promotion selection. A coupon code and the "1lb free
 * wings" reward are mutually exclusive (the backend enforces non-stacking; we
 * mirror it client-side so the UI never promises an impossible combination).
 */
export type PromoSelection = {
  promoCode: string | null;
  applyWingsReward: boolean;
};

export const EMPTY_PROMO_SELECTION: PromoSelection = {
  promoCode: null,
  applyWingsReward: false,
};

export type PromoAction =
  | { type: 'applyPromo'; code: string }
  | { type: 'applyWingsReward' }
  | { type: 'clearPromo' }
  | { type: 'clearWingsReward' }
  | { type: 'clearAll' };

/**
 * Pure reducer enforcing the non-stacking rule: applying a coupon clears the
 * wings reward and vice versa (mirrors the website's
 * `setApplyWingsReward(false)` / `setPromoApplied("")` behavior).
 */
export function promoReducer(state: PromoSelection, action: PromoAction): PromoSelection {
  switch (action.type) {
    case 'applyPromo': {
      const code = action.code.trim();
      if (!code) return state;
      return { promoCode: code, applyWingsReward: false };
    }
    case 'applyWingsReward':
      return { promoCode: null, applyWingsReward: true };
    case 'clearPromo':
      if (!state.promoCode) return state;
      return { ...state, promoCode: null };
    case 'clearWingsReward':
      if (!state.applyWingsReward) return state;
      return { ...state, applyWingsReward: false };
    case 'clearAll':
      return EMPTY_PROMO_SELECTION;
    default:
      return state;
  }
}

/**
 * Request params for `/cart/quote`, `/checkout`, and the Stripe payment-intent.
 *
 * The website rule: `apply_wings_reward: applyWingsReward && !promoApplied`.
 * A trimmed promo code always wins over the reward.
 */
export function quotePromoParams(
  state: PromoSelection,
): { promo_code?: string; apply_wings_reward?: true } {
  const promoCode = state.promoCode?.trim();
  if (promoCode) return { promo_code: promoCode };
  if (state.applyWingsReward) return { apply_wings_reward: true };
  return {};
}

// Ported verbatim from `apps/web/src/lib/promo-errors.ts` so mobile reacts to
// the exact same server rejection messages the website handles.
const PROMO_REJECTION_PATTERNS = [
  /^no eligible items for this promo\./i,
  /^invalid or expired promo code$/i,
  /^invalid coupon$/i,
  /^only one deal can be applied at a time$/i,
  /^this promo code is only valid for (delivery|pickup) orders$/i,
  /^this promo code has reached its usage limit$/i,
  /^this promo code can only be used/i,
  /^this promo code is only valid on a first order$/i,
  /^minimum order of .+ required for this promo$/i,
  /^delivery is already free for this order$/i,
  /^cart does not meet requirements for this buy x get y promo$/i,
];

/** True when a quote/checkout error means the selected promo code was rejected. */
export function isPromoRejectedQuoteError(message?: string | null): boolean {
  const normalized = message?.trim();
  if (!normalized) return false;
  return PROMO_REJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * When the reward is selected but the server declined to apply it, return a
 * human-readable reason (mirrors the website's wings-reward card messaging).
 * Returns null when the reward is applied or not selected.
 */
export function wingsRewardBlockedReason(
  applyWingsReward: boolean,
  quote: Pick<CartQuoteResponse, 'wings_reward'> | null,
): string | null {
  if (!applyWingsReward || !quote) return null;
  const reward = quote.wings_reward;
  if (!reward || reward.applied) return null;
  switch (reward.not_eligible_reason) {
    case 'NO_WINGS_IN_CART':
      return 'Add 1lb of individual wings to use your free wings reward.';
    case 'NOT_ENOUGH_STAMPS':
      return 'You no longer have enough stamps to redeem this reward.';
    case 'NOT_SIGNED_IN':
      return 'Sign in to apply your free wings reward.';
    default:
      return 'This reward could not be applied to your current cart.';
  }
}

export type PromoDiscountRow = { key: string; label: string; amountCents: number };

/**
 * Server-calculated discount rows for the order summary. Mirrors the website,
 * which surfaces the wings reward and promo code as distinct deductions. The
 * wings-reward discount is folded into `item_discount_total_cents` server-side,
 * so we never add generic item/order discount rows here (that would
 * double-count). All amounts come straight from the quote.
 */
export function promoDiscountRows(quote: CartQuoteResponse | null): PromoDiscountRow[] {
  if (!quote) return [];
  const rows: PromoDiscountRow[] = [];
  if (quote.wings_reward?.applied && (quote.wings_reward.discount_cents ?? 0) > 0) {
    rows.push({
      key: 'reward',
      label: 'Wings reward (1lb free)',
      amountCents: quote.wings_reward.discount_cents,
    });
  }
  if ((quote.promo_discount_cents ?? 0) > 0) {
    const code = quote.applied_promo_code?.trim();
    rows.push({
      key: 'promo',
      label: code ? `Promo code (${code})` : 'Promo code',
      amountCents: quote.promo_discount_cents ?? 0,
    });
  }
  return rows;
}
