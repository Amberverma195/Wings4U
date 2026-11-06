const web = require('../src/lib/cart-item-utils');
const mobile = require('../../application/src/lib/wing-builder-logic');

describe.each([['website', web], ['mobile', mobile]])('%s boneless pricing', (_name, pricing) => {
  test('constants', () => {
    expect(pricing.BONELESS_WINGS_UPCHARGE_CENTS).toBe(150);
    expect(pricing.EXTRA_FLAVOUR_PRICE_CENTS).toBe(100);
  });

  test.each(['WINGS', 'WING_COMBO'])('%s calculates weight-based boneless surcharge (150 cents * weight_lb)', builder_type => {
    const regularWeights = [
      { weight_lb: 1, expectedBoneless: 150 },
      { weight_lb: 1.5, expectedBoneless: 225 },
      { weight_lb: 2, expectedBoneless: 300 },
      { weight_lb: 2.5, expectedBoneless: 375 },
      { weight_lb: 3, expectedBoneless: 450 },
      { weight_lb: 4, expectedBoneless: 600 },
      { weight_lb: 5, expectedBoneless: 750 },
    ];

    for (const { weight_lb, expectedBoneless } of regularWeights) {
      for (const wing_type of ['BONE_IN', 'BONELESS']) {
        for (const extra of [false, true]) {
          const payload = {
            builder_type,
            wing_type,
            weight_lb,
            ...(extra ? { extra_flavour: { wing_flavour_id: 'hot', placement: 'ON_SIDE' } } : {}),
          };
          const bonelessDelta = wing_type === 'BONELESS' ? expectedBoneless : 0;
          const extraDelta = extra ? 100 : 0;
          const expectedDelta = bonelessDelta + extraDelta;

          expect(pricing.getBuilderPriceDelta(payload)).toBe(expectedDelta);

          // Test cart item unit price and quantity multiplication
          for (const quantity of [1, 2, 3]) {
            const item = {
              base_price_cents: 1000,
              quantity,
              builder_payload: payload,
              modifier_selections: [
                { modifier_option_id: 'boneless', price_delta_cents: 0 },
                { modifier_option_id: 'dip', price_delta_cents: 150 },
              ],
            };
            const unitPrice = pricing.getCartItemUnitPrice(JSON.parse(JSON.stringify(item)));
            expect(unitPrice).toBe(1000 + 150 + expectedDelta);
            expect(unitPrice * quantity).toBe((1150 + expectedDelta) * quantity);
          }
        }
      }
    }
  });

  test('special products apply exact approved boneless surcharges and quantity 2', () => {
    const specialCases = [
      { slug: 'lunch-5-wings', basePrice: 999, weightLb: 0.33, expectedSurcharge: 150, label: '+$1.50' },
      { slug: 'party-75-wings', basePrice: 8999, weightLb: 8, expectedSurcharge: 1200, label: '+$12.00' },
      { slug: 'party-100-wings', basePrice: 11699, weightLb: 11, expectedSurcharge: 1650, label: '+$16.50' },
      { slug: 'wings-4u-special', basePrice: 2499, weightLb: 2, expectedSurcharge: 300, label: '+$3.00' },
    ];

    for (const { slug, basePrice, weightLb, expectedSurcharge, label } of specialCases) {
      // 1. Direct calculateBonelessSurchargeCents call
      expect(pricing.calculateBonelessSurchargeCents(weightLb, slug)).toBe(expectedSurcharge);

      // Client tampering: client passes manipulated weight_lb (e.g. 0.1 or 999), slug overrides
      expect(pricing.calculateBonelessSurchargeCents(0.1, slug)).toBe(expectedSurcharge);
      expect(pricing.calculateBonelessSurchargeCents(999, slug)).toBe(expectedSurcharge);

      // 2. Boneless payload
      const bonelessPayload = {
        builder_type: 'WINGS',
        wing_type: 'BONELESS',
        weight_lb: weightLb,
        menu_item_slug: slug,
      };
      expect(pricing.getBuilderPriceDelta(bonelessPayload, slug)).toBe(expectedSurcharge);

      // 3. Bone-in alternative has exactly 0 boneless surcharge
      const boneInPayload = {
        builder_type: 'WINGS',
        wing_type: 'BONE_IN',
        weight_lb: weightLb,
        menu_item_slug: slug,
      };
      expect(pricing.getBuilderPriceDelta(boneInPayload, slug)).toBe(0);

      // 4. Cart item unit price and quantity 2
      const bonelessItem = {
        base_price_cents: basePrice,
        quantity: 2,
        menu_item_slug: slug,
        builder_payload: bonelessPayload,
        modifier_selections: [],
      };
      const unitPrice = pricing.getCartItemUnitPrice(bonelessItem);
      expect(unitPrice).toBe(basePrice + expectedSurcharge);
      expect(unitPrice * bonelessItem.quantity).toBe((basePrice + expectedSurcharge) * 2);

      const boneInItem = {
        base_price_cents: basePrice,
        quantity: 2,
        menu_item_slug: slug,
        builder_payload: boneInPayload,
        modifier_selections: [],
      };
      const boneInUnit = pricing.getCartItemUnitPrice(boneInItem);
      expect(boneInUnit).toBe(basePrice);
      expect(boneInUnit * boneInItem.quantity).toBe(basePrice * 2);

      // 5. Preparation options price note parity (if available in module)
      if (typeof pricing.getWingPreparationOptions === 'function') {
        const options = pricing.getWingPreparationOptions(weightLb, slug);
        const bonelessOpt = options.find(o => o.id === 'BREADED_BONELESS');
        expect(bonelessOpt.priceNote).toBe(label);
      }
    }
  });
});
