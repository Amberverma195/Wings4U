jest.mock("../../database/prisma.service", () => ({
  PrismaService: class PrismaService {},
}));
jest.mock("../../common/utils/jwt-secret", () => ({
  getJwtSecret: () => "realtime-socket-spec-secret",
}));

import type { INestApplication } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { io, type Socket as ClientSocket } from "socket.io-client";
import { SessionValidator } from "../../common/session/session-validator.service";
import { signJwt } from "../../common/utils/jwt";
import { PrismaService } from "../../database/prisma.service";
import { KdsAuthService, KDS_STATION_COOKIE_NAME } from "../kds/kds-auth.service";
import { KdsOperatingHoursService } from "../kds/kds-operating-hours.service";
import { KdsPresenceService } from "../kds/kds-presence.service";
import { KdsService } from "../kds/kds.service";
import { PosAuthService } from "../pos/pos-auth.service";
import { RateLimiterService } from "../rate-limit/rate-limit.service";
import { RealtimeGateway } from "./realtime.gateway";

const SECRET = "realtime-socket-spec-secret";
const LOCATION_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ORDER_ID = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_CUSTOMER_ID = "55555555-5555-4555-8555-555555555555";
const KDS_SESSION_KEY = "kds-session-key";
const KDS_TOKEN = "kds-station-token";
// Every validation lookup is slower than a loopback round trip, so clients
// subscribing on `connect` reach the gateway while the handshake is pending.
const DB_LATENCY_MS = 60;

type OrderRow = {
  id: string;
  locationId: string;
  customerUserId: string;
  assignedDriverUserId: string | null;
  status: string;
  orderNumber: bigint;
  finalPayableCents: number;
  acceptedAt: Date | null;
  requiresManualReview: boolean;
};

type AuthSessionRow = {
  id: string;
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  locationId: string | null;
  isPosSession: boolean;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createFixtures() {
  const authSessions = new Map<string, AuthSessionRow>();
  const users = new Map([
    [CUSTOMER_ID, { id: CUSTOMER_ID, role: "CUSTOMER", isActive: true, employeeProfile: null }],
    [OTHER_CUSTOMER_ID, { id: OTHER_CUSTOMER_ID, role: "CUSTOMER", isActive: true, employeeProfile: null }],
  ]);
  const orders = new Map<string, OrderRow>(
    [
      [ORDER_ID, CUSTOMER_ID],
      [OTHER_ORDER_ID, OTHER_CUSTOMER_ID],
    ].map(([id, customerUserId], index) => [
      id,
      {
        id,
        locationId: LOCATION_ID,
        customerUserId,
        assignedDriverUserId: null,
        status: "PLACED",
        orderNumber: BigInt(1000 + index),
        finalPayableCents: 1899,
        acceptedAt: null,
        requiresManualReview: false,
      },
    ]),
  );
  const statusEvents: Array<{ fromStatus: string; toStatus: string }> = [];
  const kdsSessions = new Map([
    [
      KDS_SESSION_KEY,
      {
        sessionKey: KDS_SESSION_KEY,
        locationId: LOCATION_ID,
        tokenHash: bcrypt.hashSync(KDS_TOKEN, 4),
        revokedAt: null as Date | null,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    ],
  ]);
  const trustedIpRanges: string[] = [];

  const issueCustomerToken = (
    userId: string,
    sessionId: string,
    expiresInSeconds = 900,
  ) => {
    authSessions.set(sessionId, {
      id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      locationId: null,
      isPosSession: false,
    });
    return signJwt({ sub: userId, role: "CUSTOMER", sessionId }, SECRET, expiresInSeconds);
  };

  const prisma = {
    authSession: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; userId: string } }) => {
        await delay(DB_LATENCY_MS);
        const row = authSessions.get(where.id);
        if (!row || row.userId !== where.userId || row.revokedAt || row.expiresAt <= new Date()) {
          return null;
        }
        return { ...row, user: users.get(row.userId) ?? null };
      }),
    },
    kdsStationSession: {
      findUnique: jest.fn(async ({ where }: { where: { sessionKey: string } }) => {
        await delay(DB_LATENCY_MS);
        return kdsSessions.get(where.sessionKey) ?? null;
      }),
    },
    posStationSession: { findUnique: jest.fn(async () => null) },
    location: {
      findUnique: jest.fn(async ({ where }: { where: { code: string } }) =>
        where.code === "LON01" ? { id: LOCATION_ID, isActive: true } : null,
      ),
    },
    locationSettings: {
      findUnique: jest.fn(async () => ({ trustedIpRanges })),
      findMany: jest.fn(async () => [{ trustedIpRanges }]),
    },
    order: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = orders.get(where.id);
        return row ? { ...row } : null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = orders.get(where.id);
        if (!row) throw new Error("Order fixture missing");
        return { ...row, orderItems: [], cancellationRequests: [] };
      }),
      updateMany: jest.fn(
        async ({ where, data }: { where: { id: string; status: string }; data: Partial<OrderRow> }) => {
          const row = orders.get(where.id);
          if (!row || row.status !== where.status) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    orderStatusEvent: {
      create: jest.fn(async ({ data }: { data: { fromStatus: string; toStatus: string } }) => {
        statusEvents.push(data);
        return data;
      }),
    },
  };
  const transactional = Object.assign(prisma, {
    $transaction: jest.fn(async (work: (tx: typeof prisma) => Promise<unknown>) => work(prisma)),
  });

  return {
    prisma: transactional,
    orders,
    authSessions,
    kdsSessions,
    statusEvents,
    trustedIpRanges,
    issueCustomerToken,
  };
}

