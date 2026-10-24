import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AdminStampGrantsController } from "./admin-stamp-grants.controller";
import { AdminStampGrantsService } from "./admin-stamp-grants.service";
import { PrismaService } from "../../database/prisma.service";
import { AuthGuard } from "../../common/guards/auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { SessionValidator } from "../../common/session/session-validator.service";
import { configureApp } from "../../app.setup";

const CUSTOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const path = `/api/v1/admin/customers/${CUSTOMER}/stamps`;
const input = { stamps: 2, reason: "SERVICE_RECOVERY", request_id: ID };

describe("Admin stamp grant endpoint authorization and validation", () => {
  let app: INestApplication;
  const service = { grant: jest.fn(async () => ({ grant_id: ID })), retryEmail: jest.fn(async () => ({ status: "SENT" })) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [AdminStampGrantsController], providers: [
      { provide: AdminStampGrantsService, useValue: service }, { provide: PrismaService, useValue: {} },
      { provide: SessionValidator, useValue: { resolve: async (token?: string) => !token ? null : ({
        userId: "authenticated-admin", role: token === "admin" ? "ADMIN" : token === "customer" ? "CUSTOMER" : "STAFF", locationId: LOCATION }) } },
      { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: RolesGuard },
    ] }).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => jest.clearAllMocks());
  const post = (suffix = "/grant", token = "admin") => request(app.getHttpServer()).post(`${path}${suffix}`).auth(token, { type: "bearer" }).set("X-Location-Id", LOCATION);

  it.each(["/grant", `/${ID}/email/retry`])("rejects signed-out, CUSTOMER and STAFF requests to %s", async suffix => {
    await request(app.getHttpServer()).post(`${path}${suffix}`).set("X-Location-Id", LOCATION).send(input).expect(401);
    for (const token of ["customer", "staff"]) await post(suffix, token).send(input).expect(403);
    expect(service.grant).not.toHaveBeenCalled(); expect(service.retryEmail).not.toHaveBeenCalled();
  });
  it("derives admin identity and location from trusted request state, not the body", async () => {
    await post().send({ ...input, admin_user_id: "attacker", available_stamps: 0, lifetime_stamps: 1000 }).expect(201);
    expect(service.grant).toHaveBeenCalledWith(CUSTOMER, LOCATION, expect.objectContaining({ userId: "authenticated-admin", role: "ADMIN" }), input);
  });
  it.each([0, -1, 1.5, 17, null, "2", true, "NaN"])("rejects invalid stamp count %s before mutation", async stamps => {
    await post().send({ ...input, stamps }).expect(422); expect(service.grant).not.toHaveBeenCalled();
  });
  it.each([{ reason: undefined }, { reason: "INVALID" }, { stamps: undefined }, { request_id: "bad" },
    { reason: "OTHER" }, { reason: "OTHER", note: "   " }, { reason: "OTHER", note: 12 }])("rejects incomplete or invalid input %j", async change => {
    await post().send({ ...input, ...change }).expect(422); expect(service.grant).not.toHaveBeenCalled();
  });
  it("accepts a trimmed Other explanation", async () => {
    await post().send({ ...input, reason: "OTHER", note: "  Missing sauce  " }).expect(201);
    expect(service.grant).toHaveBeenCalledWith(CUSTOMER, LOCATION, expect.anything(), { ...input, reason: "OTHER", note: "Missing sauce" });
  });
  it.each([8, 9, 16])("accepts a count of %i within capacity before service balance validation", async stamps => {
    await post().send({ ...input, stamps }).expect(201);
    expect(service.grant).toHaveBeenCalledWith(CUSTOMER, LOCATION, expect.anything(), { ...input, stamps });
  });
  it("requires location and valid customer/grant UUIDs", async () => {
    await request(app.getHttpServer()).post(`${path}/grant`).auth("admin", { type: "bearer" }).send(input).expect(422);
    await request(app.getHttpServer()).post('/api/v1/admin/customers/bad/stamps/grant').auth("admin", { type: "bearer" }).set("X-Location-Id", LOCATION).send(input).expect(400);
    await post('/bad/email/retry').expect(400);
  });
  it("retries email through a separate authorized endpoint without invoking grant", async () => {
    await post(`/${ID}/email/retry`).expect(201);
    expect(service.retryEmail).toHaveBeenCalledWith(CUSTOMER, ID, LOCATION, expect.objectContaining({ userId: "authenticated-admin" }));
    expect(service.grant).not.toHaveBeenCalled();
  });
});
