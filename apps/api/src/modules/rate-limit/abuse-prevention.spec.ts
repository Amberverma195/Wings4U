/**
 * Isolated abuse-prevention tests. Redis is stubbed and every repository is
 * mocked, so nothing here connects to production Redis or Postgres.
 */
jest.mock("../../database/prisma.service", () => ({
  PrismaService: class {
    constructor() {
      throw new Error("Production database forbidden");
    }
  },
}));
jest.mock("../../common/utils/jwt-secret", () => ({ getJwtSecret: () => "abuse-prevention-test-secret" }));

import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { ApiExceptionFilter } from "../../common/filters/api-exception.filter";
import { AuthController } from "../auth/auth.controller";
import { AuthService } from "../auth/auth.service";
import { CartController } from "../cart/cart.controller";
import { CartService } from "../cart/cart.service";
import { CatalogService } from "../catalog/catalog.service";
import { MenuController, catalogServerSignature } from "../catalog/menu.controller";
import { CheckoutService } from "../checkout/checkout.service";
import { buildCheckoutRequestFingerprint } from "../payments/checkout-cart-hash";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { ReviewsController } from "../reviews/reviews.controller";
import { ReviewsService } from "../reviews/reviews.service";
import { RedisService } from "../redis/redis.service";
import { SavedCartController } from "../saved-cart/saved-cart.controller";
import { SavedCartService } from "../saved-cart/saved-cart.service";
import { SUPPORT_TICKET_EXISTS, SupportService } from "../support/support.service";
import { RATE_LIMITS } from "./rate-limit.policies";
import { RateLimiterService } from "./rate-limit.service";

const LOCATION = "11111111-1111-4111-8111-111111111111";
const ORDER_A = "22222222-2222-4222-8222-222222222222";
const ORDER_B = "33333333-3333-4333-8333-333333333333";
const ITEM_A = "44444444-4444-4444-8444-444444444444";
const ITEM_B = "55555555-5555-4555-8555-555555555555";
const disconnectedRedis = { withClient: async () => null };

function memoryLimiter(): RateLimiterService {
  return new RateLimiterService(disconnectedRedis as never);
}

function quoteBody() {
  return { location_id: LOCATION, fulfillment_type: "PICKUP" as const, items: [{ menu_item_id: ITEM_A, quantity: 1 }] };
}

function requester(ip: string, userId?: string, guestToken?: string) {
  return {
    ip,
    headers: {},
    socket: { remoteAddress: ip },
    locationId: LOCATION,
    locationRef: LOCATION,
    user: userId ? { userId, role: "CUSTOMER" } : undefined,
    cookies: guestToken ? { w4u_guest_cart: guestToken } : {},
  };
}

describe("RateLimiterService windows, fallback and slots", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("allows requests under a limit, rejects the next one, and allows again after the window", async () => {
    jest.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    const limiter = memoryLimiter();
    await expect(limiter.check("window", 2, 1_000)).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(limiter.check("window", 2, 1_000)).resolves.toMatchObject({ allowed: true, remaining: 0 });
    const denied = await limiter.check("window", 2, 1_000);
    expect(denied).toMatchObject({ allowed: false, remaining: 0 });
    expect(denied.resetAtMs).toBeGreaterThan(Date.now());
    jest.advanceTimersByTime(1_001);
    await expect(limiter.check("window", 2, 1_000)).resolves.toMatchObject({ allowed: true });
  });

  it("does not let concurrent checks exceed the limit or share another key's counter", async () => {
    const limiter = memoryLimiter();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => limiter.check("shared", 10, 60_000)),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(10);
    expect(results.filter((result) => !result.allowed)).toHaveLength(15);
    await expect(limiter.check("someone-else", 10, 60_000)).resolves.toMatchObject({ allowed: true, remaining: 9 });
  });

  it("peeks without consuming a hit and clear resets a window", async () => {
    const limiter = memoryLimiter();
    await expect(limiter.peek("peek", 1, 60_000)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.peek("peek", 1, 60_000)).resolves.toMatchObject({ allowed: true });
    await limiter.check("peek", 1, 60_000);
    await expect(limiter.peek("peek", 1, 60_000)).resolves.toMatchObject({ allowed: false });
    await limiter.clear("peek");
    await expect(limiter.check("peek", 1, 60_000)).resolves.toMatchObject({ allowed: true });
  });

  it("keeps enforcing from memory when Redis fails and does not retry Redis during the backoff", async () => {
    let calls = 0;
    const limiter = new RateLimiterService({
      withClient: async () => {
        calls += 1;
        throw new Error("redis unavailable");
      },
    } as never);
    await expect(limiter.check("fallback", 1, 60_000)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.check("fallback", 1, 60_000)).resolves.toMatchObject({ allowed: false });
    expect(calls).toBe(1);
  });

  it("caps concurrent slots, frees them on release, and expires a slot whose holder crashed", async () => {
    jest.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    const limiter = memoryLimiter();
    expect(await limiter.acquireSlot("sockets", "a", 1, 1_000)).toBe(true);
    expect(await limiter.acquireSlot("sockets", "a", 1, 1_000)).toBe(true);
    expect(await limiter.acquireSlot("sockets", "b", 1, 1_000)).toBe(false);
    await limiter.releaseSlot("sockets", "a");
    expect(await limiter.acquireSlot("sockets", "b", 1, 1_000)).toBe(true);
    jest.advanceTimersByTime(1_001);
    expect(await limiter.acquireSlot("sockets", "c", 1, 1_000)).toBe(true);
  });
});

