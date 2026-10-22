import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AdminController } from "../admin/admin.controller";
import { AdminService } from "../admin/admin.service";
import { AdminCustomersService } from "../admin/admin-customers.service";
import { SupportController } from "./support.controller";
import { SupportService } from "./support.service";
import { PrismaService } from "../../database/prisma.service";
import { AuthGuard } from "../../common/guards/auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { SessionValidator } from "../../common/session/session-validator.service";
import { configureApp } from "../../app.setup";

const TICKET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_LOCATION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("Support authorization (isolated HTTP, no database)", () => {
  let app: INestApplication;
  const support = { reopenTicket: jest.fn(async () => ({})), createTicket: jest.fn(async (_input: unknown) => ({})), listTickets: jest.fn().mockResolvedValue({ tickets: [], next_cursor: null }), getTicket: jest.fn(async () => ({})),
    getEligibleOrders: jest.fn(async () => ({ orders: [] })), linkOrder: jest.fn(async () => ({})), getTicketOrderDetails: jest.fn(async () => ({})),
    addMessage: jest.fn(async () => ({})), updateStatus: jest.fn(async () => ({})), resolve: jest.fn(async () => ({})) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [AdminController, SupportController], providers: [
      { provide: SupportService, useValue: support }, { provide: PrismaService, useValue: {} },
      { provide: AdminService, useValue: {} }, { provide: AdminCustomersService, useValue: {} },
      { provide: SessionValidator, useValue: { resolve: async (token?: string) => !token ? null : ({ userId: token,
        role: token === "admin" ? "ADMIN" : token === "customer" ? "CUSTOMER" : "STAFF", locationId: LOCATION }) } },
      { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: RolesGuard },
    ] }).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => { await app?.close(); });

  it.each(["", `/${TICKET}`, `/${TICKET}/eligible-orders`, `/${TICKET}/order-details`, `/${TICKET}/link-order`])(
    "protects expanded admin endpoint %s from anonymous/customer/staff access", async suffix => {
      const path = `/api/v1/admin/support-tickets${suffix}`;
      const call = () => suffix.endsWith("link-order") ? request(app.getHttpServer()).post(path).send({ order_id: ORDER }) : request(app.getHttpServer()).get(path);
      await call().set("X-Location-Id", LOCATION).expect(401);
      for (const token of ["customer", "staff"]) await call().set("X-Location-Id", LOCATION).auth(token, { type: "bearer" }).expect(403);
      await call().set("X-Location-Id", LOCATION).auth("admin", { type: "bearer" }).expect(suffix.endsWith("link-order") ? 201 : 200);
    });

  it("passes trusted admin context and location to the service", async () => {
    await request(app.getHttpServer()).get(`/api/v1/admin/support-tickets/${TICKET}`).set("X-Location-Id", LOCATION).auth("admin", { type: "bearer" }).expect(200);
    expect(support.getTicket).toHaveBeenCalledWith(TICKET, "ADMIN", "admin", LOCATION);
    await request(app.getHttpServer()).post(`/api/v1/admin/support-tickets/${TICKET}/link-order`).send({ order_id: ORDER })
      .set("X-Location-Id", LOCATION).auth("admin", { type: "bearer" }).expect(201);
    expect(support.linkOrder).toHaveBeenCalledWith(TICKET, ORDER, "admin", LOCATION);
  });

  it("requires location and validates ticket/order UUIDs", async () => {
    await request(app.getHttpServer()).get(`/api/v1/admin/support-tickets/${TICKET}`).auth("admin", { type: "bearer" }).expect(422);
    await request(app.getHttpServer()).get('/api/v1/admin/support-tickets/invalid').set("X-Location-Id", LOCATION).auth("admin", { type: "bearer" }).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/admin/support-tickets/${TICKET}/link-order`).send({ order_id: "invalid" })
      .set("X-Location-Id", LOCATION).auth("admin", { type: "bearer" }).expect(422);
    expect(support.linkOrder).not.toHaveBeenCalled();
    for (const query of ["status=INVALID", "cursor=bad", "limit=0", "limit=51"]) {
      await request(app.getHttpServer()).get(`/api/v1/admin/support-tickets?${query}`)
        .set("X-Location-Id", LOCATION).auth("admin", { type: "bearer" }).expect(422);
    }
  });

  it("reopening is customer-only and passes server-derived owner and location", async () => {
    const path = `/api/v1/support/tickets/${TICKET}/reopen`;
    await request(app.getHttpServer()).post(path).set("X-Location-Id", LOCATION).expect(401);
    for (const token of ["staff", "admin"]) await request(app.getHttpServer()).post(path).set("X-Location-Id", LOCATION).auth(token, { type: "bearer" }).expect(403);
    await request(app.getHttpServer()).post(path).set("X-Location-Id", LOCATION).auth("customer", { type: "bearer" }).send({ status: "CLOSED", customerUserId: "attacker" }).expect(201);
    expect(support.reopenTicket).toHaveBeenCalledWith(TICKET, "customer", LOCATION);
  });
  it("ignores privileged ticket-source fields in customer input", async () => {
    await request(app.getHttpServer()).post('/api/v1/support/tickets').set("X-Location-Id", LOCATION).auth("customer", { type: "bearer" })
      .send({ ticket_type: "COLD_FOOD", subject: "Cold food", description: "Help", created_source: "SYSTEM_OVERDUE_DELIVERY", allowAdditionalOrderTicket: true }).expect(201);
    expect(support.createTicket).toHaveBeenCalledWith(expect.objectContaining({ createdSource: "CUSTOMER_APP", customerUserId: "customer" }));
    expect(support.createTicket.mock.calls[0][0]).not.toHaveProperty("allowAdditionalOrderTicket");
  });

  it("scopes customer list/detail requests and prevents caller-supplied admin expansion", async () => {
    await request(app.getHttpServer()).get('/api/v1/support/tickets?adminContext=true').set("X-Location-Id", LOCATION).auth("customer", { type: "bearer" }).expect(200);
    expect(support.listTickets).toHaveBeenCalledWith(expect.objectContaining({ customerUserId: "customer", locationId: LOCATION }));
    expect(support.listTickets.mock.calls[0][0]).not.toHaveProperty("adminContext");
    await request(app.getHttpServer()).get(`/api/v1/support/tickets/${TICKET}`).set("X-Location-Id", LOCATION).auth("customer", { type: "bearer" }).expect(200);
    expect(support.getTicket).toHaveBeenCalledWith(TICKET, "CUSTOMER", "customer", LOCATION);
  });

  it("blocks staff from another location and customer status/resolution actions", async () => {
    await request(app.getHttpServer()).get(`/api/v1/support/tickets/${TICKET}`).set("X-Location-Id", OTHER_LOCATION).auth("staff", { type: "bearer" }).expect(403);
    for (const action of ["status", "resolutions"]) await request(app.getHttpServer()).post(`/api/v1/support/tickets/${TICKET}/${action}`)
      .set("X-Location-Id", LOCATION).auth("customer", { type: "bearer" }).send({}).expect(403);
  });
});
