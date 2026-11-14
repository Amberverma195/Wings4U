import { calculateDeliveryFeeCents } from "./delivery-pricing.constants";

describe("calculateDeliveryFeeCents", () => {
  it.each(Array.from({ length: 11 }, (_, index) => 10_000 + index * 1_000))(
    "preserves the existing increment boundary at %i metres", metres => {
      const fee = 1300 + (metres - 10_000) / 10;
      expect(calculateDeliveryFeeCents(metres)).toBe(fee);
      if (metres > 10_000) expect(calculateDeliveryFeeCents(metres - 1)).toBe(fee - 100);
      if (metres < 20_000) expect(calculateDeliveryFeeCents(metres + 1)).toBe(fee);
    },
  );

  it.each([
    [0, 800],
    [4_950, 800],
    [4_950.01, 1_000],
    [4_951, 1_000],
    [4_999, 1_000],
    [5_000, 1_000],
    [7_900, 1_000],
    [7_999, 1_000],
    [8_000, 1_200],
    [9_900, 1_200],
    [9_999, 1_200],
    [10_000, 1_300],
    [10_999, 1_300],
    [11_000, 1_400],
    [14_000, 1_700],
    [14_999, 1_700],
    [15_000, 1_800],
    [19_999, 2_200],
    [20_000, 2_300],
    [20_001, null],
    [20_000.01, null],
  ])("prices %i metres at %s cents", (metres, expected) => {
    expect(calculateDeliveryFeeCents(metres)).toBe(expected);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid distance %s",
    (metres) => {
      expect(() => calculateDeliveryFeeCents(metres)).toThrow(
        "distanceMetres must be a non-negative finite number",
      );
    },
  );
});
