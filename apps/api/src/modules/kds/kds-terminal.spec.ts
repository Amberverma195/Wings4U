import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { TERMINAL_ORDER_STATUSES } from "../../common/orders/order-lifecycle";
import { KdsService } from "./kds.service";

// In-memory guarded writes model competing requests; no Prisma client is created.
function fixture(overrides: Record<string, unknown> = {}, otherAssignments = 0) {
  const order: any = { id: "order", locationId: "store", customerUserId: "customer", orderNumber: 1n,
    status: "READY", fulfillmentType: "PICKUP", assignedDriverUserId: null,
    paymentStatusSummary: "UNPAID", finalPayableCents: 1130, pricingSnapshotJson: {},
    orderItems: [], cancellationRequests: [], ...overrides };
  const ledger = [{ transactionType: "CAPTURE", signedAmountCents: 300, transactionStatus: "SUCCESS" }];
  const writeForbidden = jest.fn(() => { throw new Error("Completion must never write a payment"); });
  const tx: any = {
    order: {
      update: jest.fn(async ({ where, data }: any) => {
        if (where.status !== order.status || ("assignedDriverUserId" in where && where.assignedDriverUserId !== order.assignedDriverUserId)) {
          throw { code: "P2025" };
        }
        Object.assign(order, data); return { ...order, payments: ledger };
      }),
      count: jest.fn(async () => otherAssignments),
    },
    orderStatusEvent: { create: jest.fn() }, orderDriverEvent: { create: jest.fn() },
    customerProfile: { upsert: jest.fn() }, driverProfile: { update: jest.fn() },
    orderPayment: { findMany: jest.fn(async () => ledger), create: writeForbidden, update: writeForbidden, deleteMany: writeForbidden },
    adminAuditLog: { create: jest.fn() },
  };
  let queue = Promise.resolve();
  const prisma: any = {
    order: { findUnique: jest.fn(async () => ({ ...order })) },
    deliveryPinVerification: { findUnique: jest.fn(async () => ({ verificationResult: "VERIFIED" })) },
    $transaction: jest.fn((fn: any) => {
      const run = queue.then(() => fn(tx)); queue = run.catch(() => {}); return run;
    }),
  };
  const chat = { closeConversation: jest.fn(), getUnreadCountsForOrders: jest.fn(async () => new Map()) };
  const realtime = { emitOrderEvent: jest.fn(), emitDriverEvent: jest.fn() };
  const pin = { verify: jest.fn() };
  const rewards = { accrueForOrderInTransaction: jest.fn() };
  const service = new KdsService(prisma, chat as any, realtime as any, pin as any, {} as any, rewards as any, { send: jest.fn() } as any);
  const complete = (status: string) => status === "DELIVERED"
    ? service.completeDelivery("order", "staff", "store")
    : status === "NO_PIN_DELIVERY" ? service.completeDeliveryWithoutPin("order", "staff", "store")
    : service.updateOrderStatus("order", "staff", "store", status, "Staff action");
  return { service, order, tx, prisma, chat, realtime, pin, rewards, ledger, writeForbidden, complete };
}

