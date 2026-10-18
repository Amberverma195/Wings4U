const { getBuilderPriceDelta, getCartItemUnitPrice, sidePopComboDisplayLines } = require('../src/lib/cart-item-utils');
test.each([499, 0, -999, 10000])('saved bundle %i is displayed and charged locally at 499 cents', price => {
  const bundle = { price_cents: price, side_label: 'Wedges', pop_label: 'Pepsi' };
  const item = { base_price_cents: 1000, quantity: 3, modifier_selections: [], builder_payload: { builder_type: 'ITEM_CUSTOMIZATION', side_pop_bundle: bundle } };
  expect(getBuilderPriceDelta(item.builder_payload)).toBe(499);
  expect(getCartItemUnitPrice(item)).toBe(1499);
  expect(getCartItemUnitPrice(JSON.parse(JSON.stringify(item))) * item.quantity).toBe(4497);
  expect(sidePopComboDisplayLines(bundle)[0]).toContain('$4.99');
});
