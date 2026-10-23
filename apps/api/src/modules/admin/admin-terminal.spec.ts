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
  let queue = Promise.resolve();
  const prisma = { ...tx, $transaction: jest.fn((fn: any) => {
    const run = queue.then(async () => {
    const beforeOrder = { ...order }, beforeRequest = { ...request };
    try { return await fn(tx); } catch (error) { Object.assign(order, beforeOrder); Object.assign(request, beforeRequest); throw error; }
    });
    queue = run.catch(() => {}); return run;
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
  expect(f.tx.driverProfile.update.mock.calls[0][0].data).not.toHaveProperty("lastDeliveryCompletedAt");
  expect(f.tx.driverProfile.update.mock.calls[0][0].data).not.toHaveProperty("totalDeliveriesCompleted");
  await expect(cancel(f, path)).rejects.toThrow();
  expect(f.refunds.createForCancelledOrder).toHaveBeenCalledTimes(1);
});

const rejectPaths = ["admin", "kds"] as const;
const reject = (f: ReturnType<typeof fixture>, path: typeof rejectPaths[number]) => path === "admin"
  ? f.admin.decideCancellation("request", "admin", "DENY", "Reviewed original request", "store")
  : f.kds.handleCancelRequest("order", "admin", "store", "DENY", "Reviewed original request");
it.each(rejectPaths.flatMap(path => TERMINAL_ORDER_STATUSES.map(status => [path, status] as const)))
("%s can resolve a pending request on %s without rewriting fulfillment or refunding", async (path, status) => {
  const f = fixture(status);
  const before = { ...f.order };
  await expect(reject(f, path)).resolves.toMatchObject({ status: "REJECTED" });
  expect(f.order).toEqual(before);
  expect(f.request).toMatchObject({ status: "REJECTED", reasonText: "Customer request", decisionNote: "Reviewed original request", reviewedByAdminUserId: "admin" });
  expect(f.tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
  expect(f.tx.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entityId: "request", actionKey: "cancellation_request.deny" }) });
  expect(f.refunds.createForCancelledOrder).not.toHaveBeenCalled();
  expect(f.tx.order.update).not.toHaveBeenCalled();
  expect(f.tx.orderStatusEvent.create).not.toHaveBeenCalled();
  await expect(reject(f, path)).rejects.toThrow();
  expect(f.tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
});
it.each(rejectPaths)("%s competing rejections record exactly one decision and audit", async path => {
  const f = fixture("PICKED_UP");
  const results = await Promise.allSettled([reject(f, path), reject(f, path)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(f.tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
  expect(f.order.status).toBe("PICKED_UP");
  expect(f.refunds.createForCancelledOrder).not.toHaveBeenCalled();
});
it.each(rejectPaths)("%s rolls back the decision if audit persistence fails", async path => {
  const f = fixture("PICKED_UP");
  f.tx.adminAuditLog.create.mockRejectedValueOnce(new Error("Audit unavailable"));
  await expect(reject(f, path)).rejects.toThrow("Audit unavailable");
  expect(f.request.status).toBe("PENDING");
  expect(f.realtime.emitAdminEvent).not.toHaveBeenCalled();
  expect(f.realtime.emitOrderEvent).not.toHaveBeenCalled();
});
it.each(["admin-request", "kds-request"] as const)("%s approval competing with rejection commits one final decision", async path => {
  for (const rejectionFirst of [true, false]) {
    const f = fixture("READY");
    const calls = rejectionFirst
      ? [reject(f, "admin"), cancel(f, path)] : [cancel(f, path), reject(f, "admin")];
    const results = await Promise.allSettled(calls);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const approvalWon = results[rejectionFirst ? 1 : 0].status === "fulfilled";
    expect(f.request.status).toBe(approvalWon ? "APPROVED" : "REJECTED");
    expect(f.order.status).toBe(approvalWon ? "CANCELLED" : "READY");
    expect(f.refunds.createForCancelledOrder).toHaveBeenCalledTimes(approvalWon ? 1 : 0);
    expect(f.tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
  }
});
it("the admin queue retains pending requests for terminal orders", async () => {
  const f = fixture("PICKED_UP");
  const findMany = jest.fn(async () => [{ ...f.request, order: f.order }]);
  Object.assign(f.prisma.cancellationRequest, { findMany });
  expect(await f.admin.listCancellationRequests("store", {})).toMatchObject({ items: [{ status: "PENDING", order: { status: "PICKED_UP" } }] });
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { locationId: "store", status: "PENDING" } }));
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
