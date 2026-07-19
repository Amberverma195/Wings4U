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
  const gateway = new RealtimeGateway(
    {} as never,
    prisma as never,
    {} as never,
    kdsPresence as never,
    {} as never,
  );

  return { gateway, prisma, kdsPresence };
}

function createSocket() {
  return {
    id: "socket-1",
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    leave: jest.fn(),
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
});
