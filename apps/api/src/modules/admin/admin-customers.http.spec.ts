import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminCustomersService } from "./admin-customers.service";
import { SupportService } from "../support/support.service";
import { PrismaService } from "../../database/prisma.service";
import { AuthGuard } from "../../common/guards/auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { SessionValidator } from "../../common/session/session-validator.service";
import { configureApp } from "../../app.setup";

const CUSTOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NONCUSTOMER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Real controller/guard validation with a mocked data layer; never connects to a database. */
describe("Admin customer endpoints (isolated HTTP)", () => {
  let app: INestApplication;
  const prisma = {
    user: { findFirst: jest.fn(async ({ where }: { where: { id: string } }) => where.id === NONCUSTOMER ? null : ({ id: CUSTOMER,
      displayName: "Brown", firstName: null, lastName: null, createdAt: new Date("2026-01-01T00:00:00Z"), identities: [], customerAddresses: [], _count: { ordersAsCustomer: 0 } })) },
    order: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    customerWingsRewards: { findUnique: jest.fn(async () => null) },
    customerWingsStampLedger: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [AdminController], providers: [
      AdminCustomersService, { provide: PrismaService, useValue: prisma },
      { provide: AdminService, useValue: { globalSearch: jest.fn() } }, { provide: SupportService, useValue: {} },
      { provide: SessionValidator, useValue: { resolve: async (token?: string) => !token ? null : ({ userId: "actor",
        role: token === "admin" ? "ADMIN" : token === "customer" ? "CUSTOMER" : "STAFF", locationId: LOCATION }) } },
      { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: RolesGuard },
    ] }).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it.each(["", "/orders", "/stamps"])("rejects signed-out and non-admin requests to customer%s", async suffix => {
    const path = `/api/v1/admin/customers/${CUSTOMER}${suffix}`;
    await request(app.getHttpServer()).get(path).set("X-Location-Id", LOCATION).expect(401);
    for (const token of ["customer", "staff"]) {
      await request(app.getHttpServer()).get(path).set("X-Location-Id", LOCATION).auth(token, { type: "bearer" }).expect(403);
    }
  });
  it.each(["", "/orders", "/stamps"])("allows authorized read-only customer%s requests", async suffix => {
    await request(app.getHttpServer()).get(`/api/v1/admin/customers/${CUSTOMER}${suffix}`)
      .set("X-Location-Id", LOCATION).auth("admin", { type: "bearer" }).expect(200);
  });
  it("requires location scope, validates UUIDs and rejects noncustomer target accounts", async () => {
    await request(app.getHttpServer()).get(`/api/v1/admin/customers/${CUSTOMER}`).auth("admin", { type: "bearer" }).expect(422);
    await request(app.getHttpServer()).get('/api/v1/admin/customers/not-a-uuid').set("X-Location-Id", LOCATION).auth("admin", { type: "bearer" }).expect(400);
    await request(app.getHttpServer()).get(`/api/v1/admin/customers/${NONCUSTOMER}`).set("X-Location-Id", LOCATION).auth("admin", { type: "bearer" }).expect(404);
  });
  it("validates limits/cursors before fetching scoped order history", async () => {
    for (const suffix of ['orders?limit=0', 'orders?limit=51', 'stamps?cursor=bad']) {
      await request(app.getHttpServer()).get(`/api/v1/admin/customers/${CUSTOMER}/${suffix}`)
        .set("X-Location-Id", LOCATION).auth("admin", { type: "bearer" }).expect(422);
    }
    await request(app.getHttpServer()).get(`/api/v1/admin/customers/${CUSTOMER}/orders?limit=2`)
      .set("X-Location-Id", LOCATION).auth("admin", { type: "bearer" }).expect(200);
    expect(prisma.order.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { customerUserId: CUSTOMER, locationId: LOCATION }, take: 3,
    }));
  });
});
