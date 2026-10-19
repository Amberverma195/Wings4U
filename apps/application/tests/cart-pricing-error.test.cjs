const { cartPricingRecovery } = require('../src/lib/cart-pricing-error');
test.each([
  [undefined, {}, 'Network unavailable', 'retry'],
  [503, { field: 'scheduled_for' }, 'Service unavailable', 'retry'],
  [429, {}, 'Please wait', 'retry'],
  [422, { field: 'scheduled_for' }, 'The store is not open for pickup at the selected time.', 'time'],
  [undefined, {}, 'The store is not open for delivery at the selected time.', 'time'],
  [422, { field: 'scheduled_for' }, 'Scheduled time must be at least 20 minutes from now', 'time'],
  [422, { field: 'items' }, 'Unavailable item', 'items'],
  [422, { code: 'CART_ITEM_CONFIGURATION_INVALID', detail: { affected_item_indices: [0] } }, 'Invalid options', 'items'],
  [422, { field: 'promo_code' }, 'Invalid or expired promo code', 'coupon'],
  [422, { field: 'fulfillment_type' }, 'Minimum subtotal for delivery is $20.00', 'delivery'],
  [422, { field: 'address_snapshot_json' }, 'Invalid delivery address', 'delivery'],
  [422, { field: 'delivery_quote_token' }, 'Expired delivery quote', 'delivery'],
  [404, {}, 'Location settings not found', 'review'],
])('classifies status %s, field/code %j as %s', (status, row, message, expected) => {
  expect(cartPricingRecovery(Object.assign(new Error(message), { status, body: { errors: [{ ...row, message }] } }))).toBe(expected);
});
