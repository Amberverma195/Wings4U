const web = require('../src/lib/cart-item-utils');
const mobile = require('../../application/src/lib/wing-builder-logic');

describe.each([['website', web], ['mobile', mobile]])('%s boneless pricing', (_name, pricing) => {
  test.each(['WINGS', 'WING_COMBO'])('%s charges a flat surcharge once per item', builder_type => {
    expect(pricing.BONELESS_WINGS_UPCHARGE_CENTS).toBe(150);
    expect(pricing.EXTRA_FLAVOUR_PRICE_CENTS).toBe(100);
    for (const weight_lb of [0.33, 1, 1.5, 8, 11]) {
      for (const wing_type of ['BONE_IN', 'BONELESS']) {
        for (const extra of [false, true]) {
          const payload = { builder_type, wing_type, weight_lb,
            ...(extra ? { extra_flavour: { wing_flavour_id: 'hot', placement: 'ON_SIDE' } } : {}) };
          const delta = (wing_type === 'BONELESS' ? 150 : 0) + (extra ? 100 : 0);
          const item = { base_price_cents: 1000, quantity: 2, builder_payload: payload,
            modifier_selections: [{ modifier_option_id: 'boneless', price_delta_cents: 0 },
              { modifier_option_id: 'dip', price_delta_cents: 150 }] };
          expect(pricing.getBuilderPriceDelta(payload)).toBe(delta);
          expect(pricing.getCartItemUnitPrice(JSON.parse(JSON.stringify(item))) * item.quantity).toBe((1150 + delta) * 2);
        }
      }
    }
  });
});