describe("terminal fulfillment is independent of collection", () => {
  it.each(TERMINAL_ORDER_STATUSES)("excludes %s from active KDS queries but retains its history and balance", async status => {
    const f = fixture({ status, customerUserId: null });
    f.prisma.locationSettings = { findUnique: jest.fn(async () => ({})) };
    f.prisma.order.findMany = jest.fn(async ({ where }: any) => where.status.in.includes(status) ? [f.order] : []);
    f.prisma.order.findFirst = jest.fn(async () => ({ ...f.order, payments: f.ledger }));
    expect(await f.service.getKdsOrders("store", ["READY", ...TERMINAL_ORDER_STATUSES])).toEqual([]);
    expect(f.prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { locationId: "store", status: { in: ["READY"] } },
    }));
    expect(await f.service.getKdsOrders("store")).toEqual([]);
    expect(await f.service.getKdsOrder("store", "order")).toMatchObject({
      status, payment_status_summary: "UNPAID",
      payment_summary: { outstanding_cents: status === "CANCELLED" ? 0 : 830, amount_collected_cents: 300 },
    });
  });
  it.each([
    ["PICKED_UP", "UNPAID"], ["PICKED_UP", "PAID"], ["DELIVERED", "UNPAID"], ["DELIVERED", "PAID"],
    ["NO_SHOW_PICKUP", "UNPAID"], ["NO_SHOW_DELIVERY", "UNPAID"], ["NO_PIN_DELIVERY", "UNPAID"], ["CANCELLED", "UNPAID"],
  ])("closes %s / %s without changing the payment ledger", async (status, paymentStatusSummary) => {
    const delivery = ["DELIVERED", "NO_SHOW_DELIVERY", "NO_PIN_DELIVERY"].includes(status);
    const f = fixture({ paymentStatusSummary, status: delivery ? "OUT_FOR_DELIVERY" : "READY",
      fulfillmentType: delivery ? "DELIVERY" : "PICKUP", assignedDriverUserId: delivery ? "driver" : null });
    if (status === "NO_PIN_DELIVERY") f.prisma.deliveryPinVerification.findUnique.mockResolvedValue({ verificationResult: "LOCKED" });
    const originalLedger = structuredClone(f.ledger);
    const result = await f.complete(status);
    expect(result).toMatchObject({ status, payment_status_summary: paymentStatusSummary });
    expect(f.chat.closeConversation).toHaveBeenCalledWith("order");
    expect(f.realtime.emitOrderEvent).toHaveBeenCalledWith("store", "order",
      status === "CANCELLED" ? "order.cancelled" : "order.status_changed", expect.objectContaining({ to_status: status }));
    expect(f.ledger).toEqual(originalLedger);
    expect(f.writeForbidden).not.toHaveBeenCalled();
    expect(f.tx.order.update.mock.calls[0][0].data).not.toHaveProperty("paymentStatusSummary");
    if (status.startsWith("NO_SHOW")) expect(f.tx.customerProfile.upsert).toHaveBeenCalledTimes(1);
    else expect(f.tx.customerProfile.upsert).not.toHaveBeenCalled();
    if (delivery) expect(f.tx.driverProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ availabilityStatus: "AVAILABLE", isOnDelivery: false }),
    }));
    if (status === "DELIVERED" || status === "NO_PIN_DELIVERY") {
      expect(f.realtime.emitDriverEvent).toHaveBeenCalledWith("store", "driver.delivery_completed", expect.objectContaining({ order_id: "order" }));
      expect(f.tx.driverProfile.update.mock.calls[0][0].data).toMatchObject({ totalDeliveriesCompleted: { increment: 1 }, lastDeliveryCompletedAt: expect.any(Date) });
    }
    if (status === "NO_SHOW_DELIVERY") {
      expect(f.realtime.emitDriverEvent).toHaveBeenCalledWith("store", "driver.delivery_completed", expect.objectContaining({ no_show: true }));
      expect(f.tx.driverProfile.update.mock.calls[0][0].data).not.toHaveProperty("totalDeliveriesCompleted");
      expect(f.tx.driverProfile.update.mock.calls[0][0].data).not.toHaveProperty("lastDeliveryCompletedAt");
    }
    await expect(f.complete(status)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(f.tx.orderStatusEvent.create).toHaveBeenCalledTimes(1);
    expect(f.chat.closeConversation).toHaveBeenCalledTimes(1);
  });

  it.each(TERMINAL_ORDER_STATUSES)("rejects fulfillment, cancellation and ETA actions on historical %s", async status => {
    const f = fixture({ status });
    await expect(f.service.updateOrderStatus("order", null, "store", "CANCELLED", "reason")).rejects.toThrow("terminal status");
    await expect(f.service.requestCancellation("order", null, "store", "reason")).rejects.toThrow("terminal status");
    await expect(f.service.requestChatCancellation("order", null, "store", "reason", "conversation")).rejects.toThrow("terminal status");
    await expect(f.service.updateEta("order", null, 5, "KDS")).rejects.toThrow("closed order");
    await expect(f.service.adjustEtaDelta("order", null, "store", 5)).rejects.toThrow("terminal status");
    await expect(f.service.assignDriver("order", "driver", null, "store")).rejects.toThrow("Cannot assign");
    await expect(f.service.startDelivery("order", null, "store")).rejects.toThrow("must be READY");
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(["NO_SHOW_PICKUP", "PICKED_UP"])("only one competing pickup request wins against %s", async second => {
    const f = fixture();
    const results = await Promise.allSettled([f.complete("NO_SHOW_PICKUP"), f.complete(second)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(f.order.status).toBe("NO_SHOW_PICKUP");
    expect(f.tx.orderStatusEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.customerProfile.upsert).toHaveBeenCalledTimes(1);
  });

  it.each(["DELIVERED", "NO_SHOW_DELIVERY", "NO_PIN_DELIVERY"])("prevents conflicting delivery completion (%s)", async second => {
    const f = fixture({ status: "OUT_FOR_DELIVERY", fulfillmentType: "DELIVERY", assignedDriverUserId: "driver" });
    if (second === "NO_PIN_DELIVERY") f.prisma.deliveryPinVerification.findUnique.mockResolvedValue({ verificationResult: "LOCKED" });
    // Both requests pass the same preflight snapshot before either guarded write.
    const results = await Promise.allSettled([f.complete(second), f.complete("NO_SHOW_DELIVERY")]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(f.tx.orderStatusEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.orderDriverEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.driverProfile.update).toHaveBeenCalledTimes(1);
  });

  it.each(["DELIVERED", "NO_PIN_DELIVERY", "NO_SHOW_DELIVERY"])("keeps the driver busy if another assignment exists (%s)", async status => {
    const f = fixture({ status: "OUT_FOR_DELIVERY", fulfillmentType: "DELIVERY", assignedDriverUserId: "driver" }, 1);
    if (status === "NO_PIN_DELIVERY") f.prisma.deliveryPinVerification.findUnique.mockResolvedValue({ verificationResult: "LOCKED" });
    await f.complete(status);
    expect(f.tx.driverProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isOnDelivery: true, availabilityStatus: "ON_DELIVERY" }) }));
  });

  it("a direct staff cancellation releases the driver without adding a no-show or payment", async () => {
    const f = fixture({ status: "OUT_FOR_DELIVERY", fulfillmentType: "DELIVERY", assignedDriverUserId: "driver" });
    await f.complete("CANCELLED");
    expect(f.tx.driverProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isOnDelivery: false, availabilityStatus: "AVAILABLE" }) }));
    expect(f.tx.orderDriverEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ eventType: "ORDER_CANCELLED" }) });
    expect(f.tx.customerProfile.upsert).not.toHaveBeenCalled();
    expect(f.writeForbidden).not.toHaveBeenCalled();
    expect(f.realtime.emitDriverEvent.mock.calls.some(([, name]) => name === "driver.delivery_completed")).toBe(false);
    expect(f.tx.driverProfile.update.mock.calls[0][0].data).not.toHaveProperty("lastDeliveryCompletedAt");
    expect(f.realtime.emitDriverEvent).toHaveBeenCalledWith("store", "driver.availability_changed", expect.objectContaining({ availability_status: "AVAILABLE" }));
  });

  it("keeps PIN verification mandatory on ordinary status and completion routes", async () => {
    const f = fixture({ status: "OUT_FOR_DELIVERY", fulfillmentType: "DELIVERY", assignedDriverUserId: "driver" });
    f.prisma.deliveryPinVerification.findUnique.mockResolvedValue(null);
    for (const status of ["DELIVERED", "NO_PIN_DELIVERY"]) {
      await expect(f.service.updateOrderStatus("order", null, "store", status)).rejects.toThrow("not allowed");
    }
    await expect(f.service.completeDelivery("order", null, "store")).rejects.toThrow("PIN is required");
    await expect(f.service.completeDeliveryWithoutPin("order", null, "store")).rejects.toThrow("retried indefinitely");
    expect(f.tx.order.update).not.toHaveBeenCalled();
  });

  it("verifies a supplied delivery PIN before completing, without collecting payment", async () => {
    const f = fixture({ status: "OUT_FOR_DELIVERY", fulfillmentType: "DELIVERY", assignedDriverUserId: "driver" });
    f.prisma.deliveryPinVerification.findUnique.mockResolvedValue(null);
    f.pin.verify.mockResolvedValueOnce({ ok: false, reason: "MISMATCH" });
    await expect(f.service.completeDelivery("order", "staff", "store", "1234")).rejects.toThrow("PIN verification failed");
    expect(f.tx.order.update).not.toHaveBeenCalled();
    f.pin.verify.mockResolvedValueOnce({ ok: true });
    await expect(f.service.completeDelivery("order", "staff", "store", "4321")).resolves.toMatchObject({ status: "DELIVERED", payment_status_summary: "UNPAID" });
    expect(f.pin.verify).toHaveBeenLastCalledWith({ orderId: "order", locationId: "store", actorUserId: "staff", driverUserId: "driver", pin: "4321" });
    expect(f.writeForbidden).not.toHaveBeenCalled();
  });
});
