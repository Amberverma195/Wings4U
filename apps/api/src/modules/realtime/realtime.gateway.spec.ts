import { RealtimeGateway } from "./realtime.gateway";

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

function createGateway() {
  const prisma = {
    order: { findUnique: jest.fn() },
    location: {
      findUnique: jest.fn(),
    },
    locationSettings: {
      findUnique: jest.fn().mockResolvedValue({
        trustedIpRanges: ["127.0.0.1"],
      }),
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
  const kdsAuth = {};
  const sessionValidator = { resolve: jest.fn() };
  const gateway = new RealtimeGateway(
    sessionValidator as never,
    prisma as never,
    kdsAuth as never,
    kdsPresence as never,
    {} as never,
    operatingHours as never,
  );

  return { gateway, prisma, kdsPresence, operatingHours, sessionValidator };
}

function createSocket() {
  return {
    id: "socket-1",
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    handshake: {
      headers: {} as Record<string, string>,
      auth: {} as Record<string, unknown>,
      address: "127.0.0.1",
    },
  };
}

describe("RealtimeGateway mobile authentication", () => {
  const orderId = "22222222-2222-4222-8222-222222222222";
  const session = {
    userId: "customer-1", role: "CUSTOMER", sessionId: "native-session",
    isPosSession: false,
  };

  it.each(["auth", "header", "cookie"])("authenticates %s credentials and joins both owned order rooms", async source => {
    const { gateway, prisma, sessionValidator } = createGateway();
    const socket = createSocket();
    if (source === "auth") socket.handshake.auth.token = "native-token";
    if (source === "header") socket.handshake.headers.authorization = "Bearer native-token";
    if (source === "cookie") socket.handshake.headers.cookie = "access_token=native-token";
    sessionValidator.resolve.mockResolvedValue(session);
    prisma.order.findUnique.mockResolvedValue({ customerUserId: session.userId });
    await gateway.handleConnection(socket as never);
    for (const prefix of ["order", "chat"]) {
      expect(await gateway.handleSubscribe({ channel: `${prefix}:${orderId}` }, socket as never))
        .toEqual({ subscribed: true, channel: `${prefix}:${orderId}` });
    }
    expect(sessionValidator.resolve).toHaveBeenCalledWith("native-token");
    expect(socket.join).toHaveBeenCalledTimes(2);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it("subscribes while initial native session validation is still pending", async () => {
    const { gateway, prisma, sessionValidator } = createGateway();
    const socket = createSocket();
    socket.handshake.auth.token = "native-token";
    let finishConnection!: (value: typeof session) => void;
    sessionValidator.resolve.mockReturnValueOnce(new Promise(resolve => { finishConnection = resolve; }))
      .mockResolvedValue(session);
    prisma.order.findUnique.mockResolvedValue({ customerUserId: session.userId });
    const connecting = gateway.handleConnection(socket as never);
    try {
      expect(socket.data.accessToken).toBeUndefined();
      expect(await gateway.handleSubscribe({ channel: `order:${orderId}` }, socket as never))
        .toEqual({ subscribed: true, channel: `order:${orderId}` });
      expect(socket.disconnect).not.toHaveBeenCalled();
    } finally {
      finishConnection(session);
      await connecting;
    }
  });

  it("rejects expired native tokens and unauthenticated clients", async () => {
    const { gateway, sessionValidator } = createGateway();
    sessionValidator.resolve.mockResolvedValue(null);
    for (const token of [undefined, "expired-token"]) {
      const socket = createSocket();
      socket.handshake.auth.token = token;
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    }
  });

  it("denies another customer's order and chat, and revalidates expired subscriptions", async () => {
    const { gateway, prisma, sessionValidator } = createGateway();
    const socket = createSocket();
    socket.handshake.auth.token = "native-token";
    sessionValidator.resolve.mockResolvedValue(session);
    prisma.order.findUnique.mockResolvedValue({ customerUserId: "other-customer" });
    await gateway.handleConnection(socket as never);
    for (const prefix of ["order", "chat"]) {
      expect(await gateway.handleSubscribe({ channel: `${prefix}:${orderId}` }, socket as never))
        .toMatchObject({ subscribed: false, error: "Insufficient permissions - order owner required" });
    }
    sessionValidator.resolve.mockResolvedValue(null);
    expect(await gateway.handleSubscribe({ channel: `order:${orderId}` }, socket as never))
      .toMatchObject({ subscribed: false, error: "Not authenticated" });
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});

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

  it("rejects a station orders subscription outside the allowed store IP", async () => {
    const { gateway, prisma } = createGateway();
    const socket = createSocket();
    socket.handshake.address = "203.0.113.20";
    prisma.location.findUnique.mockResolvedValue({
      id: LOCATION_ID,
      isActive: true,
    });
    prisma.locationSettings.findUnique.mockResolvedValue({
      trustedIpRanges: ["198.51.100.10"],
    });
    jest
      .spyOn(gateway as never, "revalidateSocketUser" as never)
      .mockResolvedValue({
        userId: "kds-station:session-1",
        role: "KDS_STATION",
        stationLocationId: LOCATION_ID,
        isPosSession: false,
        sessionId: "kds:session-1",
      } as never);

    const result = await gateway.handleSubscribe(
      { channel: "orders:LON01" },
      socket as never,
    );

    expect(socket.join).not.toHaveBeenCalled();
    expect(result).toEqual({
      subscribed: false,
      channel: "orders:LON01",
      error: "Store access is restricted to in-store network only",
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

  it("keeps the KDS session connected while leaving live orders at closing", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-19T14:00:00.000Z"));
    try {
      const { gateway, prisma, kdsPresence, operatingHours } =
        createGateway();
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
      const controlEmit = jest.fn();
      gateway.server = {
        to: jest.fn().mockReturnValue({ emit: controlEmit }),
        sockets: { sockets: new Map([[socket.id, socket]]) },
      } as never;

      await gateway.handleSubscribe(
        { channel: "orders:LON01" },
        socket as never,
      );
      await jest.advanceTimersByTimeAsync(60_000);

      expect(operatingHours.hasActiveTickets).toHaveBeenCalledWith(LOCATION_ID);
      expect(controlEmit).toHaveBeenCalledWith("kds.schedule_closed", {
        location_id: LOCATION_ID,
      });
      expect(socket.leave).toHaveBeenCalledWith(`orders:${LOCATION_ID}`);
      expect(kdsPresence.markUnsubscribed).toHaveBeenCalledWith(
        LOCATION_ID,
        socket.id,
      );
      expect(socket.leave.mock.invocationCallOrder[0]).toBeLessThan(
        controlEmit.mock.invocationCallOrder[0],
      );
      expect(socket.disconnect).not.toHaveBeenCalled();
      gateway.onApplicationShutdown();
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps the location closing timer after the last KDS socket disconnects", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-19T14:00:00.000Z"));
    try {
      const { gateway, prisma, operatingHours } = createGateway();
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
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
        sockets: { sockets: new Map([[socket.id, socket]]) },
      } as never;

      await gateway.handleSubscribe(
        { channel: "orders:LON01" },
        socket as never,
      );
      gateway.handleDisconnect(socket as never);
      await jest.advanceTimersByTimeAsync(60_000);

      expect(operatingHours.hasActiveTickets).toHaveBeenCalledWith(LOCATION_ID);
      gateway.onApplicationShutdown();
    } finally {
      jest.useRealTimers();
    }
  });

  it("queues a drain recheck when terminal events overlap", async () => {
    const { gateway, operatingHours } = createGateway();
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
  });

  it("hands a queued drain recheck across in-flight cleanup", async () => {
    const { gateway, operatingHours } = createGateway();
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
