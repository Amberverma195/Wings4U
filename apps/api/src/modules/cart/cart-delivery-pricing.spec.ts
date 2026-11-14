import { CartService } from "./cart.service";

describe("cart delivery waivers", () => {
  it.each([
    ["DELIVERY", null, false, 1000],
    ["DELIVERY", 4000, false, 1000],
    ["DELIVERY", 6745, false, 1000],
    ["DELIVERY", 6746, false, 1000],
    ["DELIVERY", null, true, 1000],
    ["PICKUP", null, false, 0],
  ] as const)("%s threshold=%s promotion waiver=%s charges %i", async (fulfillment, threshold, promoWaiver, fee) => {
    const promos = {
      isFirstOrderDealPublicCode: jest.fn().mockResolvedValue(false),
      evaluatePromo: jest.fn().mockResolvedValue({ promoCode: "TEST", discountCents: 0,
        waivesDelivery: promoWaiver }),
      evaluateFirstOrderDeal: jest.fn().mockResolvedValue(null),
    };
    const verifier = { verifyForDelivery: jest.fn().mockReturnValue({ delivery_fee_cents: 1000 }) };
    const service = new CartService({} as never,
      { computeEligibility: jest.fn().mockResolvedValue({ eligible: false, poundsInCart: 0, availableStamps: 0 }) } as never,
      promos as never, verifier as never);
    jest.spyOn(service, "validateItems").mockResolvedValue({
      settings: { freeDeliveryThresholdCents: threshold, minimumDeliverySubtotalCents: 0,
        prepaymentThresholdNoShows: 3, taxRateBps: 1300, taxDeliveryFee: true,
        taxTip: false, discountsReduceTaxableBase: true },
      itemSubtotalCents: 6745, lineDetails: [], menuItemMap: new Map(),
    } as never);
    const result = await service.computeQuote("location", fulfillment, [],
      promoWaiver ? "TEST" : undefined, 500, 200, undefined, undefined, false,
      "signed-quote", {}, true);
    expect(result.delivery_fee_cents).toBe(fee);
    expect(result.delivery_fee_waived).toBe(false);
    expect(result.final_payable_cents).toBe(6745 + fee + 500 + Math.round((6745 + fee) * .13) - 200);
    expect(verifier.verifyForDelivery).toHaveBeenCalledTimes(fulfillment === "DELIVERY" ? 1 : 0);
  });
});