describe("auth abuse limits (no database)", () => {
  let app: INestApplication;
  let auth: Record<string, jest.Mock>;
  const previousProxyRanges = process.env.TRUSTED_PROXY_IP_RANGES;

  beforeAll(async () => {
    process.env.TRUSTED_PROXY_IP_RANGES = "127.0.0.1";
    auth = {
      loginWithPassword: jest.fn(),
      signupWithPassword: jest.fn(async () => ({ otpSent: true, email: "person@example.com", expiresInSeconds: 300, retryAfterSeconds: 30 })),
      requestPasswordReset: jest.fn(async () => ({ otpSent: true, expiresInSeconds: 300, email: "person@example.com" })),
      resetPassword: jest.fn(async () => ({ accessToken: "access", refreshToken: "refresh", csrfToken: "csrf", user: { id: "user", role: "CUSTOMER", displayName: "Person" }, profileComplete: true, needsProfileCompletion: false })),
      refresh: jest.fn(async () => ({ accessToken: "access", refreshToken: "refresh-2", csrfToken: "csrf" })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: RedisService, useValue: disconnectedRedis },
        RateLimiterService,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.use(cookieParser());
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    process.env.TRUSTED_PROXY_IP_RANGES = previousProxyRanges;
    await app.close();
  });

  beforeEach(() => {
    for (const fn of Object.values(auth)) fn.mockClear();
  });

  function post(path: string, body: Record<string, unknown>, ip: string) {
    return request(app.getHttpServer()).post(path).set("X-Forwarded-For", ip).send(body);
  }

  it("locks an identity after repeated failures without revealing whether it exists, including from another IP", async () => {
    auth.loginWithPassword.mockRejectedValue(new UnauthorizedException("Invalid phone/email or password"));
    const failures = RATE_LIMITS.loginIdentityFailures.limit;
    const attempt = (identifier: string, ip: string) => post("/api/v1/auth/login", { identifier, password: "wrong-password" }, ip);
    const first = await attempt("Person@Example.com", "203.0.113.10");
    for (let i = 1; i < failures; i += 1) await attempt("person@example.com", "203.0.113.10");
    const otherAccount = await attempt("other@example.com", "203.0.113.10");
    const lockedSameIp = await attempt("person@example.com", "203.0.113.10");
    const lockedOtherIp = await attempt("person@example.com", "203.0.113.11");

    expect(first.status).toBe(401);
    expect(first.body.errors[0].message).toBe("Invalid phone/email or password");
    expect(otherAccount.status).toBe(401);
    expect(otherAccount.body.errors[0].message).toBe(first.body.errors[0].message);
    expect(lockedSameIp.status).toBe(429);
    expect(lockedSameIp.headers["retry-after"]).toMatch(/^\d+$/);
    expect(lockedSameIp.body.errors[0]).toMatchObject({
      code: "RATE_LIMITED",
      retry_after_seconds: Number(lockedSameIp.headers["retry-after"]),
    });
    expect(JSON.stringify(lockedSameIp.body)).not.toContain("person@example.com");
    expect(lockedOtherIp.status).toBe(429);
    expect(auth.loginWithPassword).toHaveBeenCalledTimes(failures + 1);
  });

  it("clears an identity failure budget after a successful sign-in", async () => {
    let calls = 0;
    auth.loginWithPassword.mockImplementation(async () => {
      calls += 1;
      if (calls === 5) {
        return { kind: "session", bundle: { accessToken: "access", refreshToken: "refresh", csrfToken: "csrf", user: { id: "user", role: "CUSTOMER", displayName: "Person" }, profileComplete: true, needsProfileCompletion: false } };
      }
      throw new UnauthorizedException("Invalid phone/email or password");
    });
    const attempt = () => post("/api/v1/auth/login", { identifier: "cleared@example.com", password: "Example123!" }, "203.0.113.12");
    for (let i = 0; i < 4; i += 1) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(200);
    for (let i = 0; i < RATE_LIMITS.loginIdentityFailures.limit; i += 1) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });

  it("keeps the signup IP budget when every request rotates its device id and email", async () => {
    const limit = RATE_LIMITS.signupIpHourly.limit;
    for (let i = 0; i < limit; i += 1) {
      const response = await post("/api/v1/auth/signup", {
        full_name: "Test Customer", phone: "5195550100", email: `signup-${i}@example.com`, password: "Example123!", confirm_password: "Example123!",
      }, "203.0.113.20").set("X-W4U-Signup-Device", `device-${i}-0123456789abcdef`);
      expect(response.status).toBe(200);
    }
    const blocked = await post("/api/v1/auth/signup", {
      full_name: "Test Customer", phone: "5195550101", email: "signup-new@example.com", password: "Example123!", confirm_password: "Example123!",
    }, "203.0.113.20").set("X-W4U-Signup-Device", "device-new-0123456789abcdef");
    expect(blocked.status).toBe(429);
    expect(blocked.body.errors[0].message).toContain("this network");
    expect(auth.signupWithPassword).toHaveBeenCalledTimes(limit);
    const otherNetwork = await post("/api/v1/auth/signup", {
      full_name: "Test Customer", phone: "5195550102", email: "signup-other-network@example.com", password: "Example123!", confirm_password: "Example123!",
    }, "203.0.113.21").set("X-W4U-Signup-Device", "device-other-0123456789abcdef");
    expect(otherNetwork.status).toBe(200);
  });

  it("still enforces the device budget for a client that keeps its device id", async () => {
    const limit = RATE_LIMITS.signupDevice.limit;
    for (let i = 0; i < limit; i += 1) {
      expect((await post("/api/v1/auth/signup", {
        full_name: "Test Customer", phone: "5195550103", email: `device-${i}@example.com`, password: "Example123!", confirm_password: "Example123!",
      }, "203.0.113.22").set("X-W4U-Signup-Device", "same-device-0123456789")).status).toBe(200);
    }
    const blocked = await post("/api/v1/auth/signup", {
      full_name: "Test Customer", phone: "5195550104", email: "device-extra@example.com", password: "Example123!", confirm_password: "Example123!",
    }, "203.0.113.22").set("X-W4U-Signup-Device", "same-device-0123456789");
    expect(blocked.status).toBe(429);
    expect(blocked.body.errors[0].message).toContain("this device");
  });

  it("limits password-reset requests per identifier and per IP before any lookup", async () => {
    const perIdentity = RATE_LIMITS.passwordResetRequestIdentity.limit;
    for (let i = 0; i < perIdentity; i += 1) {
      expect((await post("/api/v1/auth/password-reset/request", { identifier: "Reset@Example.com" }, "203.0.113.30")).status).toBe(200);
    }
    const locked = await post("/api/v1/auth/password-reset/request", { identifier: "reset@example.com" }, "203.0.113.30");
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toMatch(/^\d+$/);
    expect((await post("/api/v1/auth/password-reset/request", { identifier: "different@example.com" }, "203.0.113.30")).status).toBe(200);
    expect(auth.requestPasswordReset).toHaveBeenCalledTimes(perIdentity + 1);

    auth.requestPasswordReset.mockClear();
    const perIp = RATE_LIMITS.passwordResetRequestIp.limit;
    for (let i = 0; i < perIp; i += 1) {
      expect((await post("/api/v1/auth/password-reset/request", { identifier: `rotate-${i}@example.com` }, "203.0.113.31")).status).toBe(200);
    }
    expect((await post("/api/v1/auth/password-reset/request", { identifier: "rotate-new@example.com" }, "203.0.113.31")).status).toBe(429);
    expect(auth.requestPasswordReset).toHaveBeenCalledTimes(perIp);
  });

  it("adds an IP budget to reset confirmation without replacing the per-code attempt counter", async () => {
    const body = (identifier: string) => ({ identifier, otp_code: "123456", new_password: "Example123!", confirm_password: "Example123!" });
    const perIdentity = RATE_LIMITS.passwordResetConfirmIdentity.limit;
    for (let i = 0; i < perIdentity; i += 1) {
      expect((await post("/api/v1/auth/password-reset/confirm", body("confirm@example.com"), "203.0.113.32")).status).toBe(200);
    }
    expect((await post("/api/v1/auth/password-reset/confirm", body("confirm@example.com"), "203.0.113.32")).status).toBe(429);
    expect(auth.resetPassword).toHaveBeenCalledTimes(perIdentity);

    auth.resetPassword.mockClear();
    const perIp = RATE_LIMITS.passwordResetConfirmIp.limit;
    for (let i = 0; i < perIp; i += 1) {
      expect((await post("/api/v1/auth/password-reset/confirm", body(`confirm-${i}@example.com`), "203.0.113.34")).status).toBe(200);
    }
    expect((await post("/api/v1/auth/password-reset/confirm", body("confirm-new@example.com"), "203.0.113.34")).status).toBe(429);
    expect(auth.resetPassword).toHaveBeenCalledTimes(perIp);
  });

  it("throttles one refresh token without clearing cookies or consuming another token's budget", async () => {
    const limit = RATE_LIMITS.refreshToken.limit;
    for (let i = 0; i < limit; i += 1) {
      expect((await post("/api/v1/auth/refresh", { refresh_token: "token-a" }, "203.0.113.40")).status).toBe(200);
    }
    const blocked = await post("/api/v1/auth/refresh", { refresh_token: "token-a" }, "203.0.113.40");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["set-cookie"]).toBeUndefined();
    expect((await post("/api/v1/auth/refresh", { refresh_token: "token-b" }, "203.0.113.40")).status).toBe(200);
  });

  it("stops repeated invalid refresh tokens with a 429 that does not clear cookies", async () => {
    auth.refresh.mockImplementation(async (token: string) => {
      if (token.startsWith("bad-")) throw new UnauthorizedException("Invalid or expired refresh token");
      return { accessToken: "access", refreshToken: "refresh-2", csrfToken: "csrf" };
    });
    const limit = RATE_LIMITS.refreshInvalidIp.limit;
    for (let i = 0; i < limit; i += 1) {
      const response = await post("/api/v1/auth/refresh", { refresh_token: `bad-${i}` }, "203.0.113.41");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ refreshed: false });
    }
    const blocked = await post("/api/v1/auth/refresh", { refresh_token: "bad-final" }, "203.0.113.41");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["set-cookie"]).toBeUndefined();
    expect(auth.refresh).toHaveBeenCalledTimes(limit);
  });
});

