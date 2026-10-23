import { TERMINAL_ORDER_STATUSES } from "../../common/orders/order-lifecycle";
import { AdminService } from "./admin.service";
import { KdsService } from "../kds/kds.service";

function fixture(status = "READY", remaining = 0) {
  const order = { id: "order", locationId: "store", status, assignedDriverUserId: "driver",
    paymentStatusSummary: "UNPAID", orderNumber: 1n, customerNameSnapshot: "Customer", customerEmailSnapshot: null };
  const request = { id: "request", orderId: "order", locationId: "store", status: "PENDING", requestSource: "KDS_CHAT_REQUEST", reasonText: "Customer request" };
  const tx = {
    order: {
      findUnique: jest.fn(async () => ({ ...order })), findUniqueOrThrow: jest.fn(async () => ({ ...order })),
      update: jest.fn(async ({ where, data }: any) => {
        if (where.status !== order.status) throw { code: "P2025" };
        Object.assign(order, data); return { ...order };
      }), count: jest.fn(async () => remaining),
    },
    cancellationRequest: {
      findUnique: jest.fn(async () => ({ ...request, order: { ...order } })), findFirst: jest.fn(async () => ({ ...request })),
      update: jest.fn(async ({ where, data }: any) => {
        if (where.status !== request.status) throw { code: "P2025" };
        Object.assign(request, data); return { ...request };
      }),
    },
    orderStatusEvent: { create: jest.fn() }, orderDriverEvent: { create: jest.fn() },
    driverProfile: { update: jest.fn() }, adminAuditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn: any) => {
    const beforeOrder = { ...order }, beforeRequest = { ...request };
    try { return await fn(tx); } catch (error) { Object.assign(order, beforeOrder); Object.assign(request, beforeRequest); throw error; }
  }) };
  const refunds = { createForCancelledOrder: jest.fn() }, chat = { closeConversation: jest.fn() };
  const realtime = { emitOrderEvent: jest.fn(), emitAdminEvent: jest.fn(), emitDriverEvent: jest.fn() };
  const emails = { send: jest.fn() };
  const admin = new AdminService(prisma as any, chat as any, realtime as any, {} as any, refunds as any, emails as any);
  const kds = new KdsService(prisma as any, chat as any, realtime as any, {} as any, refunds as any, {} as any, emails as any);
  return { admin, kds, tx, prisma, order, request, refunds, chat, realtime };
}
const paths = ["admin-direct", "admin-request", "kds-request"] as const;
function cancel(f: ReturnType<typeof fixture>, path: typeof paths[number]) {
  return path === "admin-direct" ? f.admin.cancelOrder("order", "admin", "Customer request", "store")
    : path === "admin-request" ? f.admin.decideCancellation("request", "admin", "APPROVE", undefined, "store")
    : f.kds.handleCancelRequest("order", "admin", "store", "APPROVE");
}
it.each(paths.flatMap(path => TERMINAL_ORDER_STATUSES.map(status => [path, status] as const)))
("%s cannot overwrite terminal %s", async (path, status) => {
  const f = fixture(status);
  await expect(cancel(f, path)).rejects.toThrow(path === "admin-direct" ? "terminal status" : "already closed");
  expect(f.prisma.$transaction).not.toHaveBeenCalled();
  expect(f.request.status).toBe("PENDING");
  expect(f.refunds.createForCancelledOrder).not.toHaveBeenCalled();
});
it.each(paths.flatMap(path => [0, 1].map(remaining => [path, remaining] as const)))
("%s closes without collecting and releases its driver with %s other assignments", async (path, remaining) => {
  const f = fixture("READY", remaining);
  await cancel(f, path);
  expect(f.order).toMatchObject({ status: "CANCELLED", paymentStatusSummary: "UNPAID" });
  expect(f.tx.driverProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    isOnDelivery: remaining > 0, availabilityStatus: remaining > 0 ? "ON_DELIVERY" : "AVAILABLE",
  }) }));
  expect(f.tx.orderStatusEvent.create).toHaveBeenCalledTimes(1);
  expect(f.chat.closeConversation).toHaveBeenCalledWith("order");
  expect(f.refunds.createForCancelledOrder).toHaveBeenCalledTimes(1);
  await expect(cancel(f, path)).rejects.toThrow();
  expect(f.refunds.createForCancelledOrder).toHaveBeenCalledTimes(1);
});
it.each(paths)("%s rolls back a losing cancellation without generating a refund", async path => {
  const f = fixture();
  f.tx.order.update.mockRejectedValueOnce({ code: "P2025" });
  await expect(cancel(f, path)).rejects.toThrow("Order changed");
  expect(f.request.status).toBe("PENDING");
  expect(f.refunds.createForCancelledOrder).not.toHaveBeenCalled();
  expect(f.tx.orderStatusEvent.create).not.toHaveBeenCalled();
  expect(f.tx.driverProfile.update).not.toHaveBeenCalled();
});
