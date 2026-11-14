jest.mock("../../database/order-number", () => ({ allocateNextOrderNumber: jest.fn().mockResolvedValue(1) }));
import { PosService } from "../pos/pos.service";
import { DeliveryQuoteTokenService } from "./delivery-quote-token.service";
import { DeliveryQuoteVerifierService } from "./delivery-quote-verifier.service";
import { getAddressFingerprint, normalizeDeliveryAddress } from "./delivery-address";
import { calculateDeliveryFeeCents, DELIVERY_PRICING_RULE_VERSION } from "./delivery-pricing.constants";

const address = { line1: "123 Example Street", city: "London", postal_code: "N6K 1A1" };
const stop = new Error("STOP_BEFORE_ORDER_WRITE");

function fixture(metres: number, freeThreshold: number | null = null, taxDelivery = false) {
  const tokens = new DeliveryQuoteTokenService();
  const fee = calculateDeliveryFeeCents(metres);
  if (fee == null) throw new Error("No eligible quote can be issued for this distance");
  const token = tokens.signDistanceQuote({ version: DELIVERY_PRICING_RULE_VERSION,
    location_id: "location", address_fingerprint: getAddressFingerprint(normalizeDeliveryAddress(address)),
    delivery_fee_cents: fee, within_delivery_radius: true, issued_at: Date.now(), expires_at: Date.now() + 60000 });
  const db = { $transaction: jest.fn(),
    userIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
    location: { findUnique: jest.fn().mockResolvedValue({ isActive: true, timezoneName: "America/Toronto",
      settings: { taxRateBps: 1300, taxDeliveryFee: taxDelivery, freeDeliveryThresholdCents: freeThreshold,
        deliveryDisabled: false, deliveryAvailableFromMinutes: null, deliveryAvailableUntilMinutes: null } }) },
    order: { create: jest.fn().mockRejectedValue(stop) },
  };
  db.$transaction.mockImplementation(fn => fn(db));
  const service = new PosService(db as never, {} as never, new DeliveryQuoteVerifierService(tokens));
  const params = { actorUserId: null, locationId: "location", fulfillmentType: "DELIVERY", orderSource: "PHONE" as const,
    customerPhone: "5195550123", paymentMethod: "CASH", items: [{ name: "Open Food", unitPriceCents: 10000, quantity: 1 }],
    addressSnapshotJson: address, deliveryQuoteToken: token };
  return { db, service, params };
}

describe("verified POS/phone delivery", () => {
  it.each([2000, 4000, 8000, 20000, 50000].flatMap(subtotal =>
    [0, 4951, 8000, 10000, 20000].map(metres => ({ subtotal, metres }))))(
    "charges verified distance at $subtotal cents and $metres metres despite a legacy threshold", async ({ subtotal, metres }) => {
      const { db, service, params } = fixture(metres, 4000, true);
      params.items[0].unitPriceCents = subtotal;
      const fee = calculateDeliveryFeeCents(metres)!;
      const tax = Math.round((subtotal + fee) * .13);
      await expect(service.createPosOrder(params)).rejects.toBe(stop);
      expect(db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
        deliveryFeeCents: fee, taxCents: tax, finalPayableCents: subtotal + fee + tax,
        pricingSnapshotJson: expect.objectContaining({ delivery_fee_cents: fee, delivery_fee_waived: false,
          final_payable_cents: subtotal + fee + tax }),
      }) }));
    },
  );
  it.each([[14000, 1700], [20000, 2300]])("retains legitimate phone delivery at %i metres for %i cents", async (metres, fee) => {
    const { db, service, params } = fixture(metres);
    await expect(service.createPosOrder(params)).rejects.toBe(stop);
    expect(db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      deliveryFeeCents: fee, finalPayableCents: 11300 + fee,
      addressSnapshotJson: address, fulfillmentType: "DELIVERY",
    }) }));
  });

  it("ignores legacy waiver settings and keeps configured delivery taxation", async () => {
    const paid = fixture(14000, null, true);
    await expect(paid.service.createPosOrder(paid.params)).rejects.toBe(stop);
    expect(paid.db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      deliveryFeeCents: 1700, taxCents: 1521, finalPayableCents: 13221,
    }) }));
    const free = fixture(14000, 0, true);
    await expect(free.service.createPosOrder(free.params)).rejects.toBe(stop);
    expect(free.db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      deliveryFeeCents: 1700, taxCents: 1521, finalPayableCents: 13221,
    }) }));
  });

  it.each(["missing", "forged", "changed-address"])("rejects %s evidence even with free delivery", async kind => {
    const { db, service, params } = fixture(14000, 0);
    if (kind === "missing") params.deliveryQuoteToken = "";
    if (kind === "forged") params.deliveryQuoteToken = "forged.token";
    if (kind === "changed-address") params.addressSnapshotJson = { ...address, line1: "A different address" };
    await expect(service.createPosOrder(params)).rejects.toMatchObject({ status: 422 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each([true, false])("persists the configured discount tax policy (%s) and delivery tax flag", async reduce => {
    const { db, service, params } = fixture(14000, null, true);
    const location = await db.location.findUnique();
    Object.assign(location.settings, { discountsReduceTaxableBase: reduce, taxTip: false });
    await expect(service.createPosOrder({ ...params, discountAmountCents: 1000 })).rejects.toBe(stop);
    expect(db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      deliveryFeeCents: 1700, taxDeliveryFeeApplied: true, taxTipApplied: false,
      taxableSubtotalCents: reduce ? 10700 : 11700,
      taxCents: reduce ? 1391 : 1521, finalPayableCents: reduce ? 12091 : 12221,
      pricingSnapshotJson: expect.objectContaining({ delivery_fee_cents: 1700,
        final_payable_cents: reduce ? 12091 : 12221 }),
    }) }));
  });
});
