import { CartService } from "../cart/cart.service";
import { CheckoutService } from "../checkout/checkout.service";
import { PosService } from "../pos/pos.service";
import { DeliveryQuoteTokenService } from "./delivery-quote-token.service";
import { DeliveryQuoteVerifierService } from "./delivery-quote-verifier.service";

const address = { line1: "123 Example Street", city: "London", postal_code: "N6K 1A1" };

describe("delivery enforcement in cart and checkout", () => {
  const originalEnabled = process.env.DELIVERY_DISTANCE_PRICING_ENABLED;
  afterAll(() => { process.env.DELIVERY_DISTANCE_PRICING_ENABLED = originalEnabled; });

  it("cannot create delivery through the legacy POS/phone endpoint without route verification", async () => {
    const prisma = { $transaction: jest.fn() };
    const pos = new PosService(prisma as never, {} as never);
    await expect(pos.createPosOrder({ actorUserId: null, locationId: "location",
      fulfillmentType: "DELIVERY", orderSource: "PHONE", items: [], paymentMethod: "CASH" }))
      .rejects.toMatchObject({ response: { code: "DELIVERY_QUOTE_REQUIRED" } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["true", undefined], ["false", undefined],
    ["true", "forged.payload"], ["false", "forged.payload"],
  ])("rejects an exact cart and new checkout with pricing=%s token=%s", async (enabled, token) => {
    process.env.DELIVERY_DISTANCE_PRICING_ENABLED = enabled;
    const verifier = new DeliveryQuoteVerifierService(new DeliveryQuoteTokenService());
    const cart = new CartService({} as never, {} as never, {} as never, verifier);
    jest.spyOn(cart, "validateItems").mockResolvedValue({ settings: {},
      menuItemMap: new Map(), lineDetails: [], itemSubtotalCents: 0 } as never);
    await expect(cart.computeQuote("location", "DELIVERY", [], undefined, 0, 0,
      undefined, "user", false, token, address, true)).rejects.toMatchObject({ status: 422 });

    const prisma = {
      checkoutIdempotencyKey: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    const checkout = new CheckoutService(prisma as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, verifier, { enforce: jest.fn() } as never);
    await expect(checkout.placeOrder({ userId: "user", locationId: "location",
      fulfillmentType: "DELIVERY", items: [], idempotencyKey: "fresh-key",
      addressSnapshotJson: address, deliveryQuoteToken: token })).rejects.toMatchObject({ status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
