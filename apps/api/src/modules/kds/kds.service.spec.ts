import { UnprocessableEntityException } from "@nestjs/common";
import { KdsService } from "./kds.service";

describe("KdsService acceptance race protection", () => {
  it("does not write events when another accept path claims the order first", async () => {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: "order-1",
          locationId: "loc-1",
          status: "PLACED",
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn(),
      },
      orderStatusEvent: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const realtime = { emitOrderEvent: jest.fn() };
    const service = new KdsService(
      prisma as any,
      {} as any,
      realtime as any,
      {} as any,
      {} as any,
      {} as any,
      { send: jest.fn() } as any,
    );

    await expect(service.acceptOrder("order-1", "staff-1", "loc-1")).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );

    expect(tx.orderStatusEvent.create).not.toHaveBeenCalled();
    expect(tx.order.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(realtime.emitOrderEvent).not.toHaveBeenCalled();
  });
});

describe("KdsService external delivery bypass", () => {
  function createHarness(
    orderOverrides: Record<string, unknown> = {},
  ) {
    const order = {
      id: "order-1",
      locationId: "loc-1",
      status: "READY",
      fulfillmentType: "DELIVERY",
      assignedDriverUserId: null,
      customerUserId: "customer-1",
      orderNumber: 101n,
      customerNameSnapshot: "Jamie",
      customerEmailSnapshot: "jamie@example.com",
      addressSnapshotJson: {
        line1: "123 Dundas Street",
        city: "London",
        postal_code: "N6A 1A1",
      },
      orderItems: [],
      cancellationRequests: [],
      ...orderOverrides,
    };
    const tx = {
      order: {
        update: jest.fn(
          ({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({
              ...order,
              ...data,
              orderItems: [],
              cancellationRequests: [],
            }),
        ),
      },
      orderStatusEvent: { create: jest.fn().mockResolvedValue({}) },
      customerProfile: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => unknown) => callback(tx),
      ),
    };
    const chat = { closeConversation: jest.fn().mockResolvedValue(undefined) };
    const realtime = {
      emitOrderEvent: jest.fn(),
      emitDriverEvent: jest.fn(),
    };
    const rewards = {
      accrueForOrderInTransaction: jest.fn().mockResolvedValue(undefined),
    };
    const emails = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new KdsService(
      prisma as any,
      chat as any,
      realtime as any,
      {} as any,
      {} as any,
      rewards as any,
      emails as any,
    );

    return { service, prisma, tx, chat, realtime, rewards, emails };
  }

  it.each([
    ["DELIVERED", true],
    ["NO_SHOW_DELIVERY", false],
  ] as const)(
    "closes an unassigned READY delivery as %s",
    async (outcome, accruesRewards) => {
      const harness = createHarness();

      const result = await harness.service.completeExternalDelivery(
        "order-1",
        "staff-1",
        "loc-1",
        outcome,
      );

      expect(result.status).toBe(outcome);
      expect(result.address_snapshot_json).toEqual({
        line1: "123 Dundas Street",
        city: "London",
        postal_code: "N6A 1A1",
      });
      expect(harness.tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: outcome,
            deliveryCompletedByUserId: "staff-1",
          }),
        }),
      );
      expect(harness.tx.orderStatusEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fromStatus: "READY",
          toStatus: outcome,
          eventType: "EXTERNAL_DELIVERY_BYPASS",
          actorUserId: "staff-1",
        }),
      });
      expect(harness.chat.closeConversation).toHaveBeenCalledWith("order-1");

      if (accruesRewards) {
        expect(harness.rewards.accrueForOrderInTransaction).toHaveBeenCalled();
        expect(harness.emails.send).toHaveBeenCalledWith(
          expect.objectContaining({ status: "DELIVERED" }),
          "DELIVERED",
        );
      } else {
        expect(harness.tx.customerProfile.upsert).toHaveBeenCalled();
        expect(harness.rewards.accrueForOrderInTransaction).not.toHaveBeenCalled();
        expect(harness.emails.send).not.toHaveBeenCalled();
      }
    },
  );

  it("does not weaken the generic READY status transition", async () => {
    const harness = createHarness();

    await expect(
      harness.service.updateOrderStatus(
        "order-1",
        "staff-1",
        "loc-1",
        "DELIVERED",
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("emails the customer after a restaurant cancellation is finalized", async () => {
    const harness = createHarness();

    await harness.service.updateOrderStatus(
      "order-1",
      "staff-1",
      "loc-1",
      "CANCELLED",
      "Kitchen equipment issue",
    );

    expect(harness.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "CANCELLED",
        cancellationReason: "Kitchen equipment issue",
        cancellationSource: "STAFF",
      }),
      "CANCELLED",
    );
  });

  it("rejects the bypass when an internal driver is assigned", async () => {
    const harness = createHarness({ assignedDriverUserId: "driver-1" });

    await expect(
      harness.service.completeExternalDelivery(
        "order-1",
        "staff-1",
        "loc-1",
        "DELIVERED",
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });
});
