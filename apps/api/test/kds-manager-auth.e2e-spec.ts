/**
 * KDS access hardening and staff-session regressions.
 *
 * The standalone `/manager` surface has been removed. Manager-role staff
 * still remain valid KDS operators, so this suite now focuses on:
 *
 *   - KDS HTTP policy: ADMIN, STAFF(KITCHEN), STAFF(MANAGER)
 *   - driver availability mutation policy: ADMIN or self-driver only
 *   - refresh preserving `employeeRole` for KDS staff
 *   - `/auth/session` exposing authoritative `employeeRole`
 *   - DB-driven revocation and employee-role drift taking effect on the
 *     next request
 *
 * Every token here is backed by a real `auth_sessions` row because the
 * API validates sessions against the database on every request.
 */

import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { createHash, randomBytes, randomUUID } from "crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { signJwt } from "../src/common/utils/jwt";
import { PrismaService } from "../src/database/prisma.service";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const BASE = "/api/v1";
const CSRF = "e2e-csrf-token";

type UserRole = "CUSTOMER" | "STAFF" | "ADMIN";
type EmployeeRole = "MANAGER" | "CASHIER" | "KITCHEN" | "DRIVER";
type Caller = "admin" | "manager" | "kitchen" | "cashier" | "driver" | "customer";

