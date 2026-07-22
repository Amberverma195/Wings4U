import {
  buildCheckoutCartHash,
  buildCheckoutRequestFingerprint,
} from "./checkout-cart-hash";
import { StripePaymentsService } from "./stripe-payments.service";

const CART = {
  location_id: "11111111-1111-4111-8111-111111111111",
  fulfillment_type: "DELIVERY" as const,
  items: [{ menu_item_id: "item-1", quantity: 1 }],
  delivery_quote_token: "quote-token",
  address_snapshot_json: {
    line1: "123 Example Street",
    city: "London",
    postal_code: "N5W 3C1",
  },
};

const REQUEST = {
  location_id: CART.location_id,
  fulfillment_type: CART.fulfillment_type,
  items: CART.items,
  address_snapshot_json: CART.address_snapshot_json,
  payment_method: "ONLINE_CARD" as const,
  customer_order_notes: "no onions",
  stripe_payment_intent_id: "pi_123",
};

describe("Stripe checkout cart hash", () => {
  const originalSecret = process.env.STRIPE_SECRET_KEY;
  const originalPublishable = process.env.STRIPE_PUBLISHABLE_KEY;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_real";
  });

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = originalSecret;
    process.env.STRIPE_PUBLISHABLE_KEY = originalPublishable;
  });

  it("is stable across key order and binds the stated fee, not token expiry", () => {
    const first = buildCheckoutCartHash(CART);
    const reordered = buildCheckoutCartHash({
      ...CART,
      address_snapshot_json: {
        postal_code: "N5W 3C1",
        city: "London",
        line1: "123 Example Street",
      },
    });

    expect(reordered).toBe(first);
    expect(
      buildCheckoutCartHash({ ...CART, delivery_quote_token: "other-token" }),
    ).toBe(first);
    expect(
      buildCheckoutCartHash({ ...CART, delivery_fee_stated_cents: 700 }),
    ).not.toBe(first);
  });

  it("fingerprints meaningful checkout fields without the quote token", () => {
    const first = buildCheckoutRequestFingerprint(REQUEST);
    expect(buildCheckoutRequestFingerprint({ ...REQUEST })).toBe(first);
    expect(
      buildCheckoutRequestFingerprint({
        ...REQUEST,
        customer_order_notes: "extra ranch",
      }),
    ).not.toBe(first);
    expect(
      buildCheckoutRequestFingerprint({
        ...REQUEST,
        payment_method: "PAY_AT_STORE",
      }),
    ).not.toBe(first);
    expect(
      buildCheckoutRequestFingerprint({
        ...REQUEST,
        items: [{ menu_item_id: "item-2", quantity: 1 }],
      }),
    ).not.toBe(first);
  });

  it("rejects a succeeded intent created for another cart", async () => {
    const service = new StripePaymentsService({} as never);
    (service as unknown as { stripeClient: unknown }).stripeClient = {
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          id: "pi_123",
          status: "succeeded",
          currency: "cad",
          amount: 2500,
          amount_received: 2500,
          payment_method: "pm_123",
          latest_charge: "ch_123",
          metadata: {
            wings4u_user_id: "user-1",
            wings4u_location_id: CART.location_id,
            wings4u_cart_hash: "different-cart",
          },
        }),
      },
    };

    await expect(
      service.verifySucceededPaymentIntent({
        paymentIntentId: "pi_123",
        userId: "user-1",
        locationId: CART.location_id,
        amountCents: 2500,
        cartHash: buildCheckoutCartHash(CART),
      }),
    ).rejects.toThrow("does not match the submitted cart");
  });
});
