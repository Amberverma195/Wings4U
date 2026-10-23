const { TERMINAL_STATUSES, ACTIVE_STATUSES } = require('../src/lib/types');
const { orderStatusCustomerLabel } = require('../src/lib/format');

test.each([
  ['PICKED_UP', 'Picked up'], ['DELIVERED', 'Delivered'],
  ['NO_SHOW_PICKUP', 'No-show (not picked up)'], ['NO_SHOW_DELIVERY', 'Delivery not completed'],
  ['NO_PIN_DELIVERY', 'Delivery completed without PIN'], ['CANCELLED', 'Order cancelled'],
])('%s stays in past orders with truthful final wording (%s)', (status, label) => {
  expect(TERMINAL_STATUSES.has(status)).toBe(true);
  expect(ACTIVE_STATUSES.has(status)).toBe(false);
  expect(orderStatusCustomerLabel(status, 'PICKUP')).toBe(label);
  expect(orderStatusCustomerLabel(status, 'DELIVERY')).toBe(label);
});
test('website and mobile share the same complete terminal classification', () => {
  const mobile = require('../../application/src/lib/types');
  expect([...mobile.TERMINAL_STATUSES].sort()).toEqual([...TERMINAL_STATUSES].sort());
  expect([...mobile.ACTIVE_STATUSES].sort()).toEqual([...ACTIVE_STATUSES].sort());
});
