import { OverdueDeliveryJob } from "./overdue-delivery.job";

function createHarness() {
  const prisma = {
    order: { findMany: jest.fn() },
    locationSettings: { findMany: jest.fn() },
    supportTicket: { findFirst: jest.fn() },
  };
  const support = { createTicket: jest.fn().mockResolvedValue({ id: "ticket-1" }) };
  return {
    prisma,
    support,
    job: new OverdueDeliveryJob(prisma as any, support as any),
  };
}

describe("OverdueDeliveryJob", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");
  const order = {
    id: "order-1",
    locationId: "loc-1",
    customerUserId: "user-1",
    orderNumber: 42n,
    estimatedArrivalAt: new Date("2026-07-17T11:50:00.000Z"),
  };

  it("creates one ticket at the grace-window boundary", async () => {
    const { job, prisma, support } = createHarness();
    prisma.order.findMany.mockResolvedValue([order]);
    prisma.locationSettings.findMany.mockResolvedValue([
      { locationId: "loc-1", overdueDeliveryGraceMinutes: 10 },
    ]);
    prisma.supportTicket.findFirst.mockResolvedValue(null);

    await expect(job.runOnce(now)).resolves.toBe(1);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "OUT_FOR_DELIVERY" }),
      }),
    );
    expect(support.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        ticketType: "DELIVERY_OVERDUE",
      }),
    );
  });

  it("does nothing before the grace window", async () => {
    const { job, prisma, support } = createHarness();
    prisma.order.findMany.mockResolvedValue([order]);
    prisma.locationSettings.findMany.mockResolvedValue([
      { locationId: "loc-1", overdueDeliveryGraceMinutes: 20 },
    ]);

    await expect(job.runOnce(now)).resolves.toBe(0);
    expect(support.createTicket).not.toHaveBeenCalled();
  });

  it("does not duplicate an existing overdue ticket", async () => {
    const { job, prisma, support } = createHarness();
    prisma.order.findMany.mockResolvedValue([order]);
    prisma.locationSettings.findMany.mockResolvedValue([
      { locationId: "loc-1", overdueDeliveryGraceMinutes: 10 },
    ]);
    prisma.supportTicket.findFirst.mockResolvedValue({ id: "existing" });

    await expect(job.runOnce(now)).resolves.toBe(0);
    expect(support.createTicket).not.toHaveBeenCalled();
  });

  it("does not inspect settings or tickets when no active delivery is due", async () => {
    const { job, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([]);

    await expect(job.runOnce(now)).resolves.toBe(0);

    expect(prisma.locationSettings.findMany).not.toHaveBeenCalled();
    expect(prisma.supportTicket.findFirst).not.toHaveBeenCalled();
  });
});