describe("cart, menu and review request budgets", () => {
  it("gives every customer their own quote budget on a shared IP and only an IP budget to cookieless guests", async () => {
    const quotes = { computeQuote: jest.fn(async () => ({ total: 1 })) };
    const controller = new CartController(quotes as unknown as CartService, memoryLimiter());
    const send = (ip: string, userId?: string, guestToken?: string) =>
      controller.quote(quoteBody(), requester(ip, userId, guestToken) as never);
    const perCustomer = RATE_LIMITS.cartQuoteIdentity.limit;
    for (let i = 0; i < perCustomer; i += 1) await send("198.51.100.10", "customer-a");
    for (let i = 0; i < perCustomer; i += 1) await send("198.51.100.10", "customer-b");
    await expect(send("198.51.100.10", "customer-a")).rejects.toMatchObject({ status: 429 });
    await expect(send("198.51.100.10", "customer-c")).resolves.toEqual({ total: 1 });
    const guest = "ab".repeat(32);
    for (let i = 0; i < perCustomer; i += 1) await send("198.51.100.11", undefined, guest);
    await expect(send("198.51.100.11", undefined, guest)).rejects.toMatchObject({ status: 429 });
    await expect(send("198.51.100.11", undefined, "cd".repeat(32))).resolves.toEqual({ total: 1 });

    const anonymous = RATE_LIMITS.cartQuoteIp.limit;
    for (let i = 0; i < anonymous; i += 1) await send("198.51.100.12");
    await expect(send("198.51.100.12")).rejects.toMatchObject({ status: 429 });
    expect(quotes.computeQuote).toHaveBeenCalledTimes(perCustomer * 3 + 2 + anonymous);
  });

  it("keeps saved-cart reads, writes and merges on separate budgets and stable guest ids", async () => {
    const saved = {
      getForRequest: jest.fn(async () => ({ snapshot: { items: [] }, cookies: [] })),
      saveForRequest: jest.fn(async () => ({ snapshot: { items: [] }, cookies: [] })),
      clearForRequest: jest.fn(async () => ({ cookies: [] })),
      mergeOnLogin: jest.fn(async () => ({ snapshot: null, mergeOutcome: "no_guest", cookies: [] })),
    };
    const controller = new SavedCartController(saved as unknown as SavedCartService, memoryLimiter());
    const response = { setHeader: jest.fn() };
    const write = (userId: string) => controller.saveMyCart({ items: [], fulfillment_type: "PICKUP", location_timezone: "America/Toronto", driver_tip_percent: "none" } as never, requester("198.51.100.20", userId) as never, response as never);
    for (let i = 0; i < RATE_LIMITS.savedCartWriteIdentity.limit; i += 1) await write("customer-a");
    await expect(write("customer-a")).rejects.toMatchObject({ status: 429 });
    await expect(controller.getMyCart(requester("198.51.100.20", "customer-a") as never, response as never)).resolves.toEqual({ items: [] });
    await expect(write("customer-b")).resolves.toEqual({ items: [] });
    const merge = () => controller.mergeOnLogin(requester("198.51.100.21", "customer-a") as never, response as never);
    for (let i = 0; i < RATE_LIMITS.savedCartMergeIdentity.limit; i += 1) await merge();
    await expect(merge()).rejects.toMatchObject({ status: 429 });
    expect(saved.saveForRequest).toHaveBeenCalledTimes(RATE_LIMITS.savedCartWriteIdentity.limit + 1);
  });

  it("limits direct menu traffic per IP while cached server fetches share a server budget", async () => {
    const catalog = { getMenu: jest.fn(async () => ({ ok: true })), getWingFlavours: jest.fn(async () => []) };
    const controller = new MenuController(catalog as unknown as CatalogService, memoryLimiter());
    const call = (ip: string, scheduledFor: string, server = false) => controller.getMenu(
      { location_id: LOCATION, fulfillment_type: "PICKUP", scheduled_for: scheduledFor },
      { ...requester(ip), headers: server ? { "x-w4u-catalog-server": catalogServerSignature() } : {} } as never,
    );
    for (let i = 0; i < RATE_LIMITS.menuIp.limit; i += 1) await call("198.51.100.30", `2026-10-21T18:${String(i % 60).padStart(2, "0")}:00.000Z`);
    await expect(call("198.51.100.30", "2026-10-21T19:00:00.000Z")).rejects.toMatchObject({ status: 429 });
    await expect(call("198.51.100.31", "2026-10-21T19:00:00.000Z")).resolves.toEqual({ ok: true });
    for (let i = 0; i < RATE_LIMITS.menuIp.limit + 1; i += 1) {
      await expect(call("198.51.100.30", "2026-10-21T20:00:00.000Z", true)).resolves.toEqual({ ok: true });
    }
  });

  it("shares one menu build across concurrent cache misses", async () => {
    let builds = 0;
    const catalog = new CatalogService({
      location: { findUnique: jest.fn(async () => { builds += 1; await new Promise((resolve) => setTimeout(resolve, 15)); throw new Error("stop"); }) },
    } as never, { getMenuBase: async () => ({ key: "menu-key", value: null }), setMenuBase: async () => undefined } as never);
    await Promise.allSettled([
      catalog.getMenu(LOCATION, "PICKUP"),
      catalog.getMenu(LOCATION, "PICKUP"),
    ]);
    expect(builds).toBe(1);
  });

  it("limits review submissions per customer without affecting another customer", async () => {
    const reviews = { createReview: jest.fn(async () => ({ id: "review" })) };
    const controller = new ReviewsController(reviews as unknown as ReviewsService, memoryLimiter());
    const submit = (userId: string, itemId: string) => controller.create(ORDER_A, itemId, { rating: 5 } as never, { userId, role: "CUSTOMER" } as never);
    for (let i = 0; i < RATE_LIMITS.reviewCustomer.limit; i += 1) await submit("customer-a", i % 2 === 0 ? ITEM_A : ITEM_B);
    await expect(submit("customer-a", ITEM_A)).rejects.toMatchObject({ status: 429 });
    await expect(submit("customer-b", ITEM_A)).resolves.toEqual({ id: "review" });
    expect(reviews.createReview).toHaveBeenCalledTimes(RATE_LIMITS.reviewCustomer.limit + 1);
  });
});

