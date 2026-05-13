import { summarizeWingsInCart, type WingsCartLine } from "./rewards.service";

describe("summarizeWingsInCart", () => {
  function wingsLine(overrides: Partial<WingsCartLine>): WingsCartLine {
    return {
      quantity: 1,
      menuItemSlug: "wings-1lb",
      basePriceCents: 1299,
      unitPriceCents: 1299,
      lineTotalCents: 1299,
      builderPayload: {
        builder_type: "WINGS",
        weight_lb: 1,
      },
      ...overrides,
    };
  }

  it("counts individual 1lb wings and discounts only the base 1lb price", () => {
    const summary = summarizeWingsInCart([
      wingsLine({
        quantity: 2,
        basePriceCents: 1299,
        unitPriceCents: 1699,
        lineTotalCents: 3398,
      }),
    ]);

    expect(summary).toEqual({
      poundsInCart: 2,
      cheapestPerLbCents: 1299,
    });
  });

  it("does not count party packs or wing combos as redeemable 1lb wings", () => {
    const summary = summarizeWingsInCart([
      wingsLine({
        menuItemSlug: "party-75-wings",
        basePriceCents: 8999,
        unitPriceCents: 8999,
        lineTotalCents: 8999,
        builderPayload: {
          builder_type: "WINGS",
          weight_lb: 5,
        },
      }),
      wingsLine({
        menuItemSlug: "wing-combo-1lb",
        builderPayload: {
          builder_type: "WING_COMBO",
          weight_lb: 1,
        },
      }),
    ]);

    expect(summary).toEqual({
      poundsInCart: 0,
      cheapestPerLbCents: 0,
    });
  });
});