interface SessionHandle {
  userId: string;
  sessionId: string;
  token: string;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function authHeaders(token: string, locationId: string) {
  return {
    Cookie: `access_token=${token}; csrf_token=${CSRF}`,
    "X-CSRF-Token": CSRF,
    "X-Location-Id": locationId,
  };
}

describe("KDS access and staff employeeRole auth (e2e)", () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication["getHttpServer"]>;
  let prisma: PrismaService;

  let locationId: string;

  let adminUserId: string;
  let customerUserId: string;
  let managerUserId: string;
  let kitchenUserId: string;
  let cashierUserId: string;
  let driverUserId: string;

  let adminSession: SessionHandle;
  let customerSession: SessionHandle;
  let managerSession: SessionHandle;
  let kitchenSession: SessionHandle;
  let cashierSession: SessionHandle;
  let driverSession: SessionHandle;

  let sampleOrderId: string;

  async function createSession(
    userId: string,
    role: UserRole,
    employeeRole?: EmployeeRole,
  ): Promise<SessionHandle> {
    const refresh = randomBytes(48).toString("hex");
    const session = await prisma.authSession.create({
      data: {
        userId,
        refreshTokenHash: sha256(refresh),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const token = signJwt(
      { sub: userId, role, employeeRole, sessionId: session.id },
      JWT_SECRET,
      900,
    );
    return { userId, sessionId: session.id, token };
  }

  function sessionFor(caller: Caller): SessionHandle {
    switch (caller) {
      case "admin":
        return adminSession;
      case "manager":
        return managerSession;
      case "kitchen":
        return kitchenSession;
      case "cashier":
        return cashierSession;
      case "driver":
        return driverSession;
      case "customer":
        return customerSession;
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const location = await prisma.location.findUniqueOrThrow({
      where: { code: "LON01" },
    });
    locationId = location.id;

    const users = await prisma.user.findMany({
      include: { employeeProfile: true },
    });
    adminUserId = users.find((u) => u.role === "ADMIN")!.id;
    customerUserId = users.find((u) => u.role === "CUSTOMER")!.id;
    managerUserId = users.find((u) => u.employeeProfile?.role === "MANAGER")!.id;
    kitchenUserId = users.find((u) => u.employeeProfile?.role === "KITCHEN")!.id;
    cashierUserId = users.find((u) => u.employeeProfile?.role === "CASHIER")!.id;
    driverUserId = users.find((u) => u.employeeProfile?.role === "DRIVER")!.id;

    adminSession = await createSession(adminUserId, "ADMIN");
    customerSession = await createSession(customerUserId, "CUSTOMER");
    managerSession = await createSession(managerUserId, "STAFF", "MANAGER");
    kitchenSession = await createSession(kitchenUserId, "STAFF", "KITCHEN");
    cashierSession = await createSession(cashierUserId, "STAFF", "CASHIER");
    driverSession = await createSession(driverUserId, "STAFF", "DRIVER");

    const order = await prisma.order.findFirst({
      where: { locationId },
      orderBy: { createdAt: "desc" },
    });
    sampleOrderId =
      order?.id ?? "00000000-0000-0000-0000-000000000000";
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({
      where: {
        userId: {
          in: [
            adminUserId,
            customerUserId,
            managerUserId,
            kitchenUserId,
            cashierUserId,
            driverUserId,
          ],
        },
      },
    });
    await app.close();
  });

  function expectSurfacePolicy(
    label: string,
    build: () => request.Test,
    allowed: Caller[],
  ): void {
    describe(label, () => {
      it("signed-out -> 401", async () => {
        const res = await build();
        expect(res.status).toBe(401);
      });

      const callers: Caller[] = [
        "admin",
        "manager",
        "kitchen",
        "cashier",
        "driver",
        "customer",
      ];

      for (const caller of callers) {
        const isAllowed = allowed.includes(caller);
        it(`${caller} -> ${isAllowed ? "not 401/403" : "403"}`, async () => {
          const res = await build().set(
            authHeaders(sessionFor(caller).token, locationId),
          );
          if (isAllowed) {
            expect([401, 403]).not.toContain(res.status);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  KDS surface                                                        */
  /* ------------------------------------------------------------------ */

  describe("KDS surface - ADMIN or STAFF(KITCHEN|MANAGER)", () => {
    expectSurfacePolicy(
      "GET /kds/orders",
      () => request(server).get(`${BASE}/kds/orders`),
      ["admin", "manager", "kitchen"],
    );

    expectSurfacePolicy(
      "POST /kds/busy-mode",
      () =>
        request(server)
          .post(`${BASE}/kds/busy-mode`)
          .send({ active: false }),
      ["admin", "manager", "kitchen"],
    );

    expectSurfacePolicy(
      "GET /drivers/available",
      () => request(server).get(`${BASE}/drivers/available`),
      ["admin", "manager", "kitchen"],
    );

    expectSurfacePolicy(
      "POST /kds/orders/:id/pin/bypass",
      () =>
        request(server)
          .post(`${BASE}/kds/orders/${sampleOrderId}/pin/bypass`)
          .send({ reason: "e2e" }),
      ["admin"],
    );
  });

  /* ------------------------------------------------------------------ */
  /*  Driver availability mutation                                       */
  /* ------------------------------------------------------------------ */

  describe("POST /drivers/:id/availability - ADMIN or self-driver only", () => {
    const build = (targetUserId: string) =>
      request(server)
        .post(`${BASE}/drivers/${targetUserId}/availability`)
        .send({ status: "AVAILABLE" });

    it("signed-out -> 401", async () => {
      const res = await build(driverUserId);
      expect(res.status).toBe(401);
    });

    it("admin -> not 401/403", async () => {
      const res = await build(driverUserId).set(
        authHeaders(adminSession.token, locationId),
      );
      expect([401, 403]).not.toContain(res.status);
    });

    it("driver updating self -> not 401/403", async () => {
      const res = await build(driverUserId).set(
        authHeaders(driverSession.token, locationId),
      );
      expect([401, 403]).not.toContain(res.status);
    });

    for (const caller of ["manager", "kitchen", "cashier", "customer"] as const) {
      it(`${caller} -> 403`, async () => {
        const res = await build(driverUserId).set(
          authHeaders(sessionFor(caller).token, locationId),
        );
        expect(res.status).toBe(403);
      });
    }

    it("driver cannot update another driver", async () => {
      const tempUser = await prisma.user.create({
        data: {
          role: "STAFF",
          displayName: `e2e-driver-${randomUUID().slice(0, 8)}`,
          isActive: true,
        },
      });

      try {
        await prisma.employeeProfile.create({
          data: {
            userId: tempUser.id,
            locationId,
            role: "DRIVER",
            isActiveEmployee: true,
          },
        });
        await prisma.driverProfile.create({
          data: {
            userId: tempUser.id,
            locationId,
            phoneNumberMirror: `+1519${Date.now().toString().slice(-7)}`,
          },
        });

        const res = await build(tempUser.id).set(
          authHeaders(driverSession.token, locationId),
        );
        expect(res.status).toBe(403);
      } finally {
        await prisma.authSession.deleteMany({ where: { userId: tempUser.id } });
        await prisma.driverProfile.deleteMany({ where: { userId: tempUser.id } });
        await prisma.employeeProfile.deleteMany({ where: { userId: tempUser.id } });
        await prisma.user.delete({ where: { id: tempUser.id } });
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Refresh regression                                                 */
  /* ------------------------------------------------------------------ */

  describe("refresh preserves employeeRole", () => {
    async function provisionRefreshForRole(employeeRole: EmployeeRole): Promise<string> {
      const targetUser = await prisma.user.findFirst({
        where: {
          role: "STAFF",
          employeeProfile: { role: employeeRole },
        },
      });
      if (!targetUser) {
        throw new Error(`No seeded ${employeeRole} user for refresh test`);
      }

      const refreshRaw = randomBytes(48).toString("hex");
      await prisma.authSession.create({
        data: {
          userId: targetUser.id,
          refreshTokenHash: sha256(refreshRaw),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      return refreshRaw;
    }

    async function refreshAccessToken(refreshToken: string): Promise<{
      accessToken: string;
      csrfToken: string;
    }> {
      const refreshRes = await request(server)
        .post(`${BASE}/auth/refresh`)
        .set("Cookie", `refresh_token=${refreshToken}; csrf_token=${CSRF}`)
        .set("X-CSRF-Token", CSRF)
        .expect(200);

      const setCookies = Array.isArray(refreshRes.headers["set-cookie"])
        ? (refreshRes.headers["set-cookie"] as string[])
        : refreshRes.headers["set-cookie"]
          ? [refreshRes.headers["set-cookie"] as string]
          : [];

      const accessToken = setCookies
        .map((cookie) => cookie.split(";")[0])
        .find((cookie) => cookie.startsWith("access_token="))
        ?.slice("access_token=".length);
      const csrfToken =
        setCookies
          .map((cookie) => cookie.split(";")[0])
          .find((cookie) => cookie.startsWith("csrf_token="))
          ?.slice("csrf_token=".length) ?? CSRF;

      expect(accessToken).toBeTruthy();
      return { accessToken: accessToken!, csrfToken };
    }

    it("refreshed manager token still passes KDS policy", async () => {
      const refreshToken = await provisionRefreshForRole("MANAGER");
      const { accessToken, csrfToken } = await refreshAccessToken(refreshToken);

      const res = await request(server)
        .get(`${BASE}/kds/orders`)
        .set({
          Cookie: `access_token=${accessToken}; csrf_token=${csrfToken}`,
          "X-CSRF-Token": csrfToken,
          "X-Location-Id": locationId,
        });

      expect([401, 403]).not.toContain(res.status);
    });

    it("refreshed kitchen token still passes KDS and /auth/session reports employeeRole", async () => {
      const refreshToken = await provisionRefreshForRole("KITCHEN");
      const { accessToken, csrfToken } = await refreshAccessToken(refreshToken);

      const kdsRes = await request(server)
        .get(`${BASE}/kds/orders`)
        .set({
          Cookie: `access_token=${accessToken}; csrf_token=${csrfToken}`,
          "X-CSRF-Token": csrfToken,
          "X-Location-Id": locationId,
        });
      expect([401, 403]).not.toContain(kdsRes.status);

      const sessionRes = await request(server)
        .get(`${BASE}/auth/session`)
        .set({
          Cookie: `access_token=${accessToken}; csrf_token=${csrfToken}`,
          "X-CSRF-Token": csrfToken,
          "X-Location-Id": locationId,
        });
      expect(sessionRes.status).toBe(200);
      expect(sessionRes.body?.data?.authenticated).toBe(true);
      expect(sessionRes.body?.data?.user?.role).toBe("STAFF");
      expect(sessionRes.body?.data?.user?.employeeRole).toBe("KITCHEN");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Session shape                                                      */
  /* ------------------------------------------------------------------ */

  describe("GET /auth/session exposes employeeRole for staff", () => {
    it("manager session -> user.employeeRole = MANAGER", async () => {
      const res = await request(server)
        .get(`${BASE}/auth/session`)
        .set(authHeaders(managerSession.token, locationId));
      expect(res.status).toBe(200);
      expect(res.body?.data?.user?.role).toBe("STAFF");
      expect(res.body?.data?.user?.employeeRole).toBe("MANAGER");
    });

    it("customer session -> user.employeeRole absent", async () => {
      const res = await request(server)
        .get(`${BASE}/auth/session`)
        .set(authHeaders(customerSession.token, locationId));
      expect(res.status).toBe(200);
      expect(res.body?.data?.user?.role).toBe("CUSTOMER");
      expect(res.body?.data?.user?.employeeRole).toBeUndefined();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Revocation and role drift                                          */
  /* ------------------------------------------------------------------ */

  describe("role drift and revocation on KDS access", () => {
    it("revoked manager session -> 401 on next KDS call", async () => {
      const session = await createSession(managerUserId, "STAFF", "MANAGER");

      const before = await request(server)
        .get(`${BASE}/kds/orders`)
        .set(authHeaders(session.token, locationId));
      expect([401, 403]).not.toContain(before.status);

      await prisma.authSession.update({
        where: { id: session.sessionId },
        data: { revokedAt: new Date() },
      });

      const after = await request(server)
        .get(`${BASE}/kds/orders`)
        .set(authHeaders(session.token, locationId));
      expect(after.status).toBe(401);
    });

    it("demoted manager (employeeProfile.role -> CASHIER) -> 403 on KDS endpoint", async () => {
      const user = await prisma.user.create({
        data: {
          role: "STAFF",
          displayName: `e2e-drift-mgr-${Date.now()}`,
          isActive: true,
        },
      });
      const profile = await prisma.employeeProfile.create({
        data: {
          userId: user.id,
          locationId,
          role: "MANAGER",
          isActiveEmployee: true,
        },
      });

      try {
        const session = await createSession(user.id, "STAFF", "MANAGER");

        const before = await request(server)
          .get(`${BASE}/kds/orders`)
          .set(authHeaders(session.token, locationId));
        expect([401, 403]).not.toContain(before.status);

        await prisma.employeeProfile.update({
          where: { userId: user.id },
          data: { role: "CASHIER" },
        });

        const after = await request(server)
          .get(`${BASE}/kds/orders`)
          .set(authHeaders(session.token, locationId));
        expect(after.status).toBe(403);
      } finally {
        await prisma.authSession.deleteMany({ where: { userId: user.id } });
        await prisma.employeeProfile.delete({ where: { userId: profile.userId } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    });

    it("demoted kitchen (employeeProfile.role -> DRIVER) -> 403 on KDS endpoint", async () => {
      const user = await prisma.user.create({
        data: {
          role: "STAFF",
          displayName: `e2e-drift-kds-${Date.now()}`,
          isActive: true,
        },
      });
      const profile = await prisma.employeeProfile.create({
        data: {
          userId: user.id,
          locationId,
          role: "KITCHEN",
          isActiveEmployee: true,
        },
      });

      try {
        const session = await createSession(user.id, "STAFF", "KITCHEN");

        const before = await request(server)
          .get(`${BASE}/kds/orders`)
          .set(authHeaders(session.token, locationId));
        expect([401, 403]).not.toContain(before.status);

        await prisma.employeeProfile.update({
          where: { userId: user.id },
          data: { role: "DRIVER" },
        });

        const after = await request(server)
          .get(`${BASE}/kds/orders`)
          .set(authHeaders(session.token, locationId));
        expect(after.status).toBe(403);
      } finally {
        await prisma.authSession.deleteMany({ where: { userId: user.id } });
        await prisma.employeeProfile.delete({ where: { userId: profile.userId } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    });
  });
});
