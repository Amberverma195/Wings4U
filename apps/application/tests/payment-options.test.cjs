const {
  checkoutPricingBlock,
  customerPaymentOptions,
  defaultCollectionPreference,
} = require('../src/lib/payment-options');

test('pickup offers pay at store and delivery offers driver collection only', () => {
  expect(customerPaymentOptions('PICKUP').map((option) => option.value)).toEqual(['PAY_AT_STORE']);
  expect(customerPaymentOptions('DELIVERY').map((option) => option.value)).toEqual([
    'CASH_ON_DELIVERY',
    'CARD_ON_DELIVERY',
  ]);
  expect(defaultCollectionPreference('PICKUP')).toBe('PAY_AT_STORE');
  expect(defaultCollectionPreference('DELIVERY')).toBe('CASH_ON_DELIVERY');
  expect(customerPaymentOptions('PICKUP').concat(customerPaymentOptions('DELIVERY')).map((option) => option.value)).not.toContain('ONLINE_CARD');
});

test('checkout stays blocked until the server quote confirms the selected promotion', () => {
  const quote = {
    applied_promo_code: 'WINGS5',
    wings_reward: { applied: true, discount_cents: 400, not_eligible_reason: null },
  };
  expect(checkoutPricingBlock({
    quoteLoading: true,
    quote,
    quoteError: null,
    promoCode: null,
    rewardBlockedReason: null,
  })).toMatch(/confirmed/i);
  expect(checkoutPricingBlock({
    quoteLoading: false,
    quote: null,
    quoteError: null,
    promoCode: null,
    rewardBlockedReason: null,
  })).toMatch(/confirmed/i);
  expect(checkoutPricingBlock({
    quoteLoading: false,
    quote,
    quoteError: 'Unable to quote order',
    promoCode: null,
    rewardBlockedReason: null,
  })).toBe('Unable to quote order');
  expect(checkoutPricingBlock({
    quoteLoading: false,
    quote: { ...quote, applied_promo_code: null },
    quoteError: null,
    promoCode: 'EXPIRED',
    rewardBlockedReason: null,
  })).toMatch(/not applied/i);
  expect(checkoutPricingBlock({
    quoteLoading: false,
    quote,
    quoteError: null,
    promoCode: 'WINGS5',
    rewardBlockedReason: 'You no longer have enough stamps to redeem this reward.',
  })).toMatch(/stamps/i);
  expect(checkoutPricingBlock({
    quoteLoading: false,
    quote,
    quoteError: null,
    promoCode: 'wings5',
    rewardBlockedReason: null,
  })).toBeNull();
});