type Fixtures = ReturnType<typeof createFixtures>;

describe("RealtimeGateway over a real Socket.IO server", () => {
  let app: INestApplication;
  let gateway: RealtimeGateway;
  let kdsService: KdsService;
  let fixtures: Fixtures;
  let operatingHours: { mayOperate: jest.Mock; hasActiveTickets: jest.Mock };
  let presence: KdsPresenceService;
  let baseUrl: string;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    fixtures = createFixtures();
    operatingHours = {
      mayOperate: jest.fn().mockResolvedValue({ allowed: true, draining: false, closesAt: null }),
      hasActiveTickets: jest.fn().mockResolvedValue(false),
    };
    const prisma = fixtures.prisma as unknown as PrismaService;
    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        KdsPresenceService,
        { provide: PrismaService, useValue: prisma },
        { provide: SessionValidator, useValue: new SessionValidator(prisma) },
        {
          provide: KdsAuthService,
          useValue: new KdsAuthService(prisma, operatingHours as unknown as KdsOperatingHoursService),
        },
        { provide: PosAuthService, useValue: new PosAuthService(prisma) },
        { provide: KdsOperatingHoursService, useValue: operatingHours },
        {
          provide: RateLimiterService,
          useValue: {
            check: jest.fn().mockResolvedValue({ allowed: true, remaining: 10, resetAtMs: Date.now() + 60_000 }),
            peek: jest.fn().mockResolvedValue({ allowed: true, remaining: 10, resetAtMs: Date.now() + 60_000 }),
            acquireSlot: jest.fn().mockResolvedValue(true),
            releaseSlot: jest.fn().mockResolvedValue(undefined),
            refreshSlots: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0, "127.0.0.1");
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    gateway = app.get(RealtimeGateway);
    presence = app.get(KdsPresenceService);
    kdsService = new KdsService(
      prisma,
      {} as never,
      gateway,
      {} as never,
      {} as never,
      {} as never,
      { send: jest.fn().mockResolvedValue(undefined) } as never,
    );
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    gateway.onApplicationShutdown();
    await app.close();
  });

  function connect(options: {
    cookie?: string;
    surface?: "kds" | "pos";
    token?: () => string | null;
    headers?: Record<string, string>;
    reconnection?: boolean;
  }): ClientSocket {
    const client = io(baseUrl, {
      path: "/ws",
      transports: ["websocket"],
      forceNew: true,
      autoConnect: false,
      reconnection: options.reconnection ?? false,
      reconnectionDelay: 20,
      reconnectionDelayMax: 50,
      extraHeaders: {
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...options.headers,
      },
      auth: (callback) => {
        const token = options.token?.();
        callback({
          ...(options.surface ? { surface: options.surface } : {}),
          ...(token ? { token } : {}),
        });
      },
    });
    clients.push(client);
    return client;
  }

  /**
   * Mirrors both clients: subscriptions are emitted from every `connect`.
   * Resolves with the first batch of acknowledgements that completes; a batch
   * cut short by a dropped transport waits for the reconnect's batch.
   */
  function subscribeOnConnect(client: ClientSocket, channels: string[]) {
    return new Promise<unknown[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No subscription batch completed")), 3_000);
      client.on("connect", () => {
        Promise.all(
          channels.map((channel) => client.timeout(2_000).emitWithAck("subscribe", { channel })),
        ).then(
          (acks) => {
            clearTimeout(timer);
            resolve(acks);
          },
          () => undefined,
        );
      });
      client.connect();
    });
  }

  function nextEvent<T = unknown>(client: ClientSocket, event: string, timeoutMs = 2_000) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.off(event, onEvent);
        reject(new Error(`Timed out waiting for ${event}`));
      }, timeoutMs);
      const onEvent = (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      };
      client.once(event, onEvent);
    });
  }

  function serverRejection(client: ClientSocket) {
    return new Promise<{ error: unknown; reason: string }>((resolve, reject) => {
      let error: unknown = null;
      const timer = setTimeout(() => reject(new Error("Server did not reject the socket")), 2_000);
      client.on("error", (payload) => {
        error = payload;
      });
      client.once("disconnect", (reason) => {
        clearTimeout(timer);
        resolve({ error, reason });
      });
    });
  }

  const kdsCookie = `${KDS_STATION_COOKIE_NAME}=${encodeURIComponent(`${KDS_SESSION_KEY}:${KDS_TOKEN}`)}`;

  describe("website KDS station", () => {
    it("authenticates with the station cookie and joins the normalized location room", async () => {
      const kds = connect({ cookie: kdsCookie, surface: "kds" });

      await expect(subscribeOnConnect(kds, ["orders:LON01"])).resolves.toEqual([
        { subscribed: true, channel: `orders:${LOCATION_ID}` },
      ]);
      expect(presence.isHealthy(LOCATION_ID)).toBe(true);
      expect(fixtures.prisma.location.findUnique).toHaveBeenCalledWith({
        where: { code: "LON01" },
        select: { id: true, isActive: true },
      });
      expect(fixtures.prisma.authSession.findFirst).not.toHaveBeenCalled();
    });

    it("keeps station privileges when the browser also holds a customer access cookie", async () => {
      const customerToken = fixtures.issueCustomerToken(CUSTOMER_ID, "web-customer-session");
      const kds = connect({ cookie: `${kdsCookie}; access_token=${customerToken}`, surface: "kds" });

      await expect(subscribeOnConnect(kds, ["orders:LON01"])).resolves.toEqual([
        { subscribed: true, channel: `orders:${LOCATION_ID}` },
      ]);
    });

    it("rejects an invalid station cookie", async () => {
      const kds = connect({
        cookie: `${KDS_STATION_COOKIE_NAME}=${encodeURIComponent(`${KDS_SESSION_KEY}:wrong-token`)}`,
        surface: "kds",
      });
      const rejected = serverRejection(kds);
      kds.connect();

      await expect(rejected).resolves.toEqual({
        error: { message: "Invalid or expired session" },
        reason: "io server disconnect",
      });
    });

    it("denies the orders room from an untrusted network", async () => {
      fixtures.trustedIpRanges.push("198.51.100.10");
      const clientIp = "203.0.113.20";
      const kds = connect({
        cookie: kdsCookie,
        surface: "kds",
        headers: {
          "x-w4u-client-ip": clientIp,
          "x-w4u-client-ip-signature": createHmac("sha256", SECRET).update(clientIp).digest("hex"),
        },
      });

      await expect(subscribeOnConnect(kds, ["orders:LON01"])).resolves.toEqual([
        {
          subscribed: false,
          channel: "orders:LON01",
          error: "Store access is restricted to in-store network only",
        },
      ]);
    });

    it("denies the orders room outside scheduled operating hours", async () => {
      operatingHours.mayOperate.mockResolvedValue({ allowed: false, draining: false, closesAt: null });
      const kds = connect({ cookie: kdsCookie, surface: "kds" });

      await expect(subscribeOnConnect(kds, ["orders:LON01"])).resolves.toEqual([
        {
          subscribed: false,
          channel: "orders:LON01",
          error: "KDS is outside scheduled operating hours",
        },
      ]);
      expect(operatingHours.mayOperate).toHaveBeenCalledWith(LOCATION_ID);
    });

    it("retries the handshake after a transient validation failure without an unhandled rejection", async () => {
      const unhandled = jest.fn();
      process.on("unhandledRejection", unhandled);
      try {
        fixtures.prisma.kdsStationSession.findUnique.mockRejectedValueOnce(
          Object.assign(new Error("connection pool timeout"), { code: "P2024" }),
        );
        const kds = connect({ cookie: kdsCookie, surface: "kds", reconnection: true });
        const disconnects: string[] = [];
        kds.on("disconnect", (reason) => disconnects.push(reason));

        await expect(subscribeOnConnect(kds, ["orders:LON01"])).resolves.toEqual([
          { subscribed: true, channel: `orders:${LOCATION_ID}` },
        ]);
        expect(disconnects).toEqual(["transport close"]);
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    });

    it("resubscribes after a dropped transport and keeps receiving order events", async () => {
      const kds = connect({ cookie: kdsCookie, surface: "kds", reconnection: true });
      await subscribeOnConnect(kds, ["orders:LON01"]);

      const reconnected = new Promise<void>((resolve) => kds.once("connect", () => resolve()));
      gateway.server.sockets.sockets.get(kds.id!)!.conn.close();
      await reconnected;
      await delay(DB_LATENCY_MS * 3);

      const placed = nextEvent<{ event_type: string; payload: { order_id: string } }>(kds, "order.placed");
      gateway.emitOrderEvent(LOCATION_ID, ORDER_ID, "order.placed", { order_id: ORDER_ID });
      await expect(placed).resolves.toMatchObject({
        event_type: "order.placed",
        payload: { order_id: ORDER_ID },
      });
    });
  });

  describe("mobile customer", () => {
    it("authenticates auth.token and joins its order and chat rooms while validation is pending", async () => {
      const token = fixtures.issueCustomerToken(CUSTOMER_ID, "native-session");
      const mobile = connect({ token: () => token });

      await expect(subscribeOnConnect(mobile, [`order:${ORDER_ID}`, `chat:${ORDER_ID}`])).resolves.toEqual([
        { subscribed: true, channel: `order:${ORDER_ID}` },
        { subscribed: true, channel: `chat:${ORDER_ID}` },
      ]);
      expect(mobile.connected).toBe(true);
    });

    it.each([
      ["expired", () => signJwt({ sub: CUSTOMER_ID, role: "CUSTOMER", sessionId: "gone" }, SECRET, -60)],
      ["forged", () => signJwt({ sub: CUSTOMER_ID, role: "CUSTOMER", sessionId: "native" }, "wrong-secret", 900)],
      ["revoked", () => {
        const token = fixtures.issueCustomerToken(CUSTOMER_ID, "revoked-session");
        fixtures.authSessions.get("revoked-session")!.revokedAt = new Date();
        return token;
      }],
    ])("rejects an %s token without granting any room", async (_label, makeToken) => {
      const token = makeToken();
      const mobile = connect({ token: () => token });
      const rejected = serverRejection(mobile);
      const joined = jest.fn();
      mobile.on("connect", () => {
        mobile.timeout(1_000).emit("subscribe", { channel: `order:${ORDER_ID}` }, (_err: unknown, ack: unknown) => joined(ack));
      });
      mobile.connect();

      await expect(rejected).resolves.toEqual({
        error: { message: "Invalid or expired session" },
        reason: "io server disconnect",
      });
      expect(joined).not.toHaveBeenCalledWith(expect.objectContaining({ subscribed: true }));
    });

    it("denies another customer's order and chat rooms", async () => {
      const token = fixtures.issueCustomerToken(CUSTOMER_ID, "native-session");
      const mobile = connect({ token: () => token });

      await expect(
        subscribeOnConnect(mobile, [`order:${OTHER_ORDER_ID}`, `chat:${OTHER_ORDER_ID}`]),
      ).resolves.toEqual([
        { subscribed: false, channel: `order:${OTHER_ORDER_ID}`, error: "Insufficient permissions - order owner required" },
        { subscribed: false, channel: `chat:${OTHER_ORDER_ID}`, error: "Insufficient permissions - order owner required" },
      ]);
    });

    it("never grants station rooms to a customer token, even when it claims the KDS surface", async () => {
      const token = fixtures.issueCustomerToken(CUSTOMER_ID, "native-session");
      const mobile = connect({ token: () => token, surface: "kds" });

      await expect(
        subscribeOnConnect(mobile, ["orders:LON01", `drivers:${LOCATION_ID}`]),
      ).resolves.toEqual([
        { subscribed: false, channel: "orders:LON01", error: "Insufficient permissions - STAFF or ADMIN required" },
        { subscribed: false, channel: `drivers:${LOCATION_ID}`, error: "Insufficient permissions - STAFF or ADMIN required" },
      ]);
      expect(presence.isHealthy(LOCATION_ID)).toBe(false);
    });

    it("acknowledges a subscription that fails unexpectedly instead of leaving it pending", async () => {
      const token = fixtures.issueCustomerToken(CUSTOMER_ID, "native-session");
      fixtures.prisma.order.findUnique.mockRejectedValueOnce(new Error("query timeout"));
      const mobile = connect({ token: () => token });

      await expect(subscribeOnConnect(mobile, [`order:${ORDER_ID}`])).resolves.toEqual([
        { subscribed: false, channel: `order:${ORDER_ID}`, error: "Subscription temporarily unavailable" },
      ]);
      expect(mobile.connected).toBe(true);
    });

    it("revalidates outbound events so a revoked customer cannot receive private broadcasts on another API instance", async () => {
      const token = fixtures.issueCustomerToken(CUSTOMER_ID, "deleted-customer-session");
      const mobile = connect({ token: () => token });
      await subscribeOnConnect(mobile, [`order:${ORDER_ID}`]);
      const received = jest.fn(); mobile.on("order.status_changed", received);
      fixtures.authSessions.get("deleted-customer-session")!.revokedAt = new Date();
      const rejected = serverRejection(mobile);
      gateway.emitOrderEvent(LOCATION_ID, ORDER_ID, "order.status_changed", { to_status: "READY", private_data: "must not arrive" });
      await expect(rejected).resolves.toMatchObject({ reason: "io server disconnect" });
      expect(received).not.toHaveBeenCalled();
    });

    it("disconnects all local sockets for a deleted customer", async () => {
      const first = connect({ token: () => fixtures.issueCustomerToken(CUSTOMER_ID, "first-device") });
      const second = connect({ token: () => fixtures.issueCustomerToken(CUSTOMER_ID, "second-device") });
      await Promise.all([subscribeOnConnect(first, [`order:${ORDER_ID}`]), subscribeOnConnect(second, [`order:${ORDER_ID}`])]);
      const closed = [serverRejection(first), serverRejection(second)];
      gateway.disconnectCustomer(CUSTOMER_ID);
      for (const pending of closed) await expect(pending).resolves.toMatchObject({ error: { message: "Account deleted" }, reason: "io server disconnect" });
    });

    it("reconnects with a refreshed token instead of reusing the ended session", async () => {
      let currentToken = fixtures.issueCustomerToken(CUSTOMER_ID, "session-a");
      const mobile = connect({ token: () => currentToken });
      await subscribeOnConnect(mobile, [`order:${ORDER_ID}`]);

      fixtures.authSessions.get("session-a")!.revokedAt = new Date();
      const ended = serverRejection(mobile);
      gateway.disconnectSession("session-a");
      await expect(ended).resolves.toMatchObject({ reason: "io server disconnect" });

      const staleRejected = serverRejection(mobile);
      mobile.connect();
      await expect(staleRejected).resolves.toEqual({
        error: { message: "Invalid or expired session" },
        reason: "io server disconnect",
      });

      currentToken = fixtures.issueCustomerToken(CUSTOMER_ID, "session-b");
      const resubscribed = await new Promise<unknown>((resolve) => {
        mobile.once("connect", () => {
          void mobile.timeout(2_000).emitWithAck("subscribe", { channel: `order:${ORDER_ID}` }).then(resolve);
        });
        mobile.connect();
      });
      expect(resubscribed).toEqual({ subscribed: true, channel: `order:${ORDER_ID}` });
    });
  });

  describe("KDS accept reaches the customer's mobile app", () => {
    it("persists PREPARING before both clients receive order.accepted and order.status_changed", async () => {
      const token = fixtures.issueCustomerToken(CUSTOMER_ID, "native-session");
      const mobile = connect({ token: () => token });
      const kds = connect({ cookie: kdsCookie, surface: "kds" });
      await Promise.all([
        subscribeOnConnect(mobile, [`order:${ORDER_ID}`, `chat:${ORDER_ID}`]),
        subscribeOnConnect(kds, ["orders:LON01"]),
      ]);

      const statusSeenByMobile: string[] = [];
      for (const event of ["order.accepted", "order.status_changed"]) {
        mobile.on(event, () => statusSeenByMobile.push(fixtures.orders.get(ORDER_ID)!.status));
      }
      const mobileAccepted = nextEvent<{ payload: Record<string, unknown> }>(mobile, "order.accepted");
      const mobileStatus = nextEvent<{ payload: Record<string, unknown> }>(mobile, "order.status_changed");
      const kdsAccepted = nextEvent<{ payload: Record<string, unknown> }>(kds, "order.accepted");
      const kdsStatus = nextEvent<{ payload: Record<string, unknown> }>(kds, "order.status_changed");

      const accepted = await kdsService.acceptOrder(ORDER_ID, null, LOCATION_ID);

      expect(accepted.status).toBe("PREPARING");
      await expect(mobileAccepted).resolves.toMatchObject({
        payload: { order_id: ORDER_ID, from_status: "PLACED", to_status: "ACCEPTED" },
      });
      await expect(mobileStatus).resolves.toMatchObject({
        payload: { order_id: ORDER_ID, from_status: "ACCEPTED", to_status: "PREPARING" },
      });
      await expect(kdsAccepted).resolves.toMatchObject({ payload: { order_id: ORDER_ID } });
      await expect(kdsStatus).resolves.toMatchObject({ payload: { to_status: "PREPARING" } });
      expect(statusSeenByMobile).toEqual(["PREPARING", "PREPARING"]);
      expect(fixtures.statusEvents).toEqual([
        expect.objectContaining({ fromStatus: "PLACED", toStatus: "ACCEPTED" }),
        expect.objectContaining({ fromStatus: "ACCEPTED", toStatus: "PREPARING" }),
      ]);
    });

    it("does not deliver another customer's order events to the mobile app", async () => {
      const token = fixtures.issueCustomerToken(CUSTOMER_ID, "native-session");
      const mobile = connect({ token: () => token });
      await subscribeOnConnect(mobile, [`order:${ORDER_ID}`]);
      const leaked = jest.fn();
      mobile.on("order.accepted", leaked);

      await kdsService.acceptOrder(OTHER_ORDER_ID, null, LOCATION_ID);
      await delay(100);

      expect(leaked).not.toHaveBeenCalled();
    });
  });
});
