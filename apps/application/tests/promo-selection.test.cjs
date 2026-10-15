const {
  EMPTY_PROMO_SELECTION,
  promoReducer,
  quotePromoParams,
  isPromoRejectedQuoteError,
  wingsRewardBlockedReason,
  promoDiscountRows,
} = require('../src/lib/promo-selection');

test('a coupon and the wings reward can never be applied together', () => {
  const withPromo = promoReducer(EMPTY_PROMO_SELECTION, { type: 'applyPromo', code: 'WINGS5' });
  expect(withPromo).toEqual({ promoCode: 'WINGS5', applyWingsReward: false });

  // Selecting the reward clears a previously applied coupon.
  const switchedToReward = promoReducer(withPromo, { type: 'applyWingsReward' });
  expect(switchedToReward).toEqual({ promoCode: null, applyWingsReward: true });

  // Selecting a coupon clears a previously selected reward.
  const switchedToPromo = promoReducer(switchedToReward, { type: 'applyPromo', code: 'SAVE10' });
  expect(switchedToPromo).toEqual({ promoCode: 'SAVE10', applyWingsReward: false });

  // Blank / whitespace codes are ignored.
  expect(promoReducer(EMPTY_PROMO_SELECTION, { type: 'applyPromo', code: '   ' })).toBe(
    EMPTY_PROMO_SELECTION,
  );

  // Clears are scoped and clearAll resets everything.
  expect(promoReducer(withPromo, { type: 'clearPromo' })).toEqual({
    promoCode: null,
    applyWingsReward: false,
  });
  expect(promoReducer(switchedToReward, { type: 'clearWingsReward' })).toEqual({
    promoCode: null,
    applyWingsReward: false,
  });
  expect(promoReducer(switchedToPromo, { type: 'clearAll' })).toEqual(EMPTY_PROMO_SELECTION);
});

test('quote params mirror the website non-stacking rule (promo code wins)', () => {
  expect(quotePromoParams({ promoCode: 'WINGS5', applyWingsReward: false })).toEqual({
    promo_code: 'WINGS5',
  });
  expect(quotePromoParams({ promoCode: null, applyWingsReward: true })).toEqual({
    apply_wings_reward: true,
  });
  // Defensive: even if both are somehow set, the promo code wins and the
  // reward is never sent alongside it.
  expect(quotePromoParams({ promoCode: 'WINGS5', applyWingsReward: true })).toEqual({
    promo_code: 'WINGS5',
  });
  expect(quotePromoParams({ promoCode: null, applyWingsReward: false })).toEqual({});
});

test('server rejection messages for invalid/expired/conflicting promos are recognized', () => {
  expect(isPromoRejectedQuoteError('Invalid or expired promo code')).toBe(true);
  expect(isPromoRejectedQuoteError('Only one deal can be applied at a time')).toBe(true);
  expect(isPromoRejectedQuoteError('This promo code is only valid for delivery orders')).toBe(true);
  expect(isPromoRejectedQuoteError('Minimum order of $20.00 required for this promo')).toBe(true);
  expect(isPromoRejectedQuoteError('Cart does not meet requirements for this buy x get y promo')).toBe(
    true,
  );
  // Unrelated failures must NOT be treated as promo rejections.
  expect(isPromoRejectedQuoteError('Network request failed')).toBe(false);
  expect(isPromoRejectedQuoteError('')).toBe(false);
  expect(isPromoRejectedQuoteError(null)).toBe(false);
});

test('wings reward blocked reason surfaces the server not-eligible code', () => {
  expect(wingsRewardBlockedReason(false, null)).toBeNull();
  const applied = { wings_reward: { applied: true, discount_cents: 400, not_eligible_reason: null } };
  expect(wingsRewardBlockedReason(true, applied)).toBeNull();
  expect(
    wingsRewardBlockedReason(true, {
      wings_reward: { applied: false, discount_cents: 0, not_eligible_reason: 'NO_WINGS_IN_CART' },
    }),
  ).toMatch(/1lb of individual wings/i);
  expect(
    wingsRewardBlockedReason(true, {
      wings_reward: { applied: false, discount_cents: 0, not_eligible_reason: 'NOT_ENOUGH_STAMPS' },
    }),
  ).toMatch(/enough stamps/i);
  expect(
    wingsRewardBlockedReason(true, {
      wings_reward: { applied: false, discount_cents: 0, not_eligible_reason: 'NOT_SIGNED_IN' },
    }),
  ).toMatch(/sign in/i);
});

test('discount rows reflect only server values and never double-count', () => {
  // The wings-reward discount is folded into item_discount_total_cents, so we
  // must surface the semantic reward/promo rows only, not the generic totals.
  const quote = {
    item_subtotal_cents: 2000,
    item_discount_total_cents: 400,
    order_discount_total_cents: 300,
    applied_promo_code: 'SAVE3',
    promo_discount_cents: 300,
    wings_reward: { applied: true, discount_cents: 400, not_eligible_reason: null },
  };
  expect(promoDiscountRows(quote)).toEqual([
    { key: 'reward', label: 'Wings reward (1lb free)', amountCents: 400 },
    { key: 'promo', label: 'Promo code (SAVE3)', amountCents: 300 },
  ]);

  expect(
    promoDiscountRows({
      item_discount_total_cents: 0,
      order_discount_total_cents: 0,
      promo_discount_cents: 0,
      wings_reward: { applied: false, discount_cents: 0, not_eligible_reason: null },
    }),
  ).toEqual([]);
  expect(promoDiscountRows(null)).toEqual([]);
});
