import { KdsAutoAcceptScheduler } from "./kds-auto-accept.scheduler";

function createHarness() {
  const prisma = {
    order: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const kds = {
    systemAutoAccept: jest.fn().mockResolvedValue(true),
    flagForManualReview: jest.fn().mockResolvedValue(true),
  };
  const presence = { isHealthy: jest.fn() };
  const scheduler = new KdsAutoAcceptScheduler(
    prisma as any,
    kds as any,
    presence as any,
  );
  (scheduler as any).automaticSchedulingEnabled = true;
  return { scheduler, prisma, kds, presence };
}

describe("KdsAutoAcceptScheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("schedules one deadline check for a placed order", async () => {
    const { scheduler, prisma, kds, presence } = createHarness();
    const timing = {
      id: "order-1",
      locationId: "loc-1",
      placedAt: new Date(),
      status: "PLACED",
      location: { settings: { kdsAutoAcceptSeconds: 10 } },
    };
    prisma.order.findUnique
      .mockResolvedValueOnce(timing)
      .mockResolvedValueOnce(timing)
      .mockResolvedValueOnce({ id: "order-1", locationId: "loc-1", status: "PLACED" });
    presence.isHealthy.mockReturnValue(true);

    await scheduler.scheduleOrder("order-1");
    await scheduler.scheduleOrder("order-1");
    expect(kds.systemAutoAccept).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(kds.systemAutoAccept).toHaveBeenCalledTimes(1);
    expect(kds.systemAutoAccept).toHaveBeenCalledWith("order-1");
    expect(kds.flagForManualReview).not.toHaveBeenCalled();
    scheduler.onModuleDestroy();
  });

  it("flags a due order when KDS is disconnected", async () => {
    const { scheduler, prisma, kds, presence } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: "order-1",
      locationId: "loc-1",
      status: "PLACED",
    });
    presence.isHealthy.mockReturnValue(false);

    await scheduler.processOrder("order-1");

    expect(kds.flagForManualReview).toHaveBeenCalledWith("order-1");
    expect(kds.systemAutoAccept).not.toHaveBeenCalled();
  });

  it("does not schedule when auto-accept is disabled", async () => {
    const { scheduler, prisma, kds } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: "order-1",
      locationId: "loc-1",
      placedAt: new Date(),
      status: "PLACED",
      location: { settings: { kdsAutoAcceptSeconds: 0 } },
    });

    await scheduler.scheduleOrder("order-1");
    await jest.advanceTimersByTimeAsync(60_000);

    expect(kds.systemAutoAccept).not.toHaveBeenCalled();
    expect(kds.flagForManualReview).not.toHaveBeenCalled();
  });

  it("recovers pending orders once after the reconnect window", async () => {
    const { scheduler, prisma, kds, presence } = createHarness();
    prisma.order.findMany.mockResolvedValue([
      {
        id: "order-1",
        locationId: "loc-1",
        placedAt: new Date(Date.now() - 60_000),
        location: { settings: { kdsAutoAcceptSeconds: 10 } },
      },
    ]);
    prisma.order.findUnique.mockResolvedValue({
      id: "order-1",
      locationId: "loc-1",
      status: "PLACED",
    });
    presence.isHealthy.mockReturnValue(false);

    scheduler.onModuleInit();
    await jest.advanceTimersByTimeAsync(20_000);
    await Promise.resolve();
    await jest.runOnlyPendingTimersAsync();

    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
    expect(kds.flagForManualReview).toHaveBeenCalledWith("order-1");
    scheduler.onModuleDestroy();
  });
});
