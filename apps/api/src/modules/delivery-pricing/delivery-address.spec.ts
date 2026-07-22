import {
  getAddressFingerprint,
  isPostalCodeAllowed,
  isValidCanadianPostalCode,
  normalizeAllowedPostalCodes,
  normalizeDeliveryAddress,
} from "./delivery-address";
import { calculateDeliveryFeeCents } from "./delivery-pricing.constants";

describe("delivery address and fee rules", () => {
  it("normalizes equivalent addresses to the same fingerprint", () => {
    const first = normalizeDeliveryAddress({
      line1: " 123   Example Street ",
      city: "LONDON",
      postal_code: " n5w   3c1 ",
    });
    const second = normalizeDeliveryAddress({
      line1: "123 Example Street",
      city: "London",
      postalCode: "N5W 3C1",
    });

    expect(first).toEqual({
      line1: "123 Example Street",
      city: "London",
      postalCode: "N5W 3C1",
    });
    expect(getAddressFingerprint(first)).toBe(getAddressFingerprint(second));
  });

  it.each([
    ["N5W 3C1", true],
    ["N5W3C1", true],
    ["D5W 3C1", false],
    ["N5W 3C", false],
    ["90210", false],
  ])("validates Canadian postal code %s", (postalCode, expected) => {
    expect(isValidCanadianPostalCode(postalCode)).toBe(expected);
  });

  it("matches three-character entries as FSA prefixes and six-character entries exactly", () => {
    expect(isPostalCodeAllowed("N5W 3C1", ["N5W"])).toBe(true);
    expect(isPostalCodeAllowed("N5W 3C1", ["N5W3C1"])).toBe(true);
    expect(isPostalCodeAllowed("N5W 3C2", ["N5W3C1"])).toBe(false);
    expect(isPostalCodeAllowed("N6A 1A1", ["N5W"])).toBe(false);
    expect(isPostalCodeAllowed("N6A 1A1", [])).toBe(true);
  });

  it("normalizes editable postal zones and supports legacy serialized arrays", () => {
    expect(
      normalizeAllowedPostalCodes([" n5w ", "N5W", "n6a1a1"]),
    ).toEqual(["N5W", "N6A 1A1"]);
    expect(isPostalCodeAllowed("N5W 3C1", JSON.stringify(["N5W"]))).toBe(
      true,
    );
    expect(() => normalizeAllowedPostalCodes(["London"])).toThrow(
      'Invalid Canadian postal zone "London"',
    );
  });

  it("requires London and a complete valid address", () => {
    expect(() =>
      normalizeDeliveryAddress({
        line1: "123 Example Street",
        city: "Toronto",
        postal_code: "M5V 1A1",
      }),
    ).toThrow("Delivery is only available within London");
    expect(() =>
      normalizeDeliveryAddress({
        line1: "",
        city: "London",
        postal_code: "N5W 3C1",
      }),
    ).toThrow("Address line 1 is required");
  });

  it.each([
    [5_000, 500],
    [5_001, 600],
    [6_000, 600],
    [6_001, 700],
    [20_000, 2_000],
    [20_001, null],
  ])("prices %i metres at %s cents", (distance, expected) => {
    expect(calculateDeliveryFeeCents(distance)).toBe(expected);
  });
});
