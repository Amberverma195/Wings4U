const { getBuilderPriceDelta, getCartItemSubtotal, calculateCartSubtotal, calculateDeliveryTipCents } = require('../src/lib/wing-builder-logic');
const payload = price => ({ builder_type: 'ITEM_CUSTOMIZATION', side_pop_bundle: { price_cents: price, side_label: 'Fries', pop_label: 'Pepsi' } });
test.each([499, 0, -999, 10000])('saved bundle price %i displays the established charge', price => {
  const item = { base_price_cents: 1000, quantity: 3, modifier_selections: [], builder_payload: payload(price) };
  expect(getBuilderPriceDelta(item.builder_payload)).toBe(499);
  expect(getCartItemSubtotal(item)).toBe(4497);
  expect(calculateCartSubtotal([JSON.parse(JSON.stringify(item))])).toBe(4497);
  expect(calculateDeliveryTipCents(calculateCartSubtotal([item]), 10, 'DELIVERY')).toBe(450);
});