describe("support ticket ownership and checkout order allowance", () => {
  function supportHarness() {
    const tickets: Array<Record<string, unknown>> = [];
    let chain = Promise.resolve();
    let waitingForBothPrechecks: (() => void) | null = null;
    const bothPrechecks = new Promise<void>((resolve) => { waitingForBothPrechecks = resolve; });
    let prechecks = 0;
    const findFirst = jest.fn(async ({ where }: { where: { orderId?: string; customerUserId?: string } }) => {
      const found = tickets.find((ticket) => ticket.orderId === where.orderId && ticket.customerUserId === where.customerUserId) ?? null;
      if (!found && where.orderId) {
        prechecks += 1;
        if (prechecks === 2) waitingForBothPrechecks?.();
        else if (prechecks < 2) await bothPrechecks;
      }
      return found;
    });
    const prisma: any = {
      order: { findUnique: jest.fn(async () => ({ id: ORDER_A, locationId: LOCATION, customerUserId: "customer-a" })), findFirst: jest.fn(async () => ({ id: ORDER_A, orderNumber: 1001n })) },
      supportTicket: {
        findUnique: jest.fn(async () => ({ id: "ticket-1", locationId: LOCATION, customerUserId: "customer-a", orderId: null })),
        findFirst,
        update: jest.fn(async () => ({})),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `ticket-${tickets.length + 1}`, status: "OPEN", createdAt: new Date(), updatedAt: new Date(), ...data };
          tickets.push(row);
          return row;
        }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      supportTicketEvent: { create: jest.fn(async () => ({})) },
      supportTicketMessage: { create: jest.fn(async () => ({ id: "message", supportTicketId: "ticket-1", authorUserId: "customer-a", messageBody: "Hello", isInternalNote: false, createdAt: new Date() })) },
      $transaction: jest.fn(async (work: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[]) => {
        if (Array.isArray(work)) return Promise.all(work);
        let release = () => {};
        const tx: any = {
          $queryRaw: async () => {
            const previous = chain;
            chain = new Promise<void>((resolve) => { release = resolve; });
            await previous;
          },
          supportTicket: prisma.supportTicket,
          supportTicketEvent: prisma.supportTicketEvent,
          supportTicketMessage: prisma.supportTicketMessage,
          order: prisma.order,
        };
        try { return await work(tx); } finally { release(); }
      }),
    };
    return { prisma, tickets, service: new SupportService(prisma as never, memoryLimiter()) };
  }

  const createInput = (orderId?: string, customerUserId = "customer-a") => ({
    locationId: LOCATION, customerUserId, ticketType: "COLD_FOOD", subject: "Cold wings", description: "The wings arrived cold.",
    createdSource: "CUSTOMER_APP", orderId,
  });

  it("allows one ticket per order across every status, and another ticket for a different order", async () => {
    const { prisma, service } = supportHarness();
    prisma.supportTicket.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(service.createTicket(createInput(ORDER_A))).resolves.toMatchObject({ id: "ticket-1" });
    prisma.supportTicket.findFirst.mockResolvedValue({ id: "ticket-1", status: "RESOLVED", createdAt: new Date("2026-01-01T00:00:00Z") });
    await expect(service.createTicket(createInput(ORDER_A))).rejects.toMatchObject({
      status: 409,
      response: { code: SUPPORT_TICKET_EXISTS, detail: { ticket_id: "ticket-1", status: "RESOLVED" } },
    });
    prisma.order.findUnique.mockResolvedValue({ id: ORDER_B, locationId: LOCATION, customerUserId: "customer-a" });
    prisma.supportTicket.findFirst.mockResolvedValue(null);
    await expect(service.createTicket(createInput(ORDER_B))).resolves.toMatchObject({ order_id: ORDER_B });
    expect(prisma.supportTicket.create).toHaveBeenCalledTimes(2);
  });

  it("rejects a second order ticket and a conflicting admin link when the two requests race", async () => {
    const harness = supportHarness();
    const results = await Promise.allSettled([
      harness.service.createTicket(createInput(ORDER_A)),
      harness.service.createTicket(createInput(ORDER_A)),
    ]);
    expect(harness.tickets).toHaveLength(1);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.getResponse()).toMatchObject({ code: SUPPORT_TICKET_EXISTS, detail: { ticket_id: "ticket-1" } });

    harness.prisma.supportTicket.findUnique.mockResolvedValue({ id: "ticket-unlinked", locationId: LOCATION, customerUserId: "customer-a", orderId: null });
    harness.prisma.supportTicket.findFirst.mockResolvedValue({ id: "ticket-1", status: "CLOSED", createdAt: new Date() });
    await expect(harness.service.linkOrder("ticket-unlinked", ORDER_A, "admin", LOCATION)).rejects.toMatchObject({
      status: 409, response: { code: SUPPORT_TICKET_EXISTS, detail: { ticket_id: "ticket-1" } },
    });
    expect(harness.prisma.supportTicket.updateMany).not.toHaveBeenCalled();
  });

  it("still allows general tickets up to their own daily budget", async () => {
    const { service, prisma } = supportHarness();
    for (let i = 0; i < RATE_LIMITS.supportGeneralTicketCustomer.limit; i += 1) {
      await expect(service.createTicket(createInput())).resolves.toMatchObject({ order_id: null });
    }
    await expect(service.createTicket(createInput())).rejects.toMatchObject({ status: 429 });
    expect(prisma.supportTicket.create).toHaveBeenCalledTimes(RATE_LIMITS.supportGeneralTicketCustomer.limit);
    await expect(service.createTicket({ ...createInput(), customerUserId: "customer-b" })).resolves.toMatchObject({ order_id: null });
  });

  it("limits customer messages per ticket while a larger staff budget remains usable", async () => {
    const { service, prisma } = supportHarness();
    const send = (role: "CUSTOMER" | "ADMIN", userId: string) => service.addMessage("ticket-1", userId, "Following up", false, role, LOCATION);
    for (let i = 0; i < RATE_LIMITS.supportMessageCustomerTicket.limit; i += 1) await send("CUSTOMER", "customer-a");
    await expect(send("CUSTOMER", "customer-a")).rejects.toMatchObject({ status: 429 });
    await expect(send("ADMIN", "admin")).resolves.toMatchObject({ id: "message" });
    expect(prisma.supportTicketMessage.create).toHaveBeenCalledTimes(RATE_LIMITS.supportMessageCustomerTicket.limit + 1);
  });

  function checkoutHarness(userLookup: () => Promise<unknown>) {
    const orders: Date[] = [];
    let chain = Promise.resolve();
    const fingerprint = buildCheckoutRequestFingerprint({ location_id: LOCATION, fulfillment_type: "PICKUP", items: [] });
    const prisma: any = {
      checkoutIdempotencyKey: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
      order: {
        findMany: jest.fn(async ({ where, take }: { where: { placedAt: { gte: Date } }; take: number }) =>
          orders.filter((placedAt) => placedAt.getTime() >= where.placedAt.gte.getTime()).sort((a, b) => b.getTime() - a.getTime()).slice(0, take).map((placedAt) => ({ placedAt }))),
        findUnique: jest.fn(async () => ({ id: "order-1", orderNumber: 42n, orderItems: [], statusEvents: [] })),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        let release = () => {};
        const tx: any = {
          checkoutIdempotencyKey: prisma.checkoutIdempotencyKey,
          order: prisma.order,
          user: { findUnique: jest.fn(userLookup) },
          $executeRaw: async () => {
            const previous = chain;
            chain = new Promise<void>((resolve) => { release = resolve; });
            await previous;
          },
        };
        try { return await fn(tx); } finally { release(); }
      }),
    };
    return { prisma, orders, fingerprint, service: new CheckoutService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, memoryLimiter()) };
  }

  const place = (service: CheckoutService, userId: string, idempotencyKey: string) => service.placeOrder({
    userId, locationId: LOCATION, fulfillmentType: "PICKUP", items: [], idempotencyKey,
  });

  it("does not spend an order allowance on a replay or a failed validation, and serializes concurrent creates", async () => {
    const replay = checkoutHarness(async () => { throw new Error("replay must not create"); });
    replay.prisma.checkoutIdempotencyKey.findUnique.mockResolvedValue({ userId: "customer-a", locationId: LOCATION, orderId: "order-1", requestFingerprint: replay.fingerprint });
    await expect(place(replay.service, "customer-a", "same-key")).resolves.toMatchObject({ id: "order-1", order_number: 42 });
    expect(replay.prisma.$transaction).not.toHaveBeenCalled();
    expect(replay.prisma.order.findMany).not.toHaveBeenCalled();

    const failures = checkoutHarness(async () => null);
    for (let i = 0; i < RATE_LIMITS.checkoutAttemptCustomer.limit; i += 1) {
      await expect(place(failures.service, "customer-a", `failed-${i}`)).rejects.toMatchObject({ status: 404 });
    }
    await expect(place(failures.service, "customer-a", "failed-extra")).rejects.toMatchObject({ status: 429 });
    expect(failures.orders).toHaveLength(0);
    await expect(place(failures.service, "customer-b", "other-customer")).rejects.toMatchObject({ status: 404 });

    let orders: Date[] = [];
    const racing = checkoutHarness(async () => { orders.push(new Date()); throw new Error("STOP_AFTER_ALLOWANCE"); });
    orders = racing.orders;
    const results = await Promise.allSettled(Array.from({ length: RATE_LIMITS.checkoutOrdersCustomer.limit + 1 }, (_, index) => place(racing.service, "customer-a", `race-${index}`)));
    const denied = results.filter((result) => result.status === "rejected" && result.reason?.status === 429);
    const allowed = results.filter((result) => result.status === "rejected" && result.reason?.message === "STOP_AFTER_ALLOWANCE");
    expect(racing.orders).toHaveLength(RATE_LIMITS.checkoutOrdersCustomer.limit);
    expect(allowed).toHaveLength(RATE_LIMITS.checkoutOrdersCustomer.limit);
    expect(denied).toHaveLength(1);
  });

  it("counts recent orders from either idempotency key toward the rolling and daily ceilings", async () => {
    const recent = checkoutHarness(async () => { throw new Error("must not start a fourth order"); });
    const now = Date.now();
    recent.orders.push(new Date(now - 60_000), new Date(now - 120_000), new Date(now - 180_000));
    await expect(place(recent.service, "customer-a", "fourth-key")).rejects.toMatchObject({ status: 429 });

    const daily = checkoutHarness(async () => ({ id: "customer-a", isActive: true, displayName: "A" }));
    for (let i = 0; i < RATE_LIMITS.checkoutOrdersCustomerDaily.limit; i += 1) daily.orders.push(new Date(now - 60 * 60_000));
    const blocked = await place(daily.service, "customer-a", "daily-key").catch((error) => error);
    expect(blocked.status).toBe(429);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(60 * 60);
  });
});

