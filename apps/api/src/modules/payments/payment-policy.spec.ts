import {
  capturedCents,
  isAlreadyFullyCaptured,
  netCollectedCents,
  onlinePaymentsEnabled,
  resolveCollectionPreference,
} from "./payment-policy";

describe("customer payment policy", () => {
  it("keeps online payments disabled unless the flag is explicitly true", () => {
    expect(onlinePaymentsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      onlinePaymentsEnabled({ ONLINE_PAYMENTS_ENABLED: "false" } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      onlinePaymentsEnabled({ ONLINE_PAYMENTS_ENABLED: "true" } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("accepts pay-at-store for pickup and driver collection choices for delivery", () => {
    expect(resolveCollectionPreference("PICKUP", "PAY_AT_STORE")).toEqual({
      ok: true,
      preference: "PAY_AT_STORE",
    });
    expect(resolveCollectionPreference("DELIVERY", "CASH_ON_DELIVERY")).toEqual({
      ok: true,
      preference: "CASH_ON_DELIVERY",
    });
    expect(resolveCollectionPreference("DELIVERY", "CARD_ON_DELIVERY")).toEqual({
      ok: true,
      preference: "CARD_ON_DELIVERY",
    });
    expect(resolveCollectionPreference("DELIVERY", null)).toEqual({
      ok: true,
      preference: null,
    });
  });

  it("rejects a collection choice that does not match the fulfillment type", () => {
    expect(resolveCollectionPreference("PICKUP", "CASH_ON_DELIVERY").ok).toBe(false);
    expect(resolveCollectionPreference("PICKUP", "CARD_ON_DELIVERY").ok).toBe(false);
    expect(resolveCollectionPreference("DELIVERY", "PAY_AT_STORE").ok).toBe(false);
    expect(resolveCollectionPreference("DELIVERY", "ONLINE_CARD").ok).toBe(false);
  });

  it("treats an order as fully captured only after collected funds cover the total", () => {
    const payments = [
      { transactionType: "AUTH", signedAmountCents: 2000 },
      { transactionType: "CAPTURE", signedAmountCents: 1500 },
    ];
    expect(capturedCents(payments)).toBe(1500);
    expect(isAlreadyFullyCaptured(1500, 2000)).toBe(false);
    expect(isAlreadyFullyCaptured(2000, 2000)).toBe(true);
    expect(isAlreadyFullyCaptured(0, 0)).toBe(false);
    expect(
      netCollectedCents([
        ...payments,
        { transactionType: "CAPTURE", signedAmountCents: 500 },
        { transactionType: "REFUND", signedAmountCents: -400 },
      ]),
    ).toBe(1600);
  });
});
