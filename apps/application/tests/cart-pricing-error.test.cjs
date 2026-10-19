const { cartPricingRecovery } = require('../src/lib/cart-pricing-error');
test.each([
  [undefined, {}, 'Network unavailable', 'retry'],
  [503, { field: 'scheduled_for' }, 'Service unavailable', 'retry'],
  [429, {}, 'Please wait', 'retry'],
  [401, {}, 'Authentication failed', 'sign_in'],
  [401, { field: 'fulfillment_type' }, 'Minimum subtotal for delivery is $20.00', 'sign_in'],
  [422, { code: 'UNAUTHENTICATED' }, 'Request failed', 'sign_in'],
  [422, { code: 'SESSION_EXPIRED' }, 'Request failed', 'sign_in'],
  [undefined, {}, 'Unauthorized', 'sign_in'],
  [undefined, {}, 'Your session has expired', 'sign_in'],
  [undefined, {}, 'Sign in required', 'sign_in'],
  [422, { field: 'scheduled_for' }, 'The store is not open for pickup at the selected time.', 'time'],
  [undefined, {}, 'The store is not open for delivery at the selected time.', 'time'],
  [422, { field: 'scheduled_for' }, 'Scheduled time must be at least 20 minutes from now', 'time'],
  [422, { field: 'items' }, 'Unavailable item', 'items'],
  [422, { code: 'CART_ITEM_CONFIGURATION_INVALID', detail: { affected_item_indices: [0] } }, 'Invalid options', 'items'],
  [422, { field: 'promo_code' }, 'Invalid or expired promo code', 'coupon'],
  [422, { field: 'fulfillment_type' }, 'Minimum subtotal for delivery is $20.00', 'add_items'],
  [422, { code: 'DELIVERY_MINIMUM_NOT_MET' }, 'Request failed', 'add_items'],
  [422, { code: 'INSUFFICIENT_SUBTOTAL' }, 'Request failed', 'add_items'],
  [undefined, {}, 'Insufficient subtotal for delivery', 'add_items'],
  [undefined, {}, 'Delivery minimum is $20.00', 'add_items'],
  [422, { field: 'address_snapshot_json' }, 'Invalid delivery address', 'delivery'],
  [422, { field: 'delivery_quote_token' }, 'Expired delivery quote', 'delivery'],
  [404, {}, 'Location settings not found', 'review'],
])('classifies status %s, field/code %j as %s', (status, row, message, expected) => {
  expect(cartPricingRecovery(Object.assign(new Error(message), { status, body: { errors: [{ ...row, message }] } }))).toBe(expected);
});
