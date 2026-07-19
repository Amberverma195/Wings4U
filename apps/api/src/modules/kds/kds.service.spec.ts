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
