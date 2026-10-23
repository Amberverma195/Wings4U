import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { TERMINAL_ORDER_STATUSES } from "../../common/orders/order-lifecycle";
import { OrdersService } from "./orders.service";

function fixture(status: string) {
  const order = { id: "order", customerUserId: "customer", locationId: "store", status,
    cancelAllowedUntil: new Date(Date.now() + 60_000) };
  const tx = { order: { update: jest.fn(async ({ data }: any) => ({ ...order, ...data })) },
    orderStatusEvent: { create: jest.fn() } };
  const prisma = { order: { findUnique: jest.fn(async () => order) },
    $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const chat = { closeConversation: jest.fn() }, refunds = { createForCancelledOrder: jest.fn() };
  const realtime = { emitOrderEvent: jest.fn() }, emails = { send: jest.fn() };
  const service = new OrdersService(prisma as any, chat as any, refunds as any, realtime as any, emails as any, {} as any);
  return { service, prisma, tx, refunds, chat, realtime };
}
it.each(TERMINAL_ORDER_STATUSES)("customer cannot cancel historical %s even within the cancel window", async status => {
  const f = fixture(status);
  await expect(f.service.customerCancel("order", "customer")).rejects.toBeInstanceOf(UnprocessableEntityException);
  expect(f.prisma.$transaction).not.toHaveBeenCalled();
  expect(f.refunds.createForCancelledOrder).not.toHaveBeenCalled();
});
it("a cancellation losing to KDS completion cannot produce a cancellation event or refund", async () => {
  const f = fixture("PLACED");
  f.tx.order.update.mockRejectedValueOnce({ code: "P2025" });
  await expect(f.service.customerCancel("order", "customer")).rejects.toBeInstanceOf(ConflictException);
  expect(f.tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "order", status: "PLACED" } }));
  expect(f.tx.orderStatusEvent.create).not.toHaveBeenCalled();
  expect(f.refunds.createForCancelledOrder).not.toHaveBeenCalled();
  expect(f.realtime.emitOrderEvent).not.toHaveBeenCalled();
});
