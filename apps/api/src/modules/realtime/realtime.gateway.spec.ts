import { RealtimeGateway } from "./realtime.gateway";

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

function createGateway() {
  const prisma = {
    location: {
      findUnique: jest.fn(),
    },
  };
  const kdsPresence = {
    markSubscribed: jest.fn(),
    markUnsubscribed: jest.fn(),
    markDisconnected: jest.fn(),
  };
  const operatingHours = {
    mayOperate: jest.fn().mockResolvedValue({
      allowed: true,
      draining: false,
      closesAt: null,
    }),
    hasActiveTickets: jest.fn().mockResolvedValue(false),
  };
  const kdsAuth = {
    revokeLocationSessions: jest.fn().mockResolvedValue(1),
  };
  const gateway = new RealtimeGateway(
    {} as never,
    prisma as never,
    kdsAuth as never,
    kdsPresence as never,
    {} as never,
    operatingHours as never,
  );

  return { gateway, prisma, kdsPresence, operatingHours, kdsAuth };
}

function createSocket() {
  return {
    id: "socket-1",
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe("RealtimeGateway location subscriptions", () => {
  it("resolves a location code before joining the orders room", async () => {
    const { gateway, prisma, kdsPresence } = createGateway();
    const socket = createSocket();
    const user = {
      userId: "kds-station:session-1",
      role: "KDS_STATION",
      stationLocationId: LOCATION_ID,
      isPosSession: false,
      sessionId: "kds:session-1",
    };
    prisma.location.findUnique.mockResolvedValue({
      id: LOCATION_ID,
      isActive: true,
    });
    jest
      .spyOn(gateway as never, "revalidateSocketUser" as never)
      .mockResolvedValue(user as never);

    const result = await gateway.handleSubscribe(
      { channel: "orders:LON01" },
      socket as never,
    );

    expect(prisma.location.findUnique).toHaveBeenCalledWith({
      where: { code: "LON01" },
      select: { id: true, isActive: true },
    });
    expect(socket.join).toHaveBeenCalledWith(`orders:${LOCATION_ID}`);
    expect(kdsPresence.markSubscribed).toHaveBeenCalledWith(
      LOCATION_ID,
      socket.id,
    );
    expect(result).toEqual({
      subscribed: true,
      channel: `orders:${LOCATION_ID}`,
    });
  });

  it("rejects an unknown location code without joining a room", async () => {
    const { gateway, prisma } = createGateway();
    const socket = createSocket();
    prisma.location.findUnique.mockResolvedValue(null);
    jest
      .spyOn(gateway as never, "revalidateSocketUser" as never)
      .mockResolvedValue({
        userId: "admin-1",
        role: "ADMIN",
        isPosSession: false,
        sessionId: "session-1",
      } as never);

    const result = await gateway.handleSubscribe(
      { channel: "orders:UNKNOWN" },
      socket as never,
    );

    expect(socket.join).not.toHaveBeenCalled();
    expect(result).toEqual({
      subscribed: false,
      channel: "orders:UNKNOWN",
      error: "Invalid location id",
    });
  });

  it("rejects a KDS orders subscription outside operating hours", async () => {
    const { gateway, prisma, operatingHours } = createGateway();
    const socket = createSocket();
    const user = {
      userId: "kds-station:session-1",
      role: "KDS_STATION",
      stationLocationId: LOCATION_ID,
      isPosSession: false,
      sessionId: "kds:session-1",
    };
    prisma.location.findUnique.mockResolvedValue({
      id: LOCATION_ID,
      isActive: true,
    });
    operatingHours.mayOperate.mockResolvedValue({
      allowed: false,
      draining: false,
      closesAt: null,
    });
    jest
      .spyOn(gateway as never, "revalidateSocketUser" as never)
      .mockResolvedValue(user as never);

    const result = await gateway.handleSubscribe(
      { channel: "orders:LON01" },
      socket as never,
    );

    expect(socket.join).not.toHaveBeenCalled();
    expect(result).toEqual({
      subscribed: false,
      channel: "orders:LON01",
      error: "KDS is outside scheduled operating hours",
    });
  });

  it("resolves the same room when unsubscribing a KDS station", async () => {
    const { gateway, prisma, kdsPresence } = createGateway();
    const socket = createSocket();
    socket.data.user = {
      role: "KDS_STATION",
      stationLocationId: LOCATION_ID,
    };
    prisma.location.findUnique.mockResolvedValue({
      id: LOCATION_ID,
      isActive: true,
    });

    const result = await gateway.handleUnsubscribe(
      { channel: "orders:LON01" },
      socket as never,
    );

    expect(socket.leave).toHaveBeenCalledWith(`orders:${LOCATION_ID}`);
    expect(kdsPresence.markUnsubscribed).toHaveBeenCalledWith(
      LOCATION_ID,
      socket.id,
    );
    expect(result).toEqual({
      unsubscribed: true,
      channel: `orders:${LOCATION_ID}`,
    });
  });

  it("disconnects KDS sockets at closing when no active tickets remain", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-19T14:00:00.000Z"));
    try {
      const { gateway, prisma, operatingHours, kdsAuth } = createGateway();
      const socket = createSocket();
      const user = {
        userId: "kds-station:session-1",
        role: "KDS_STATION",
        stationLocationId: LOCATION_ID,
        isPosSession: false,
        sessionId: "kds:session-1",
      };
      prisma.location.findUnique.mockResolvedValue({
        id: LOCATION_ID,
        isActive: true,
      });
      operatingHours.mayOperate.mockResolvedValue({
        allowed: true,
        draining: false,
        closesAt: new Date("2026-07-19T14:01:00.000Z"),
      });
      operatingHours.hasActiveTickets.mockResolvedValue(false);
      jest
        .spyOn(gateway as never, "revalidateSocketUser" as never)
        .mockResolvedValue(user as never);
      gateway.server = {
        sockets: { sockets: new Map([[socket.id, socket]]) },
      } as never;

      await gateway.handleSubscribe(
        { channel: "orders:LON01" },
        socket as never,
      );
      await jest.advanceTimersByTimeAsync(60_000);

      expect(operatingHours.hasActiveTickets).toHaveBeenCalledWith(LOCATION_ID);
      expect(kdsAuth.revokeLocationSessions).toHaveBeenCalledWith(LOCATION_ID);
      expect(socket.emit).toHaveBeenCalledWith("kds.schedule_closed", {
        location_id: LOCATION_ID,
      });
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(
        kdsAuth.revokeLocationSessions.mock.invocationCallOrder[0],
      ).toBeLessThan(socket.disconnect.mock.invocationCallOrder[0]);
      gateway.onApplicationShutdown();
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps the location closing timer after the last KDS socket disconnects", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-19T14:00:00.000Z"));
    try {
      const { gateway, prisma, operatingHours, kdsAuth } = createGateway();
      const socket = createSocket();
      const user = {
        userId: "kds-station:session-1",
        role: "KDS_STATION",
        stationLocationId: LOCATION_ID,
        isPosSession: false,
        sessionId: "kds:session-1",
      };
      socket.data.user = user;
      prisma.location.findUnique.mockResolvedValue({
        id: LOCATION_ID,
        isActive: true,
      });
      operatingHours.mayOperate.mockResolvedValue({
        allowed: true,
        draining: false,
        closesAt: new Date("2026-07-19T14:01:00.000Z"),
      });
      jest
        .spyOn(gateway as never, "revalidateSocketUser" as never)
        .mockResolvedValue(user as never);
      gateway.server = {
        sockets: { sockets: new Map([[socket.id, socket]]) },
      } as never;

      await gateway.handleSubscribe(
        { channel: "orders:LON01" },
        socket as never,
      );
      gateway.handleDisconnect(socket as never);
      await jest.advanceTimersByTimeAsync(60_000);

      expect(kdsAuth.revokeLocationSessions).toHaveBeenCalledWith(LOCATION_ID);
      gateway.onApplicationShutdown();
    } finally {
      jest.useRealTimers();
    }
  });

  it("queues a drain recheck when terminal events overlap", async () => {
    const { gateway, operatingHours, kdsAuth } = createGateway();
    let resolveFirstCheck!: (hasActiveTickets: boolean) => void;
    operatingHours.hasActiveTickets
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveFirstCheck = resolve;
          }),
      )
      .mockResolvedValueOnce(false);
    (gateway as unknown as { drainingLocations: Set<string> }).drainingLocations.add(
      LOCATION_ID,
    );

    const firstCheck = (
      gateway as unknown as {
        finishDrainIfEmpty(locationId: string): Promise<void>;
      }
    ).finishDrainIfEmpty(LOCATION_ID);
    const queuedCheck = (
      gateway as unknown as {
        finishDrainIfEmpty(locationId: string): Promise<void>;
      }
    ).finishDrainIfEmpty(LOCATION_ID);
    resolveFirstCheck(true);
    await Promise.all([firstCheck, queuedCheck]);

    expect(operatingHours.hasActiveTickets).toHaveBeenCalledTimes(2);
    expect(kdsAuth.revokeLocationSessions).toHaveBeenCalledWith(LOCATION_ID);
  });

  it("hands a queued drain recheck across in-flight cleanup", async () => {
    const { gateway, operatingHours, kdsAuth } = createGateway();
    const loggerError = jest
      .spyOn(
        (gateway as unknown as { logger: { error(message: string): void } })
          .logger,
        "error",
      )
      .mockImplementation(() => undefined);
    let rejectFirstCheck!: (error: Error) => void;
    operatingHours.hasActiveTickets
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((_resolve, reject) => {
            rejectFirstCheck = reject;
          }),
      )
      .mockResolvedValueOnce(false);
    (gateway as unknown as { drainingLocations: Set<string> }).drainingLocations.add(
      LOCATION_ID,
    );

    const firstCheck = (
      gateway as unknown as {
        finishDrainIfEmpty(locationId: string): Promise<void>;
      }
    ).finishDrainIfEmpty(LOCATION_ID);
    await (
      gateway as unknown as {
        finishDrainIfEmpty(locationId: string): Promise<void>;
      }
    ).finishDrainIfEmpty(LOCATION_ID);
    rejectFirstCheck(new Error("temporary database failure"));
    await firstCheck;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(operatingHours.hasActiveTickets).toHaveBeenCalledTimes(2);
    expect(kdsAuth.revokeLocationSessions).toHaveBeenCalledWith(LOCATION_ID);
    loggerError.mockRestore();
  });

  it("does not query drain completion for non-terminal order events", () => {
    const { gateway, operatingHours } = createGateway();
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    } as never;
    (gateway as unknown as { drainingLocations: Set<string> }).drainingLocations.add(
      LOCATION_ID,
    );

    gateway.emitOrderEvent(
      LOCATION_ID,
      "22222222-2222-4222-8222-222222222222",
      "order.status_changed",
      { to_status: "PREPARING" },
    );

    expect(operatingHours.hasActiveTickets).not.toHaveBeenCalled();
  });
});