describe("realtime connection and subscription budgets", () => {
  function gatewayFor(ranges: unknown[] = []) {
    const limiter = memoryLimiter();
    const gateway = new RealtimeGateway(
      {} as never,
      { locationSettings: { findMany: async () => ranges.map((trustedIpRanges) => ({ trustedIpRanges })) } } as never,
      {} as never,
      { markDisconnected: () => undefined, markSubscribed: () => undefined, markUnsubscribed: () => undefined } as never,
      {} as never, {} as never, limiter,
    );
    const engine: { opts: { allowRequest?: (req: unknown, callback: (error: string | null, ok: boolean) => void) => void } } = { opts: {} };
    gateway.afterInit({ engine } as never);
    return { gateway, limiter, allow: (ip: string) => new Promise<boolean>((resolve) => {
      engine.opts.allowRequest?.({ headers: {}, socket: { remoteAddress: ip } }, (_error, ok) => resolve(ok));
    }) };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it("limits new handshakes and invalid sessions per IP, with a wider budget on the store network", async () => {
    const publicNetwork = gatewayFor();
    for (let i = 0; i < RATE_LIMITS.realtimeHandshakeIp.limit; i += 1) expect(await publicNetwork.allow("203.0.113.60")).toBe(true);
    expect(await publicNetwork.allow("203.0.113.60")).toBe(false);
    expect(await publicNetwork.allow("203.0.113.61")).toBe(true);
    publicNetwork.gateway.onApplicationShutdown();

    const store = gatewayFor(["203.0.113.0/24"]);
    for (let i = 0; i < RATE_LIMITS.realtimeHandshakeIp.limit + 5; i += 1) expect(await store.allow("203.0.113.70")).toBe(true);
    store.gateway.onApplicationShutdown();

    const failures = gatewayFor();
    const socket = { id: "sock", handshake: { headers: {}, address: "203.0.113.80" }, data: {} };
    for (let i = 0; i < RATE_LIMITS.realtimeAuthFailureIp.limit; i += 1) {
      await (failures.gateway as unknown as { recordAuthFailure(socket: unknown): Promise<void> }).recordAuthFailure(socket);
    }
    expect(await failures.allow("203.0.113.80")).toBe(false);
    failures.gateway.onApplicationShutdown();
  });

  it("caps a customer's simultaneous sockets, releases one on disconnect, and does not cap station sockets", async () => {
    const { gateway } = gatewayFor();
    jest.spyOn(gateway as never, "resolveSocketUserFromCookies" as never).mockResolvedValue({
      user: { userId: "customer-1", role: "CUSTOMER", isPosSession: false, sessionId: "session-1" }, accessToken: "token",
    } as never);
    const sockets = Array.from({ length: RATE_LIMITS.realtimeCustomerConnections.limit + 1 }, (_, index) => ({
      id: `customer-${index}`, connected: true, data: {} as Record<string, unknown>, handshake: { headers: {}, address: "203.0.113.90", auth: { token: "token" } },
      emit: jest.fn(), disconnect: jest.fn(), conn: { close: jest.fn() }, join: jest.fn(),
    }));
    for (const socket of sockets) await (gateway as unknown as { authenticateHandshake(socket: unknown): Promise<boolean> }).authenticateHandshake(socket);
    expect(sockets.slice(0, -1).every((socket) => socket.data.connectionSlotKey)).toBe(true);
    expect(sockets.at(-1)?.conn.close).toHaveBeenCalledTimes(1);
    expect(sockets[0].disconnect).not.toHaveBeenCalled();
    gateway.handleDisconnect(sockets[0] as never);
    const replacement = { ...sockets[0], id: "replacement", data: {}, conn: { close: jest.fn() }, disconnect: jest.fn() };
    await (gateway as unknown as { authenticateHandshake(socket: unknown): Promise<boolean> }).authenticateHandshake(replacement);
    expect(replacement.conn.close).not.toHaveBeenCalled();

    const station = gatewayFor().gateway;
    const acquire = jest.spyOn((station as unknown as { rateLimiter: RateLimiterService }).rateLimiter, "acquireSlot");
    jest.spyOn(station as never, "resolveSocketUserFromCookies" as never).mockResolvedValue({
      user: { userId: "kds-station:1", role: "KDS_STATION", isPosSession: false, sessionId: "kds:1", stationLocationId: LOCATION },
    } as never);
    const kds = { id: "kds", connected: true, data: {} as Record<string, unknown>, handshake: { headers: {}, address: "203.0.113.91", auth: { token: "token" } }, emit: jest.fn(), disconnect: jest.fn(), conn: { close: jest.fn() }, join: jest.fn() };
    expect(await (station as unknown as { authenticateHandshake(socket: unknown): Promise<boolean> }).authenticateHandshake(kds)).toBe(true);
    expect(acquire).not.toHaveBeenCalled();
    gateway.onApplicationShutdown();
    station.onApplicationShutdown();
  });

  it("limits subscribe and unsubscribe events without disconnecting the socket", async () => {
    const { gateway } = gatewayFor();
    const customer = { id: "sock", data: { user: { userId: "customer-1", role: "CUSTOMER", sessionId: "session-1", isPosSession: false } }, handshake: { headers: {}, address: "203.0.113.92" }, leave: jest.fn(), disconnect: jest.fn(), emit: jest.fn() };
    jest.spyOn(gateway as never, "revalidateSocketUser" as never).mockResolvedValue(customer.data.user as never);
    for (let i = 0; i < RATE_LIMITS.realtimeSubscribeCustomer.limit; i += 1) {
      await gateway.handleSubscribe({ channel: `order:${ORDER_A}` }, customer as never);
    }
    await expect(gateway.handleSubscribe({ channel: `order:${ORDER_B}` }, customer as never)).resolves.toMatchObject({ subscribed: false, error: "Too many subscription requests" });
    await expect(gateway.handleUnsubscribe({ channel: `order:${ORDER_A}` }, customer as never)).resolves.toMatchObject({ unsubscribed: false });
    expect(customer.disconnect).not.toHaveBeenCalled();
    expect(customer.leave).not.toHaveBeenCalled();
    gateway.onApplicationShutdown();
  });
});
