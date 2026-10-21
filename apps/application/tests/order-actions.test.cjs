const { canCancelOrder, storeTelephoneUri } = require('../src/lib/order-actions');
const now = Date.parse('2026-10-20T15:00:00Z');
const deadline = new Date(now + 120_000).toISOString();

test.each(['PLACED', 'ACCEPTED'])('%s can cancel only before the server deadline', status => {
  expect(canCancelOrder({ status, cancel_allowed_until: deadline }, now)).toBe(true);
  expect(canCancelOrder({ status, cancel_allowed_until: deadline }, now + 120_000)).toBe(false);
  expect(canCancelOrder({ status, cancel_allowed_until: deadline }, now + 120_001)).toBe(false);
});
test.each(['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'PICKED_UP', 'DELIVERED', 'CANCELLED', 'NO_SHOW_PICKUP', 'NO_SHOW_DELIVERY', 'NO_PIN_DELIVERY'])(
  '%s cannot self-cancel even before the deadline', status => expect(canCancelOrder({ status, cancel_allowed_until: deadline }, now)).toBe(false));
test.each([null, '', 'invalid'])('missing or invalid deadline %s never creates a new window', cancel_allowed_until => {
  expect(canCancelOrder({ status: 'PLACED', cancel_allowed_until }, now)).toBe(false);
});
test.each([
  ['+1 (519) 555-1234', 'tel:+15195551234'], ['519-555-1234', 'tel:5195551234'],
  [null, null], ['', null], ['Unavailable', null], ['123', null],
])('sanitizes the actual store phone %s', (phone, expected) => expect(storeTelephoneUri(phone)).toBe(expected));
