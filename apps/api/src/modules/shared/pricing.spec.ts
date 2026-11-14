import { computePricing } from "./pricing";

const policy = { taxRateBps: 1300, taxDeliveryFee: true, taxTip: false,
  discountsReduceTaxableBase: true };
const input = { itemSubtotalCents: 6745, itemDiscountTotalCents: 1299,
  orderDiscountTotalCents: 0, deliveryFeeCents: 0, driverTipCents: 0, walletAppliedCents: 0 };

describe("delivery totals", () => {
  it("reproduces #1077's stored waived-fee snapshot", () => {
    expect(computePricing(input, policy)).toMatchObject({ discountedSubtotalCents: 5446,
      taxableSubtotalCents: 5446, taxCents: 708, deliveryFeeCents: 0, finalPayableCents: 6154 });
  });

  it.each([true, false])("taxes paid delivery exactly once when taxDeliveryFee=%s", taxDeliveryFee => {
    const result = computePricing({ ...input, deliveryFeeCents: 1000,
      driverTipCents: 500, walletAppliedCents: 200 }, { ...policy, taxDeliveryFee });
    expect(result.taxCents).toBe(taxDeliveryFee ? 838 : 708);
    expect(result.finalPayableCents).toBe(taxDeliveryFee ? 7584 : 7454);
  });

  it("honors separate tip and discount tax policies", () => {
    expect(computePricing({ ...input, deliveryFeeCents: 1000, driverTipCents: 500 },
      { ...policy, taxTip: true, discountsReduceTaxableBase: false }))
      .toMatchObject({ taxableSubtotalCents: 8245, taxCents: 1072, finalPayableCents: 8018 });
  });
});
