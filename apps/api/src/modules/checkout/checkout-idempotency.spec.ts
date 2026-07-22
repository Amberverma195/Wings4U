import { ConflictException } from "@nestjs/common";
import { buildCheckoutRequestFingerprint } from "../payments/checkout-cart-hash";
import { CheckoutService } from "./checkout.service";

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

function basePlaceOrderParams(
  overrides: Partial<Parameters<CheckoutService["placeOrder"]>[0]> = {},
) {
  return {
    userId: "user-1",
    locationId: LOCATION_ID,
    fulfillmentType: "DELIVERY" as const,
    items: [],
    idempotencyKey: "retry-key",
    addressSnapshotJson: {
      line1: "123 Example Street",
      city: "London",
      postal_code: "N5W 3C1",
    },
    deliveryQuoteToken: "expired-token",
    ...overrides,
  };
}

function requestFingerprintFor(
  params: ReturnType<typeof basePlaceOrderParams>,
) {
  return buildCheckoutRequestFingerprint({
    location_id: params.locationId,
    fulfillment_type: params.fulfillmentType,
    items: params.items,
    address_snapshot_json: params.addressSnapshotJson,
    payment_method: params.paymentMethod,
    customer_order_notes: params.specialInstructions,
    contactless_pref: params.contactlessPref,
    is_student_order: params.isStudentOrder,
    student_id_snapshot: params.studentIdSnapshot,
    stripe_payment_intent_id: params.stripePaymentIntentId,
  });
}

describe("CheckoutService idempotent replay", () => {
  it("returns the completed order before validating an expired delivery quote", async () => {
    const params = basePlaceOrderParams();
    const prisma = {
      checkoutIdempotencyKey: {
        findUnique: jest.fn().mockResolvedValue({
          userId: "user-1",
          locationId: LOCATION_ID,
          orderId: "order-1",
          requestFingerprint: requestFingerprintFor(params),
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: "order-1",
          orderNumber: 42n,
          orderItems: [],
          statusEvents: [],
        }),
      },
      orderPayment: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const verifier = {
      verifyForDelivery: jest.fn(() => {
        throw new Error("expired");
      }),
    };
    const service = new CheckoutService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      verifier as never,
    );

    await expect(service.placeOrder(params)).resolves.toMatchObject({
      id: "order-1",
      order_number: 42,
    });

    expect(verifier.verifyForDelivery).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an idempotency key reused with a different request body", async () => {
    const original = basePlaceOrderParams({
      specialInstructions: "no onions",
    });
    const reused = basePlaceOrderParams({
      specialInstructions: "extra ranch",
    });
    const prisma = {
      checkoutIdempotencyKey: {
        findUnique: jest.fn().mockResolvedValue({
          userId: "user-1",
          locationId: LOCATION_ID,
          orderId: "order-1",
          requestFingerprint: requestFingerprintFor(original),
        }),
      },
      order: {
        findUnique: jest.fn(),
      },
      orderPayment: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const service = new CheckoutService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { verifyForDelivery: jest.fn() } as never,
    );

    await expect(service.placeOrder(reused)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("rejects Stripe PaymentIntent replay for another customer", async () => {
    const params = basePlaceOrderParams({
      paymentMethod: "ONLINE_CARD",
      stripePaymentIntentId: "pi_stolen",
      fulfillmentType: "PICKUP",
      addressSnapshotJson: undefined,
      deliveryQuoteToken: undefined,
    });
    const prisma = {
      checkoutIdempotencyKey: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      order: {
        findUnique: jest.fn(),
      },
      orderPayment: {
        findFirst: jest.fn().mockResolvedValue({
          orderId: "order-other",
          locationId: LOCATION_ID,
          order: {
            customerUserId: "user-other",
            locationId: LOCATION_ID,
          },
        }),
      },
      $transaction: jest.fn(),
    };
    const service = new CheckoutService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { verifyForDelivery: jest.fn() } as never,
    );

    await expect(service.placeOrder(params)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
