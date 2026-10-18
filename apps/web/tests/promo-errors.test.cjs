const { isPromoRejectedQuoteError } = require('../src/lib/promo-errors');

test('Party coupon rejection is actionable without treating stock or connectivity errors as coupon failures', () => {
  expect(isPromoRejectedQuoteError('No eligible items for this promo. Party Specials are excluded from coupons.')).toBe(true);
  expect(isPromoRejectedQuoteError('Minimum order of $25.00 required for this promo')).toBe(true);
  expect(isPromoRejectedQuoteError('This item is currently out of stock. Please remove it or choose another item.')).toBe(false);
  expect(isPromoRejectedQuoteError('Network request failed')).toBe(false);
});
