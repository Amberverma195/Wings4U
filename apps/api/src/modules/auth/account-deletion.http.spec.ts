jest.mock("../../database/prisma.service", () => ({ PrismaService: class { constructor() { throw new Error("Production database forbidden"); } } }));
jest.mock("../realtime/realtime.gateway", () => ({ RealtimeGateway: class {} }));
jest.mock("../../common/utils/jwt-secret", () => ({ getJwtSecret: () => "deletion-http-test-secret" }));
jest.mock("./otp-sender", () => ({ createOtpSender: () => ({}) }));

import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import request from "supertest";
import cookieParser from "cookie-parser";
import { AuthGuard } from "../../common/guards/auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { csrfMiddleware } from "../../common/middleware/csrf.middleware";
import { AccountDeletionController } from "./account-deletion.controller";
import { AccountDeletionService } from "./account-deletion.service";
import { RateLimiterService } from "../rate-limit/rate-limit.service";

describe("customer account deletion HTTP boundary (no database)", () => {
  let app: INestApplication, service: any, rateLimit: any;
  const customer = { userId: "11111111-1111-4111-8111-111111111111", role: "CUSTOMER", sessionId: "22222222-2222-4222-8222-222222222222", isPosSession: false };
  const body = { request_id: "33333333-3333-4333-8333-333333333333", authorization: "a".repeat(64), confirmation: "DELETE", forfeit_rewards: true };
  beforeEach(async () => {
    service = { config: jest.fn(() => ({ enabled: false })), status: jest.fn(async () => ({ status: "ready" })),
      receipt: jest.fn(async () => ({ status: "unconfirmed" })),
      verify: jest.fn(async () => ({ authorization: "a".repeat(64) })),
      remove: jest.fn(async () => ({ status: "completed", request_id: body.request_id, blockers: [] })) };
    rateLimit = { check: jest.fn(async () => ({ allowed: true })) };
    const module = await Test.createTestingModule({ controllers: [AccountDeletionController], providers: [
      { provide: AccountDeletionService, useValue: service }, { provide: RateLimiterService, useValue: rateLimit },
    ] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1"); app.use(cookieParser()); app.use(csrfMiddleware);
    const reflector = module.get(Reflector);
    const validator: any = { resolve: async (token: string) => token === "customer" ? customer : token === "admin"
      ? { ...customer, role: "ADMIN" } : token === "driver" ? { ...customer, role: "STAFF", employeeRole: "DRIVER" } : null };
    app.useGlobalGuards(new AuthGuard(reflector, validator), new RolesGuard(reflector));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterEach(async () => app.close());
  const endpoint = "/api/v1/auth/account";

  it("exposes public activation information without starting deletion", async () => {
    await request(app.getHttpServer()).get("/api/v1/auth/account-deletion/config").expect(200).expect("Cache-Control", "no-store");
    expect(service.remove).not.toHaveBeenCalled(); expect(service.verify).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated deletion", async () => {
    await request(app.getHttpServer()).delete(endpoint).send(body).expect(401);
    expect(service.remove).not.toHaveBeenCalled();
  });
  it.each(["admin", "driver"])("rejects %s through the customer endpoint", async token => {
    await request(app.getHttpServer()).delete(endpoint).set("Authorization", `Bearer ${token}`).send(body).expect(403);
    expect(service.remove).not.toHaveBeenCalled();
  });
  it("uses only the verified session; refuses an extra client-supplied user ID", async () => {
    await request(app.getHttpServer()).delete(endpoint).set("Authorization", "Bearer customer").send({ ...body, user_id: "unrelated" }).expect(400);
    await request(app.getHttpServer()).delete(endpoint).set("Authorization", "Bearer customer").send(body).expect(200);
    expect(service.remove).toHaveBeenCalledWith(expect.objectContaining({ userId: customer.userId, sessionId: customer.sessionId }), body);
  });
  it("enforces existing website CSRF protections and clears supported cookies only on completed deletion", async () => {
    const cookies = "access_token=customer; csrf_token=double-submit";
    await request(app.getHttpServer()).delete(endpoint).set("Cookie", cookies).send(body).expect(403);
    expect(service.remove).not.toHaveBeenCalled();
    const success = await request(app.getHttpServer()).delete(endpoint).set("Cookie", cookies).set("X-CSRF-Token", "double-submit").send(body).expect(200);
    const cleared = ([] as string[]).concat(success.headers["set-cookie"] ?? []).join(";");
    expect(cleared).toContain("access_token=;"); expect(cleared).toContain("refresh_token=;"); expect(cleared).toContain("csrf_token=;");
    expect(cleared).toContain("Path=/api/v1/auth/refresh"); expect(cleared).toContain("SameSite=None");
  });
  it("does not clear cookies or claim completion when obligations require resolution", async () => {
    service.remove.mockResolvedValue({ status: "resolution_required", blockers: [{ code: "WALLET_BALANCE" }] });
    const response = await request(app.getHttpServer()).delete(endpoint).set("Authorization", "Bearer customer").send(body).expect(200);
    expect(response.headers["set-cookie"]).toBeUndefined(); expect(response.body.status).toBe("resolution_required");
  });
  it("rate limits verification by account and IP, and deletion by account", async () => {
    await request(app.getHttpServer()).post("/api/v1/auth/account-deletion/verify").set("Authorization", "Bearer customer").send({ password: "fictional" }).expect(200);
    expect(rateLimit.check.mock.calls.map((call: any) => call[0])).toEqual([
      expect.stringContaining(`verify:user:${customer.userId}`), expect.stringContaining("verify:ip:"),
    ]);
    rateLimit.check.mockResolvedValue({ allowed: false, resetAtMs: Date.now() + 30000 });
    await request(app.getHttpServer()).delete(endpoint).set("Authorization", "Bearer customer").send(body).expect(429).expect("Retry-After", /\d+/);
    expect(service.remove).not.toHaveBeenCalled();
  });
  it.each([{ ...body, confirmation: "YES" }, { ...body, authorization: "short" }, { ...body, request_id: "bad" }, { ...body, forfeit_rewards: "true" }])("validates deliberate confirmation and proof shape", async invalid => {
    await request(app.getHttpServer()).delete(endpoint).set("Authorization", "Bearer customer").send(invalid).expect(400);
    expect(service.remove).not.toHaveBeenCalled();
  });
  it("an empty Bearer header cannot bypass cookie CSRF", () => {
    const next = jest.fn(); const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    csrfMiddleware({ method: "DELETE", path: endpoint, headers: { authorization: "Bearer " }, cookies: { access_token: "customer" } } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
  });
  it("permits a limited receipt check after sessions are revoked, clearing cookies only for a confirmed completion", async () => {
    const receiptBody = { authorization: body.authorization, request_id: body.request_id };
    const unknown = await request(app.getHttpServer()).post("/api/v1/auth/account-deletion/receipt").send(receiptBody).expect(200);
    expect(unknown.body).toEqual({ status: "unconfirmed" }); expect(unknown.headers["set-cookie"]).toBeUndefined();
    service.receipt.mockResolvedValue({ status: "completed", request_id: body.request_id });
    const completed = await request(app.getHttpServer()).post("/api/v1/auth/account-deletion/receipt").send(receiptBody).expect(200);
    expect(completed.headers["set-cookie"]).toBeDefined(); expect(service.remove).not.toHaveBeenCalled();
  });
});
