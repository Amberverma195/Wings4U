/**
 * PRD §22 — Walk-In POS E2E Tests
 *
 * Real HTTP + DB tests covering:
 *   1. POS login (bcrypt, SHA-256 legacy, lockout, cooldown, audit)
 *   2. Network restriction enforcement (403 outside allowlist)
 *   3. POS order creation contract (order_source, created_by_user_id)
 *   4. Manual discount endpoint (role checks, persistence, totals)
 *   5. Receipt/drawer flags + store-credit wallet debit
 */

import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { createHash, randomBytes } from "crypto";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { signJwt } from "../src/common/utils/jwt";
import { PrismaService } from "../src/database/prisma.service";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const BASE = "/api/v1";
const CSRF = "e2e-csrf-token";

process.env.SMS_PROVIDER ??= "console";

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Mint an access token backed by a real `auth_sessions` row. The API auth
 * guard now runs SessionValidator against the DB on every request, so
 * tokens without a matching session row always return 401.
 */
async function createSessionToken(
  prisma: PrismaService,
  userId: string,
  role: "CUSTOMER" | "STAFF" | "ADMIN",
  employeeRole?: "MANAGER" | "CASHIER" | "KITCHEN" | "DRIVER",
): Promise<string> {
  const refresh = randomBytes(48).toString("hex");
  const session = await prisma.authSession.create({
    data: {
      userId,
      refreshTokenHash: sha256(refresh),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return signJwt(
    {
      sub: userId,
      role,
      employeeRole,
      sessionId: session.id,
    },
    JWT_SECRET,
    900,
  );
}

function authedPost(
  server: ReturnType<INestApplication["getHttpServer"]>,
  path: string,
  token: string,
  locationId: string,
) {
  return request(server)
    .post(`${BASE}${path}`)
    .set("X-Location-Id", locationId)
    .set("Cookie", `access_token=${token}; csrf_token=${CSRF}`)
    .set("X-CSRF-Token", CSRF);
}

function authedGet(
  server: ReturnType<INestApplication["getHttpServer"]>,
  path: string,
  token: string,
  locationId: string,
) {
  return request(server)
    .get(`${BASE}${path}`)
    .set("X-Location-Id", locationId)
    .set("Cookie", `access_token=${token}`);
}

/* ================================================================== */

describe("PRD §22 — POS Walk-In (e2e)", () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication["getHttpServer"]>;
  let prisma: PrismaService;

  let locationId: string;
  let managerUserId: string;
  let cashierUserId: string;
  let kitchenUserId: string;
  let driverUserId: string;
  let adminUserId: string;
  let customerUserId: string;

  let managerToken: string;
  let cashierToken: string;
  let kitchenToken: string;
  let driverToken: string;
  let adminToken: string;

  let firstMenuItemId: string;

  const BCRYPT_CODE = "11111";
  const LEGACY_CODE = "22222";
  const WRONG_CODE = "99999";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    // ── Lookup seed data ────────────────────────────────────────────────
    const location = await prisma.location.findUniqueOrThrow({
      where: { code: "LON01" },
    });
    locationId = location.id;

    await prisma.locationSettings.update({
      where: { locationId },
      data: { trustedIpRanges: ["192.168.1.100"] },
    });

    const users = await prisma.user.findMany({
      include: { employeeProfile: true },
    });
    adminUserId = users.find((u) => u.role === "ADMIN")!.id;
    managerUserId = users.find(
      (u) => u.employeeProfile?.role === "MANAGER",
    )!.id;
    cashierUserId = users.find(
      (u) => u.employeeProfile?.role === "CASHIER",
    )!.id;
    kitchenUserId = users.find(
      (u) => u.employeeProfile?.role === "KITCHEN",
    )!.id;
    driverUserId = users.find(
      (u) => u.employeeProfile?.role === "DRIVER",
    )!.id;
    customerUserId = users.find((u) => u.role === "CUSTOMER")!.id;

    adminToken = await createSessionToken(prisma, adminUserId, "ADMIN");
    managerToken = await createSessionToken(
      prisma,
      managerUserId,
      "STAFF",
      "MANAGER",
    );
    cashierToken = await createSessionToken(
      prisma,
      cashierUserId,
      "STAFF",
      "CASHIER",
    );
    kitchenToken = await createSessionToken(
      prisma,
      kitchenUserId,
      "STAFF",
      "KITCHEN",
    );
    driverToken = await createSessionToken(
      prisma,
      driverUserId,
      "STAFF",
      "DRIVER",
    );

    // ── Set up employee PIN hashes ──────────────────────────────────────
    const bcryptHash = await bcrypt.hash(BCRYPT_CODE, 10);
    const legacyHash = sha256(LEGACY_CODE);

    await prisma.employeeProfile.update({
      where: { userId: managerUserId },
      data: {
        employeePinHash: bcryptHash,
        posFailedAttempts: 0,
        posLockoutUntil: null,
        posCodeDeactivatedAt: null,
      },
    });
    await prisma.employeeProfile.update({
      where: { userId: cashierUserId },
      data: {
        employeePinHash: legacyHash,
        posFailedAttempts: 0,
        posLockoutUntil: null,
        posCodeDeactivatedAt: null,
      },
    });

    // ── First menu item for order tests ─────────────────────────────────
    const menuItem = await prisma.menuItem.findFirstOrThrow({
      where: { locationId, isAvailable: true, archivedAt: null },
    });
    firstMenuItemId = menuItem.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /* ================================================================== */
  /*  1. POS Login                                                      */
  /* ================================================================== */

  describe("POST /auth/pos/login", () => {
    beforeEach(async () => {
      // Clean rate-limit table before each login test
      await prisma.posLoginAttempt.deleteMany({
        where: { locationId },
      });
      // Reset lockout state
      await prisma.employeeProfile.updateMany({
        where: { locationId },
        data: {
          posFailedAttempts: 0,
          posLockoutUntil: null,
          posCodeDeactivatedAt: null,
        },
      });
    });

    it("successful bcrypt login returns auth cookies + employee role", async () => {
      const res = await request(server)
        .post(`${BASE}/auth/pos/login`)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          employee_code: BCRYPT_CODE,
          location_id: locationId,
          device_id: "e2e-device-1",
        })
        .expect(200);

      expect(res.body.data).toMatchObject({
        user: { role: "STAFF" },
        employee: { role: "MANAGER", location_id: locationId },
      });

      // Verify successful attempt was recorded
      const attempts = await prisma.posLoginAttempt.findMany({
        where: { locationId, wasSuccessful: true },
      });
      expect(attempts.length).toBeGreaterThanOrEqual(1);
    });

    it("successful bcrypt login works from localhost", async () => {
      const res = await request(server)
        .post(`${BASE}/auth/pos/login`)
        .send({
          employee_code: BCRYPT_CODE,
          location_id: locationId,
          device_id: "e2e-localhost-device",
        })
        .expect(200);

      expect(res.body.data).toMatchObject({
        user: { role: "STAFF" },
        employee: { role: "MANAGER", location_id: locationId },
      });
    });

    it("legacy SHA-256 login fallback works", async () => {
      const res = await request(server)
        .post(`${BASE}/auth/pos/login`)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          employee_code: LEGACY_CODE,
          location_id: locationId,
        })
        .expect(200);

      expect(res.body.data).toMatchObject({
        user: { role: "STAFF" },
        employee: { role: "CASHIER" },
      });
    });

    it("wrong code returns 401 and increments attempt history", async () => {
      await request(server)
        .post(`${BASE}/auth/pos/login`)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          employee_code: WRONG_CODE,
          location_id: locationId,
          device_id: "e2e-device-1",
        })
        .expect(401);

      const failedAttempts = await prisma.posLoginAttempt.count({
        where: {
          locationId,
          wasSuccessful: false,
          deviceFingerprint: "e2e-device-1",
        },
      });
      expect(failedAttempts).toBe(1);
    });

    it("lockout after 5 failures from same IP+device", async () => {
      const deviceId = "e2e-lockout-device";

      // Send 5 wrong attempts
      for (let i = 0; i < 5; i++) {
        await request(server)
          .post(`${BASE}/auth/pos/login`)
          .set("X-Forwarded-For", "192.168.1.100")
          .send({
            employee_code: WRONG_CODE,
            location_id: locationId,
            device_id: deviceId,
          })
          .expect(401);
      }

      // 6th attempt should be locked out
      const res = await request(server)
        .post(`${BASE}/auth/pos/login`)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          employee_code: BCRYPT_CODE, // Correct code — still locked
          location_id: locationId,
          device_id: deviceId,
        })
        .expect(401);

      expect(res.body.errors[0].message).toContain("Too many failed attempts");
    });

    it("lockout window expiry allows login again", async () => {
      const deviceId = "e2e-lockout-expiry";

      // Insert 5 old failed attempts (11 minutes ago — outside 10-min window)
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
      for (let i = 0; i < 5; i++) {
        await prisma.posLoginAttempt.create({
          data: {
            locationId,
            clientIp: "192.168.1.100",
            deviceFingerprint: deviceId,
            wasSuccessful: false,
            attemptedAt: elevenMinutesAgo,
          },
        });
      }

      // Login should succeed because old attempts are outside the window
      const res = await request(server)
        .post(`${BASE}/auth/pos/login`)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          employee_code: BCRYPT_CODE,
          location_id: locationId,
          device_id: deviceId,
        })
        .expect(200);

      expect(res.body.data.user).toBeDefined();
    });

    it("cooldown rejection when pos_code_deactivated_at within 30 days", async () => {
      // Set deactivation date to 5 days ago
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await prisma.employeeProfile.update({
        where: { userId: managerUserId },
        data: { posCodeDeactivatedAt: fiveDaysAgo },
      });

      const res = await request(server)
        .post(`${BASE}/auth/pos/login`)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          employee_code: BCRYPT_CODE,
          location_id: locationId,
        })
        .expect(403);

      expect(res.body.errors[0].message).toContain("recently deactivated");
    });

    it("POS_LOGIN_FAIL audit rows created with device_id payload", async () => {
      const deviceId = "e2e-audit-device";

      await request(server)
        .post(`${BASE}/auth/pos/login`)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          employee_code: WRONG_CODE,
          location_id: locationId,
          device_id: deviceId,
        })
        .expect(401);

      const auditRows = await prisma.adminAuditLog.findMany({
        where: {
          locationId,
          actionKey: "POS_LOGIN_FAIL",
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      expect(auditRows.length).toBe(1);
      expect(auditRows[0].entityType).toBe("POS_SESSION");
      const payload = auditRows[0].payloadJson as Record<string, unknown>;
      expect(payload.device_id).toBe(deviceId);
      expect(payload.client_ip).toBeDefined();
    });

    it("rejects non-5-digit codes with 422", async () => {
      await request(server)
        .post(`${BASE}/auth/pos/login`)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          employee_code: "1234", // 4 digits
          location_id: locationId,
        })
        .expect(422);

      await request(server)
        .post(`${BASE}/auth/pos/login`)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          employee_code: "abcde", // non-numeric
          location_id: locationId,
        })
        .expect(422);
    });
  });

  /* ================================================================== */
  /*  2. Network Restriction Enforcement                                */
  /* ================================================================== */

  describe("Network restriction enforcement", () => {
    it("staff network status reports allowed from a trusted IP", async () => {
      const res = await authedGet(
        server,
        `/auth/pos/network-status?location_id=${locationId}`,
        cashierToken,
        locationId,
      )
        .set("X-Forwarded-For", "192.168.1.100")
        .expect(200);

      expect(res.body.data).toMatchObject({ allowed: true });
    });

    it("admin network status reports allowed from a trusted IP", async () => {
      const res = await authedGet(
        server,
        `/auth/pos/network-status?location_id=${locationId}`,
        adminToken,
        locationId,
      )
        .set("X-Forwarded-For", "192.168.1.100")
        .expect(200);

      expect(res.body.data).toMatchObject({ allowed: true });
    });

    it("staff network status reports denied outside the allowlist", async () => {
      const res = await authedGet(
        server,
        `/auth/pos/network-status?location_id=${locationId}`,
        cashierToken,
        locationId,
      )
        .set("X-Forwarded-For", "172.16.0.1")
        .expect(200);

      expect(res.body.data).toMatchObject({
        allowed: false,
        reason: "POS access is restricted to in-store network only",
      });
    });

    it("403 on POST /pos/orders outside allowlist", async () => {
      const res = await request(server)
        .post(`${BASE}/pos/orders`)
        .set("X-Location-Id", locationId)
        .set("X-Forwarded-For", "172.16.0.1")
        .set("Cookie", `access_token=${cashierToken}; csrf_token=${CSRF}`)
        .set("X-CSRF-Token", CSRF)
        .send({
          order_source: "POS",
          fulfillment_type: "PICKUP",
          payment_method: "CASH",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(403);

      expect(res.body.errors[0].message).toContain("in-store network");
    });

    it("403 on timeclock endpoints outside allowlist", async () => {
      const res = await request(server)
        .post(`${BASE}/timeclock/clock-in`)
        .set("X-Location-Id", locationId)
        .set("X-Forwarded-For", "172.16.0.1")
        .set("Cookie", `access_token=${cashierToken}; csrf_token=${CSRF}`)
        .set("X-CSRF-Token", CSRF)
        .expect(403);

      expect(res.body.errors[0].message).toContain("in-store network");
    });

    it("allowed from the configured trusted IP", async () => {
      // Should NOT get a 403 — it should proceed past the guard
      // (may fail with 422/400 due to missing body, but NOT 403)
      const res = await request(server)
        .post(`${BASE}/pos/orders`)
        .set("X-Location-Id", locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .set("Cookie", `access_token=${cashierToken}; csrf_token=${CSRF}`)
        .set("X-CSRF-Token", CSRF)
        .send({
          order_source: "POS",
          fulfillment_type: "PICKUP",
          payment_method: "CASH",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        });

      // Should be 201 (order created) or another non-403 status
      expect(res.status).not.toBe(403);
    });

    it("allows localhost even when forwarded headers are missing", async () => {
      const res = await request(server)
        .post(`${BASE}/pos/orders`)
        .set("X-Location-Id", locationId)
        .set("Cookie", `access_token=${cashierToken}; csrf_token=${CSRF}`)
        .set("X-CSRF-Token", CSRF)
        .send({
          order_source: "POS",
          fulfillment_type: "PICKUP",
          payment_method: "CASH",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        });

      expect(res.status).not.toBe(403);
    });
  });

  /* ================================================================== */
  /*  3. POS Order Creation Contract                                    */
  /* ================================================================== */

  describe("POS order creation", () => {
    it("accepts order_source=POS and persists created_by_user_id", async () => {
      const res = await authedPost(server, "/pos/orders", cashierToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "POS",
          fulfillment_type: "PICKUP",
          payment_method: "CASH",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);

      const order = res.body.data;
      expect(order.order_source).toBe("POS");
      expect(order.created_by_user_id).toBe(cashierUserId);
      expect(order.receipt_action).toBe("PRINT");
      expect(order.drawer_action).toBe("OPEN"); // CASH → OPEN

      // Verify in DB
      const dbOrder = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(dbOrder.createdByUserId).toBe(cashierUserId);
      expect(dbOrder.orderSource).toBe("POS");
    });

    it("accepts order_source=PHONE", async () => {
      const res = await authedPost(server, "/pos/orders", cashierToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "PHONE",
          fulfillment_type: "PICKUP",
          payment_method: "CASH",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);

      expect(res.body.data.order_source).toBe("PHONE");
    });

    it("rejects delivery phone orders without a customer phone", async () => {
      const deliveryItem = await prisma.menuItem.findFirstOrThrow({
        where: {
          locationId,
          isAvailable: true,
          archivedAt: null,
          allowedFulfillmentType: { in: ["BOTH", "DELIVERY"] },
        },
      });

      await authedPost(server, "/pos/orders", cashierToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "PHONE",
          fulfillment_type: "DELIVERY",
          payment_method: "CASH",
          items: [{ menu_item_id: deliveryItem.id, quantity: 1 }],
        })
        .expect(422);
    });

    it("uses POS delivery customer phone last four as delivery PIN", async () => {
      const deliveryItem = await prisma.menuItem.findFirstOrThrow({
        where: {
          locationId,
          isAvailable: true,
          archivedAt: null,
          allowedFulfillmentType: { in: ["BOTH", "DELIVERY"] },
        },
      });

      const res = await authedPost(server, "/pos/orders", cashierToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "PHONE",
          fulfillment_type: "DELIVERY",
          customer_phone: "(519) 555-9876",
          payment_method: "CASH",
          items: [{ menu_item_id: deliveryItem.id, quantity: 1 }],
        })
        .expect(201);

      const orderId = res.body.data.id as string;
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.customerPhoneSnapshot).toBe("+15195559876");

      await prisma.driverProfile.update({
        where: { userId: driverUserId },
        data: { availabilityStatus: "AVAILABLE", isOnDelivery: false },
      });
      await authedPost(server, `/kds/orders/${orderId}/status`, managerToken, locationId)
        .send({ status: "READY" })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/assign-driver`, managerToken, locationId)
        .send({ driver_user_id: driverUserId })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/start-delivery`, managerToken, locationId)
        .send({})
        .expect(201);

      const pin = await prisma.deliveryPinVerification.findUniqueOrThrow({
        where: { orderId },
      });
      expect(pin.pinPlaintext).toBe("9876");
    });

    it("kitchen staff can create a POS order", async () => {
      const res = await authedPost(server, "/pos/orders", kitchenToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "POS",
          fulfillment_type: "PICKUP",
          payment_method: "CASH",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);

      expect(res.body.data.created_by_user_id).toBe(kitchenUserId);
    });

    it("driver staff can list today's POS orders", async () => {
      const res = await authedGet(server, "/pos/orders", driverToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("rejects deprecated order_source values", async () => {
      // IN_STORE should be rejected by DTO validation
      await authedPost(server, "/pos/orders", cashierToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "IN_STORE",
          fulfillment_type: "PICKUP",
          payment_method: "CASH",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(422);

      // ADMIN_CREATED should be rejected
      await authedPost(server, "/pos/orders", cashierToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "ADMIN_CREATED",
          fulfillment_type: "PICKUP",
          payment_method: "CASH",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(422);
    });

    it("CARD_TERMINAL payment → drawer CLOSED", async () => {
      const res = await authedPost(server, "/pos/orders", cashierToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "POS",
          fulfillment_type: "PICKUP",
          payment_method: "CARD_TERMINAL",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);

      expect(res.body.data.receipt_action).toBe("PRINT");
      expect(res.body.data.drawer_action).toBe("CLOSED");
    });

    it("CASH payment includes change calculation", async () => {
      const res = await authedPost(server, "/pos/orders", cashierToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "POS",
          fulfillment_type: "PICKUP",
          payment_method: "CASH",
          amount_tendered: 50_00,
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);

      expect(res.body.data.amount_tendered_cents).toBe(50_00);
      expect(res.body.data.change_due_cents).toBeDefined();
      expect(res.body.data.change_due_cents).toBeGreaterThanOrEqual(0);
    });
  });

  /* ================================================================== */
  /*  4. Manual Discount Endpoint                                       */
  /* ================================================================== */

  describe("POST /pos/orders/:id/discounts", () => {
    let posOrderId: string;

    beforeAll(async () => {
      // Create a POS order to apply discounts to
      const res = await authedPost(server, "/pos/orders", managerToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "POS",
          fulfillment_type: "PICKUP",
          payment_method: "CASH",
          items: [{ menu_item_id: firstMenuItemId, quantity: 2 }],
        })
        .expect(201);

      posOrderId = res.body.data.id;
    });

    it("manager can apply manual discount", async () => {
      const originalOrder = await prisma.order.findUniqueOrThrow({
        where: { id: posOrderId },
      });
      const originalPayable = originalOrder.finalPayableCents;

      const res = await authedPost(
        server,
        `/pos/orders/${posOrderId}/discounts`,
        managerToken,
        locationId,
      )
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          discount_amount_cents: 200,
          reason: "Damaged packaging — customer complaint",
          description: "Wing box dented",
        })
        .expect(201);

      const discount = res.body.data;
      expect(discount.discount_type).toBe("MANUAL");
      expect(discount.discount_amount_cents).toBe(200);
      expect(discount.reason).toBe("Damaged packaging — customer complaint");
      expect(discount.applied_by_user_id).toBe(managerUserId);
      expect(discount.new_final_payable_cents).toBe(originalPayable - 200);
    });

    it("discount row persisted with applied_by_user_id + reason_text", async () => {
      const discounts = await prisma.orderDiscount.findMany({
        where: { orderId: posOrderId },
      });

      expect(discounts.length).toBeGreaterThanOrEqual(1);
      const manual = discounts.find((d) => d.discountType === "MANUAL");
      expect(manual).toBeDefined();
      expect(manual!.appliedByUserId).toBe(managerUserId);
      expect(manual!.reasonText).toBe(
        "Damaged packaging — customer complaint",
      );
    });

    it("order totals updated correctly after discount", async () => {
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: posOrderId },
      });

      // Discount total should include the 200 applied above
      expect(order.orderDiscountTotalCents).toBeGreaterThanOrEqual(200);
    });

    it("admin can apply manual discount", async () => {
      const res = await authedPost(
        server,
        `/pos/orders/${posOrderId}/discounts`,
        adminToken,
        locationId,
      )
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          discount_amount_cents: 100,
          reason: "Admin override",
        })
        .expect(201);

      expect(res.body.data.applied_by_user_id).toBe(adminUserId);
    });

    it("cashier is denied manual discount (role check)", async () => {
      await authedPost(
        server,
        `/pos/orders/${posOrderId}/discounts`,
        cashierToken,
        locationId,
      )
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          discount_amount_cents: 50,
          reason: "Cashier trying to apply",
        })
        .expect(403);
    });

    it("POS_MANUAL_DISCOUNT audit log created", async () => {
      const auditRows = await prisma.adminAuditLog.findMany({
        where: {
          locationId,
          actionKey: "POS_MANUAL_DISCOUNT",
          entityId: posOrderId,
        },
      });

      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows[0].actorUserId).toBe(managerUserId);
    });
  });

  /* ================================================================== */
  /*  5. Store-credit wallet debit (nice-to-have)                       */
  /* ================================================================== */

  describe("STORE_CREDIT payment", () => {
    beforeAll(async () => {
      // Ensure the customer wallet has sufficient balance
      await prisma.customerWallet.upsert({
        where: { customerUserId },
        create: {
          customerUserId,
          balanceCents: 100_00,
          lifetimeCreditCents: 100_00,
        },
        update: {
          balanceCents: 100_00,
        },
      });
    });

    it("STORE_CREDIT payment creates order and debits wallet", async () => {
      const walletBefore = await prisma.customerWallet.findUniqueOrThrow({
        where: { customerUserId },
      });

      const res = await authedPost(server, "/pos/orders", cashierToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "POS",
          fulfillment_type: "PICKUP",
          payment_method: "STORE_CREDIT",
          customer_phone: "+15191000005", // seed customer phone
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);

      const order = res.body.data;
      expect(order.drawer_action).toBe("CLOSED"); // No cash drawer for credit
      expect(order.payment_status_summary).toBe("PAID");

      // Verify wallet was debited
      const walletAfter = await prisma.customerWallet.findUniqueOrThrow({
        where: { customerUserId },
      });
      expect(walletAfter.balanceCents).toBeLessThan(walletBefore.balanceCents);

      // Verify ledger entry was created
      const ledgerEntries = await prisma.customerCreditLedger.findMany({
        where: { customerUserId, entryType: "POS_DEBIT" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(ledgerEntries.length).toBe(1);
      expect(ledgerEntries[0].amountCents).toBeLessThan(0); // debit is negative
    });

    it("STORE_CREDIT insufficient balance returns 400", async () => {
      // Set wallet to $0
      await prisma.customerWallet.update({
        where: { customerUserId },
        data: { balanceCents: 0 },
      });

      const res = await authedPost(server, "/pos/orders", cashierToken, locationId)
        .set("X-Forwarded-For", "192.168.1.100")
        .send({
          order_source: "POS",
          fulfillment_type: "PICKUP",
          payment_method: "STORE_CREDIT",
          customer_phone: "+15191000005",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(400);

      expect(res.body.errors[0].message).toContain("Insufficient store credit");
    });
  });
});
