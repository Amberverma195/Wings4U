/**
 * Admin access hardening — e2e coverage (Layer 3 of the hardening plan).
 *
 * The Next.js admin UI is protected at two layers (Edge middleware + an
 * authoritative server-side layout gate that calls the API). Page
 * protection is not authorization, so these tests lock in that the
 * backend — the final authority — still:
 *
 *   1. Rejects signed-out requests to admin-only endpoints with 401.
 *   2. Rejects customer tokens on admin-only endpoints with 403.
 *   3. Allows admin tokens through.
 *   4. Keeps the former manager-shared operational workflows admin-only
 *      after the manager surface was removed.
 *   5. Honours DB-side session revocation immediately (401 on next request
 *      even if the JWT is still within its 15-minute TTL).
 *   6. Honours DB-side role demotion immediately (403 on next request even
 *      if the JWT still carries the old role claim).
 *   7. Clears every auth cookie on logout, including the legacy Path=/api
 *      access_token from the pre-migration cookie layout.
 *   8. Enforces CSRF as double-submit for mutating authenticated routes:
 *      missing or mismatched X-CSRF-Token is rejected with 403.
 *
 * Tokens in this file are signed with the real `sessionId` of a real
 * `auth_sessions` row, because the API now validates sessions against the
 * database on every request — fake JWTs would universally return 401.
 */

import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { randomBytes, randomUUID, createHash } from "crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { signJwt } from "../src/common/utils/jwt";
import { PrismaService } from "../src/database/prisma.service";
import { AuthService } from "../src/modules/auth/auth.service";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const BASE = "/api/v1";
const CSRF = "e2e-csrf-token";

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

describe("Admin access (e2e, hardening plan)", () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication["getHttpServer"]>;
  let prisma: PrismaService;
  let authService: AuthService;

  let locationId: string;

  let adminUserId: string;
  let customerUserId: string;
  let managerUserId: string;

  let adminSession: SessionHandle;
  let customerSession: SessionHandle;
  let managerSession: SessionHandle;

  let sampleCategoryId: string;
  let sampleMenuItemId: string;

  /**
   * Create a real `auth_sessions` row and return a JWT whose `sessionId`
   * matches that row. The new SessionValidator requires both halves, so
   * every test that wants to authenticate has to go through this helper.
   */
  async function createSession(
    userId: string,
    role: "CUSTOMER" | "STAFF" | "ADMIN",
    employeeRole?: "MANAGER" | "CASHIER" | "KITCHEN" | "DRIVER",
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
      {
        sub: userId,
        role,
        employeeRole,
        sessionId: session.id,
      },
      JWT_SECRET,
      900,
    );

    return { userId, sessionId: session.id, token };
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
    authService = app.get(AuthService);

    const location = await prisma.location.findUnique({
      where: { code: "LON01" },
    });
    locationId = location!.id;

    const users = await prisma.user.findMany({
      include: { employeeProfile: true },
    });
    const adminUser = users.find((u) => u.role === "ADMIN")!;
    const customerUser = users.find((u) => u.role === "CUSTOMER")!;
    const managerUser = users.find(
      (u) => u.employeeProfile?.role === "MANAGER",
    )!;

    adminUserId = adminUser.id;
    customerUserId = customerUser.id;
    managerUserId = managerUser.id;

    adminSession = await createSession(adminUserId, "ADMIN");
    customerSession = await createSession(customerUserId, "CUSTOMER");
    managerSession = await createSession(managerUserId, "STAFF", "MANAGER");

    const category = await prisma.menuCategory.findFirstOrThrow({
      where: { locationId, archivedAt: null },
      orderBy: { sortOrder: "asc" },
    });
    sampleCategoryId = category.id;

    const item = await prisma.menuItem.findFirstOrThrow({
      where: { locationId, archivedAt: null },
      orderBy: { basePriceCents: "asc" },
    });
    sampleMenuItemId = item.id;
  });

  afterAll(async () => {
    // Clean up every test session so repeated runs don't accumulate rows.
    await prisma.authSession.deleteMany({
      where: {
        userId: { in: [adminUserId, customerUserId, managerUserId] },
      },
    });
    await app.close();
  });

  /**
   * `expectAdminOnly` runs the same HTTP request four ways:
   *   - no cookies (signed out)    -> must return 401
   *   - a customer token           -> must return 403
   *   - a manager token            -> must return 403
   *   - an admin token             -> must NOT return 401/403 (2xx, 4xx for
   *                                   business reasons, etc. — anything but
   *                                   auth-level rejection)
   *
   * We assert only the auth outcome, not the business outcome, so these
   * tests stay focused on authorization behavior and don't break when the
   * underlying endpoint's payload contract changes.
   */
  function expectAdminOnly(
    label: string,
    build: () => request.Test,
  ): void {
    describe(label, () => {
      it("signed-out -> 401", async () => {
        const res = await build();
        expect(res.status).toBe(401);
      });

      it("customer -> 403", async () => {
        const res = await build()
          .set(authHeaders(customerSession.token, locationId));
        expect(res.status).toBe(403);
      });

      it("manager -> 403", async () => {
        const res = await build()
          .set(authHeaders(managerSession.token, locationId));
        expect(res.status).toBe(403);
      });

      it("admin -> not 401/403", async () => {
        const res = await build()
          .set(authHeaders(adminSession.token, locationId));
        expect([401, 403]).not.toContain(res.status);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Admin-only endpoints (ADMIN)                                       */
  /* ------------------------------------------------------------------ */

  describe("admin/menu — ADMIN only", () => {
    expectAdminOnly("POST admin/menu/items (create)", () =>
      request(server)
        .post(`${BASE}/admin/menu/items`)
        .send({
          name: `e2e-${randomUUID()}`,
          category_id: sampleCategoryId,
          base_price_cents: 999,
        }),
    );

    expectAdminOnly("PUT admin/menu/items/:id (update)", () =>
      request(server)
        .put(`${BASE}/admin/menu/items/${sampleMenuItemId}`)
        .send({ name: `e2e-${randomUUID()}` }),
    );

    expectAdminOnly("DELETE admin/menu/items/:id", () =>
      request(server).delete(`${BASE}/admin/menu/items/${sampleMenuItemId}`),
    );

    expectAdminOnly("DELETE admin/menu/categories/:id (archive)", () =>
      request(server).delete(
        `${BASE}/admin/menu/categories/${sampleCategoryId}`,
      ),
    );
  });

  describe("admin/staff — ADMIN only", () => {
    expectAdminOnly("GET admin/staff", () =>
      request(server).get(`${BASE}/admin/staff`),
    );

    expectAdminOnly("POST admin/staff (create)", () =>
      request(server)
        .post(`${BASE}/admin/staff`)
        .send({
          first_name: "E2E",
          last_name: "Staff",
          role: "CASHIER",
          employee_code: "00000",
        }),
    );
  });

  describe("admin/audit-log — ADMIN only", () => {
    expectAdminOnly("GET admin/audit-log", () =>
      request(server).get(`${BASE}/admin/audit-log`),
    );
  });

  describe("admin/search — ADMIN only", () => {
    expectAdminOnly("GET admin/search", () =>
      request(server).get(`${BASE}/admin/search?q=test`),
    );
  });

  describe("locations/settings PATCH — ADMIN only", () => {
    expectAdminOnly("PATCH locations/settings", () =>
      request(server)
        .patch(`${BASE}/locations/settings`)
        .send({ minimumDeliverySubtotalCents: 1500 }),
    );

  });

  /* ------------------------------------------------------------------ */
  /*  Former manager-shared workflows are now ADMIN only                 */
  /* ------------------------------------------------------------------ */

  describe("former manager workflows - reports now ADMIN only", () => {
    expectAdminOnly("GET reports/widgets", () =>
      request(server).get(`${BASE}/reports/widgets`),
    );

    expectAdminOnly("GET reports/sales", () =>
      request(server).get(`${BASE}/reports/sales`),
    );

    expectAdminOnly("GET reports/products", () =>
      request(server).get(`${BASE}/reports/products`),
    );
  });

  describe("former manager workflows - settings/order changes/reviews now ADMIN only", () => {
    expectAdminOnly("GET locations/settings", () =>
      request(server).get(`${BASE}/locations/settings`),
    );

    expectAdminOnly("GET admin/order-changes", () =>
      request(server).get(`${BASE}/admin/order-changes`),
    );

    expectAdminOnly("POST admin/order-changes/:id/approve", () =>
      request(server)
        .post(
          `${BASE}/admin/order-changes/00000000-0000-0000-0000-000000000000/approve`,
        )
        .send({}),
    );

    expectAdminOnly("GET admin/reviews", () =>
      request(server).get(`${BASE}/admin/reviews`),
    );

    expectAdminOnly("POST admin/reviews/:id/reply", () =>
      request(server)
        .post(
          `${BASE}/admin/reviews/00000000-0000-0000-0000-000000000000/reply`,
        )
        .send({ reply: "e2e" }),
    );
  });

  /* ------------------------------------------------------------------ */
  /*  DB-authoritative session: revocation takes effect immediately      */
  /*                                                                     */
  /*  Previously a revoked `auth_sessions` row still let requests pass   */
  /*  until the 15-minute JWT TTL. That is exactly how the               */
  /*  "logged-out-as-customer, reloaded, signed-back-in" regression      */
  /*  kept happening. Now the guard re-checks the session row every      */
  /*  request, so revocation is enforced on the next call.               */
  /* ------------------------------------------------------------------ */

  describe("session revocation regression", () => {
    it("revoked admin session -> 401 on admin-only endpoint", async () => {
      const session = await createSession(adminUserId, "ADMIN");

      // Sanity: still-live session can reach the endpoint.
      const before = await request(server)
        .get(`${BASE}/admin/audit-log`)
        .set(authHeaders(session.token, locationId));
      expect([401, 403]).not.toContain(before.status);

      await prisma.authSession.update({
        where: { id: session.sessionId },
        data: { revokedAt: new Date() },
      });

      const after = await request(server)
        .get(`${BASE}/admin/audit-log`)
        .set(authHeaders(session.token, locationId));
      expect(after.status).toBe(401);
    });

    it("revoked session -> GET /auth/session reports authenticated: false", async () => {
      const session = await createSession(customerUserId, "CUSTOMER");

      await prisma.authSession.update({
        where: { id: session.sessionId },
        data: { revokedAt: new Date() },
      });

      const res = await request(server)
        .get(`${BASE}/auth/session`)
        .set(authHeaders(session.token, locationId));

      expect(res.status).toBe(200);
      expect(res.body?.data?.authenticated).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Role drift: the JWT claim is not trusted after DB lookup           */
  /*                                                                     */
  /*  If someone is demoted from ADMIN to CUSTOMER in the DB, their      */
  /*  still-valid JWT must stop getting admin access on the very next    */
  /*  request — not 15 minutes later. The guard reads the current        */
  /*  role from `users.role` and ignores the JWT's `role` claim.         */
  /* ------------------------------------------------------------------ */

  describe("role drift regression", () => {
    it("demoted admin (DB role -> CUSTOMER) -> 403 on admin-only endpoint", async () => {
      // Create a throwaway user that starts as ADMIN so we can demote it
      // without flipping the shared admin seed that other tests rely on.
      const driftUser = await prisma.user.create({
        data: {
          role: "ADMIN",
          displayName: `e2e-drift-${randomUUID().slice(0, 8)}`,
          isActive: true,
        },
      });

      try {
        const session = await createSession(driftUser.id, "ADMIN");

        const before = await request(server)
          .get(`${BASE}/admin/audit-log`)
          .set(authHeaders(session.token, locationId));
        expect([401, 403]).not.toContain(before.status);

        await prisma.user.update({
          where: { id: driftUser.id },
          data: { role: "CUSTOMER" },
        });

        const after = await request(server)
          .get(`${BASE}/admin/audit-log`)
          .set(authHeaders(session.token, locationId));
        expect(after.status).toBe(403);
      } finally {
        await prisma.authSession.deleteMany({
          where: { userId: driftUser.id },
        });
        await prisma.user.delete({ where: { id: driftUser.id } });
      }
    });

    it("deactivated user (isActive=false) -> 401 on any protected endpoint", async () => {
      const inactiveUser = await prisma.user.create({
        data: {
          role: "ADMIN",
          displayName: `e2e-inactive-${randomUUID().slice(0, 8)}`,
          isActive: true,
        },
      });

      try {
        const session = await createSession(inactiveUser.id, "ADMIN");

        await prisma.user.update({
          where: { id: inactiveUser.id },
          data: { isActive: false },
        });

        const res = await request(server)
          .get(`${BASE}/admin/audit-log`)
          .set(authHeaders(session.token, locationId));
        expect(res.status).toBe(401);
      } finally {
        await prisma.authSession.deleteMany({
          where: { userId: inactiveUser.id },
        });
        await prisma.user.delete({ where: { id: inactiveUser.id } });
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Logout cookie clearing — attribute match + legacy path migration   */
  /*                                                                     */
  /*  Regression guard for the logout bug: "I signed out as a non-admin, */
  /*  reloaded, and got signed back in as the same user."                */
  /*                                                                     */
  /*  Root cause was two things that both need to stay fixed:            */
  /*    1. clearCookie was only passed `{ path }`, so the Set-Cookie     */
  /*       header missed Secure / SameSite and Chrome silently kept the  */
  /*       real cookie alive (especially in dev, SameSite=None).         */
  /*    2. After the cookie path moved /api -> /, old clients still held */
  /*       a stale access_token at Path=/api that logout never touched.  */
  /* ------------------------------------------------------------------ */

  describe("logout clears auth cookies", () => {
    async function setupCustomerCookieHeader(): Promise<{
      cookieHeader: string;
      csrfToken: string;
      accessToken: string;
    }> {
      const phone = `+15195551${Date.now().toString().slice(-4)}`;

      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      let otpCode: string | undefined;
      try {
        await request(server)
          .post(`${BASE}/auth/otp/request`)
          .send({ phone })
          .expect(200);
        const line = logSpy.mock.calls
          .map((call) => call.map((value) => String(value)).join(" "))
          .find((text) => text.includes(`[DEV OTP] ${phone}:`));
        otpCode = line?.match(/: (\d{6})$/)?.[1];
      } finally {
        logSpy.mockRestore();
      }

      const verifyRes = await request(server)
        .post(`${BASE}/auth/otp/verify`)
        .send({ phone, otp_code: otpCode })
        .expect(200);

      const setCookies = Array.isArray(verifyRes.headers["set-cookie"])
        ? (verifyRes.headers["set-cookie"] as string[])
        : verifyRes.headers["set-cookie"]
          ? [verifyRes.headers["set-cookie"] as string]
          : [];

      // `setAuthCookies` prepends migration clear Set-Cookies (legacy Path=/api
      // access_token + csrf_token) ahead of the fresh values so browsers with
      // stale cookies get them evicted on the next login. Filter those out so
      // we only extract the real session tokens here.
      const freshSetCookies = setCookies.filter(
        (c) =>
          !/Expires=Thu,\s*01\s*Jan\s*1970/i.test(c) && !/Max-Age=0/i.test(c),
      );
      const cookiePairs = freshSetCookies.map((c) => c.split(";")[0]);
      const csrf =
        cookiePairs
          .find((c) => c.startsWith("csrf_token="))
          ?.slice("csrf_token=".length) ?? "";
      const access =
        cookiePairs
          .find((c) => c.startsWith("access_token="))
          ?.slice("access_token=".length) ?? "";

      return {
        cookieHeader: cookiePairs.join("; "),
        csrfToken: csrf,
        accessToken: access,
      };
    }

    it("POST /auth/logout clears access_token with matching Secure/SameSite attributes", async () => {
      const { cookieHeader, csrfToken } = await setupCustomerCookieHeader();

      const res = await request(server)
        .post(`${BASE}/auth/logout`)
        .set("Cookie", cookieHeader)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      const setCookies = Array.isArray(res.headers["set-cookie"])
        ? (res.headers["set-cookie"] as string[])
        : res.headers["set-cookie"]
          ? [res.headers["set-cookie"] as string]
          : [];

      const accessClears = setCookies.filter((c) =>
        c.startsWith("access_token="),
      );

      // Two clears: Path=/ (current) and Path=/api (legacy migration).
      const rootClear = accessClears.find((c) => /;\s*Path=\/(?:;|$)/i.test(c));
      const legacyClear = accessClears.find((c) => /Path=\/api(?:;|$)/i.test(c));
      expect(rootClear).toBeDefined();
      expect(legacyClear).toBeDefined();

      // Must carry matching attributes or the browser won't accept the clear.
      for (const clear of [rootClear!, legacyClear!]) {
        expect(clear).toMatch(/HttpOnly/i);
        expect(clear).toMatch(/Secure/i);
        expect(clear).toMatch(/SameSite=/i);
      }

      const refreshClear = setCookies.find((c) =>
        c.startsWith("refresh_token="),
      );
      expect(refreshClear).toBeDefined();
      expect(refreshClear).toMatch(/Path=\/api\/v1\/auth\/refresh/i);
      expect(refreshClear).toMatch(/Secure/i);
      expect(refreshClear).toMatch(/SameSite=/i);

      const csrfClears = setCookies.filter((c) => c.startsWith("csrf_token="));
      // Two clears for csrf_token too: the current Path=/ cookie and the
      // legacy Path=/api cookie (migration so previously-issued csrf_tokens
      // at the old path are evicted at logout).
      const csrfRootClear = csrfClears.find((c) =>
        /;\s*Path=\/(?:;|$)/i.test(c),
      );
      const csrfLegacyClear = csrfClears.find((c) =>
        /Path=\/api(?:;|$)/i.test(c),
      );
      expect(csrfRootClear).toBeDefined();
      expect(csrfLegacyClear).toBeDefined();
      for (const clear of [csrfRootClear!, csrfLegacyClear!]) {
        expect(clear).toMatch(/SameSite=/i);
        expect(clear).toMatch(/Secure/i);
      }
    });

    it("GET /auth/session after logout reports authenticated: false (DB session revoked)", async () => {
      const { cookieHeader, csrfToken, accessToken } =
        await setupCustomerCookieHeader();

      await request(server)
        .post(`${BASE}/auth/logout`)
        .set("Cookie", cookieHeader)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      // Reuse the same access_token cookie on the session endpoint. The
      // browser would have been told to evict it, but the server must
      // also treat the now-revoked session as signed out if a stale
      // cookie is replayed.
      const res = await request(server)
        .get(`${BASE}/auth/session`)
        .set(
          "Cookie",
          `access_token=${accessToken}; csrf_token=${csrfToken}`,
        );

      expect(res.status).toBe(200);
      expect(res.body?.data?.authenticated).toBe(false);
    });

    it("POST /auth/logout succeeds even without a valid session (expired/missing token)", async () => {
      // No access_token cookie at all — logout must still succeed and
      // emit clears so the client can never get stuck in "can't log out".
      const res = await request(server)
        .post(`${BASE}/auth/logout`)
        .set("Cookie", `csrf_token=${CSRF}`)
        .set("X-CSRF-Token", CSRF)
        .expect(200);

      expect(res.body?.data?.logged_out ?? res.body?.logged_out).toBe(true);

      const setCookies = Array.isArray(res.headers["set-cookie"])
        ? (res.headers["set-cookie"] as string[])
        : [];
      expect(
        setCookies.some((c) => c.startsWith("access_token=")),
      ).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  CSRF double-submit is strict: both cookie and header required      */
  /* ------------------------------------------------------------------ */

  describe("CSRF double-submit", () => {
    it("mutating route with missing X-CSRF-Token -> 403", async () => {
      const res = await request(server)
        .patch(`${BASE}/locations/settings`)
        .send({ minimumDeliverySubtotalCents: 1500 })
        .set({
          Cookie: `access_token=${adminSession.token}; csrf_token=${CSRF}`,
          "X-Location-Id": locationId,
        });
      expect(res.status).toBe(403);
    });

    it("mutating route with mismatched X-CSRF-Token -> 403", async () => {
      const res = await request(server)
        .patch(`${BASE}/locations/settings`)
        .send({ minimumDeliverySubtotalCents: 1500 })
        .set({
          Cookie: `access_token=${adminSession.token}; csrf_token=${CSRF}`,
          "X-CSRF-Token": "wrong-token",
          "X-Location-Id": locationId,
        });
      expect(res.status).toBe(403);
    });

    it("mutating route with matching CSRF cookie + header -> not 403 for auth reasons", async () => {
      const res = await request(server)
        .patch(`${BASE}/locations/settings`)
        .send({ minimumDeliverySubtotalCents: 1500 })
        .set(authHeaders(adminSession.token, locationId));
      expect([401, 403]).not.toContain(res.status);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Auth cookie shape — access_token stays at Path=/ so Next           */
  /*  middleware + server components can read it.                        */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /*  Public cart flows + authenticated saved-cart CSRF boundary         */
  /*                                                                     */
  /*  Anonymous callers still need the guest cart and quote endpoints to */
  /*  work before any auth cookies exist. But once a signed-in browser   */
  /*  hits the same saved-cart mutation routes, strict double-submit     */
  /*  must apply because those requests mutate the authenticated user's  */
  /*  cart. These tests lock in both halves.                             */
  /* ------------------------------------------------------------------ */

  describe("public cart flows + saved-cart CSRF boundary", () => {
    it("POST /cart/quote without CSRF cookies/header -> not 403 (middleware skipped)", async () => {
      const res = await request(server)
        .post(`${BASE}/cart/quote`)
        .set("X-Location-Id", locationId)
        .send({}); // empty body is fine — we only care the CSRF layer let us through
      expect(res.status).not.toBe(403);
    });

    it("PUT /cart/me without CSRF cookies/header -> not 403", async () => {
      const res = await request(server)
        .put(`${BASE}/cart/me`)
        .set("X-Location-Id", locationId)
        .send({});
      expect(res.status).not.toBe(403);
    });

    it("DELETE /cart/me without CSRF cookies/header -> not 403", async () => {
      const res = await request(server)
        .delete(`${BASE}/cart/me`)
        .set("X-Location-Id", locationId);
      expect(res.status).not.toBe(403);
    });

    it("POST /cart/merge without CSRF cookies/header -> not 403", async () => {
      const res = await request(server)
        .post(`${BASE}/cart/merge`)
        .set("X-Location-Id", locationId)
        .send({});
      expect(res.status).not.toBe(403);
    });

    it("authenticated PUT /cart/me without CSRF -> 403", async () => {
      const res = await request(server)
        .put(`${BASE}/cart/me`)
        .set("Cookie", `access_token=${customerSession.token}`)
        .set("X-Location-Id", locationId)
        .send({});
      expect(res.status).toBe(403);
    });

    it("authenticated DELETE /cart/me without CSRF -> 403", async () => {
      const res = await request(server)
        .delete(`${BASE}/cart/me`)
        .set("Cookie", `access_token=${customerSession.token}`)
        .set("X-Location-Id", locationId);
      expect(res.status).toBe(403);
    });

    it("authenticated POST /cart/merge without CSRF -> 403", async () => {
      const res = await request(server)
        .post(`${BASE}/cart/merge`)
        .set("Cookie", `access_token=${customerSession.token}`)
        .set("X-Location-Id", locationId)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Signed-out mutating protected request -> 401 (not middleware 403)  */
  /*                                                                     */
  /*  The "no auth cookie -> skip CSRF" rule exists so protected routes  */
  /*  keep returning 401 for anonymous callers instead of 403 from the   */
  /*  CSRF middleware short-circuiting before AuthGuard runs. The full   */
  /*  expectAdminOnly matrix above already exercises this, this one just */
  /*  makes the guarantee explicit and discoverable by name.             */
  /* ------------------------------------------------------------------ */

  describe("signed-out mutating requests reach AuthGuard (401)", () => {
    it("PATCH /locations/settings with no cookies -> 401 from AuthGuard", async () => {
      const res = await request(server)
        .patch(`${BASE}/locations/settings`)
        .set("X-Location-Id", locationId)
        .send({ minimumDeliverySubtotalCents: 1500 });
      expect(res.status).toBe(401);
    });

    it("POST /admin/staff with no cookies -> 401 from AuthGuard", async () => {
      const res = await request(server)
        .post(`${BASE}/admin/staff`)
        .set("X-Location-Id", locationId)
        .send({});
      expect(res.status).toBe(401);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Refresh endpoint lifecycle                                         */
  /*                                                                     */
  /*  Locks in:                                                          */
  /*    - success path reissues access_token, refresh_token, AND         */
  /*      csrf_token (the CSRF cookie has its own TTL and would silently */
  /*      expire before the refresh token did),                          */
  /*    - expected auth failures (missing/invalid/revoked cookie,        */
  /*      deactivated user) clear cookies so the browser cannot be left  */
  /*      holding a stale JWT after a server-side revocation,            */
  /*    - unexpected server faults still surface as 500 instead of       */
  /*      silently logging the user out.                                 */
  /* ------------------------------------------------------------------ */

  describe("POST /auth/refresh lifecycle", () => {
    async function provisionCustomerRefresh(): Promise<{
      refreshRaw: string;
      sessionId: string;
      userId: string;
    }> {
      const user = await prisma.user.create({
        data: {
          role: "CUSTOMER",
          displayName: `e2e-refresh-${randomUUID().slice(0, 8)}`,
          isActive: true,
        },
      });
      const refreshRaw = randomBytes(48).toString("hex");
      const session = await prisma.authSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: sha256(refreshRaw),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      return { refreshRaw, sessionId: session.id, userId: user.id };
    }

    function extractSetCookies(
      res: request.Response,
    ): { name: string; raw: string }[] {
      const arr = Array.isArray(res.headers["set-cookie"])
        ? (res.headers["set-cookie"] as string[])
        : res.headers["set-cookie"]
          ? [res.headers["set-cookie"] as string]
          : [];
      return arr.map((raw) => ({
        name: raw.split("=")[0],
        raw,
      }));
    }

    function isClearCookie(raw: string): boolean {
      // Express `clearCookie` emits either `Expires=Thu, 01 Jan 1970 ...`
      // or `Max-Age=0` (sometimes both). Match either signal.
      return (
        /Expires=Thu,\s*01\s*Jan\s*1970/i.test(raw) || /Max-Age=0/i.test(raw)
      );
    }

    it("missing refresh cookie -> { refreshed: false } and clears all auth cookies", async () => {
      const res = await request(server)
        .post(`${BASE}/auth/refresh`)
        .expect(200);

      expect(res.body?.data?.refreshed ?? res.body?.refreshed).toBe(false);

      const cookies = extractSetCookies(res);
      const access = cookies.find((c) => c.name === "access_token");
      const refresh = cookies.find((c) => c.name === "refresh_token");
      const csrf = cookies.find((c) => c.name === "csrf_token");
      expect(access?.raw).toBeDefined();
      expect(refresh?.raw).toBeDefined();
      expect(csrf?.raw).toBeDefined();
      expect(isClearCookie(access!.raw)).toBe(true);
      expect(isClearCookie(refresh!.raw)).toBe(true);
      expect(isClearCookie(csrf!.raw)).toBe(true);
    });

    it("revoked refresh cookie -> { refreshed: false } and clears all auth cookies", async () => {
      const { refreshRaw, sessionId, userId } = await provisionCustomerRefresh();
      try {
        await prisma.authSession.update({
          where: { id: sessionId },
          data: { revokedAt: new Date() },
        });

        // Browser would be sending csrf_token too; the CSRF middleware
        // treats a request with any session cookie as an authenticated
        // mutation and requires the double-submit.
        const res = await request(server)
          .post(`${BASE}/auth/refresh`)
          .set("Cookie", `refresh_token=${refreshRaw}; csrf_token=${CSRF}`)
          .set("X-CSRF-Token", CSRF)
          .expect(200);

        expect(res.body?.data?.refreshed ?? res.body?.refreshed).toBe(false);

        const cookies = extractSetCookies(res);
        const access = cookies.find((c) => c.name === "access_token");
        const refresh = cookies.find((c) => c.name === "refresh_token");
        const csrf = cookies.find((c) => c.name === "csrf_token");
        expect(isClearCookie(access!.raw)).toBe(true);
        expect(isClearCookie(refresh!.raw)).toBe(true);
        expect(isClearCookie(csrf!.raw)).toBe(true);
      } finally {
        await prisma.authSession.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } });
      }
    });

    it("deactivated user -> refresh fails, session row gets revoked, stale access cookie stays signed out", async () => {
      const { refreshRaw, sessionId, userId } = await provisionCustomerRefresh();
      const staleAccessToken = signJwt(
        { sub: userId, role: "CUSTOMER", sessionId },
        JWT_SECRET,
        900,
      );
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { isActive: false },
        });

        const refreshRes = await request(server)
          .post(`${BASE}/auth/refresh`)
          .set("Cookie", `refresh_token=${refreshRaw}; csrf_token=${CSRF}`)
          .set("X-CSRF-Token", CSRF)
          .expect(200);

        expect(
          refreshRes.body?.data?.refreshed ?? refreshRes.body?.refreshed,
        ).toBe(false);

        // The service must have revoked the session row so the cookie is
        // also dead going forward, not just cleared client-side.
        const row = await prisma.authSession.findUnique({
          where: { id: sessionId },
        });
        expect(row?.revokedAt).not.toBeNull();

        // /auth/session with the old access_token must still come back
        // signed out (the session row is revoked and SessionValidator rejects
        // the stale cookie even if the browser replays it).
        const sessRes = await request(server)
          .get(`${BASE}/auth/session`)
          .set("Cookie", `access_token=${staleAccessToken}; csrf_token=${CSRF}`);
        expect(sessRes.status).toBe(200);
        expect(sessRes.body?.data?.authenticated).toBe(false);
      } finally {
        await prisma.authSession.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } });
      }
    });

    it("valid refresh -> reissues access_token, refresh_token, AND csrf_token with aligned attributes", async () => {
      const { refreshRaw, userId } = await provisionCustomerRefresh();
      try {
        const res = await request(server)
          .post(`${BASE}/auth/refresh`)
          .set("Cookie", `refresh_token=${refreshRaw}; csrf_token=${CSRF}`)
          .set("X-CSRF-Token", CSRF)
          .expect(200);

        expect(res.body?.data?.refreshed ?? res.body?.refreshed).toBe(true);

        const cookies = extractSetCookies(res);
        // `setAuthCookies` also emits legacy-path clear Set-Cookies
        // (access_token/csrf_token at Path=/api) to migrate browsers that
        // signed in under the old cookie shape. Filter them out here so
        // the "fresh value" assertions look at the new Path=/ cookies.
        const access = cookies.find(
          (c) => c.name === "access_token" && !isClearCookie(c.raw),
        );
        const refresh = cookies.find(
          (c) => c.name === "refresh_token" && !isClearCookie(c.raw),
        );
        const csrf = cookies.find(
          (c) => c.name === "csrf_token" && !isClearCookie(c.raw),
        );
        expect(access?.raw).toBeDefined();
        expect(refresh?.raw).toBeDefined();
        expect(csrf?.raw).toBeDefined();

        // Legacy-path clears are expected once (to migrate old cookies).
        const legacyAccessClear = cookies.find(
          (c) =>
            c.name === "access_token" &&
            isClearCookie(c.raw) &&
            /Path=\/api(?:;|$)/i.test(c.raw),
        );
        const legacyCsrfClear = cookies.find(
          (c) =>
            c.name === "csrf_token" &&
            isClearCookie(c.raw) &&
            /Path=\/api(?:;|$)/i.test(c.raw),
        );
        expect(legacyAccessClear?.raw).toBeDefined();
        expect(legacyCsrfClear?.raw).toBeDefined();

        // Attribute sanity — same shape as login/logout so clearCookie
        // later can actually match. access_token and csrf_token both stay
        // at Path=/ so Next middleware (access_token) and client JS
        // (csrf_token via document.cookie) can see them from any page.
        // refresh_token stays narrowly scoped to the refresh endpoint.
        expect(access!.raw).toMatch(/;\s*Path=\/(?:;|$)/i);
        expect(refresh!.raw).toMatch(/Path=\/api\/v1\/auth\/refresh/i);
        expect(csrf!.raw).toMatch(/;\s*Path=\/(?:;|$)/i);
        expect(access!.raw).toMatch(/HttpOnly/i);
        expect(refresh!.raw).toMatch(/HttpOnly/i);
        expect(access!.raw).toMatch(/Secure/i);
        expect(refresh!.raw).toMatch(/Secure/i);
        expect(csrf!.raw).toMatch(/Secure/i);
        expect(access!.raw).toMatch(/SameSite=/i);
        expect(refresh!.raw).toMatch(/SameSite=/i);
        expect(csrf!.raw).toMatch(/SameSite=/i);
        // csrf_token is deliberately readable to JS so the browser can
        // echo it in the X-CSRF-Token header.
        expect(csrf!.raw).not.toMatch(/HttpOnly/i);
      } finally {
        await prisma.authSession.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } });
      }
    });

    it("unexpected refresh error -> 500 and does not clear cookies as if logout happened", async () => {
      const { refreshRaw, userId } = await provisionCustomerRefresh();
      const spy = jest
        .spyOn(authService, "refresh")
        .mockRejectedValueOnce(new Error("unexpected refresh failure"));
      try {
        const res = await request(server)
          .post(`${BASE}/auth/refresh`)
          .set("Cookie", `refresh_token=${refreshRaw}; csrf_token=${CSRF}`)
          .set("X-CSRF-Token", CSRF)
          .expect(500);

        const setCookies = Array.isArray(res.headers["set-cookie"])
          ? (res.headers["set-cookie"] as string[])
          : res.headers["set-cookie"]
            ? [res.headers["set-cookie"] as string]
            : [];
        expect(setCookies).toHaveLength(0);
      } finally {
        spy.mockRestore();
        await prisma.authSession.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } });
      }
    });
  });

  describe("access_token cookie shape (Set-Cookie)", () => {
    it("OTP verify sets access_token on Path=/ so middleware can read it", async () => {
      const phone = `+15195550${Date.now().toString().slice(-4)}`;

      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      let otpCode: string | undefined;
      try {
        await request(server)
          .post(`${BASE}/auth/otp/request`)
          .send({ phone })
          .expect(200);

        const line = logSpy.mock.calls
          .map((call) => call.map((value) => String(value)).join(" "))
          .find((text) => text.includes(`[DEV OTP] ${phone}:`));
        otpCode = line?.match(/: (\d{6})$/)?.[1];
      } finally {
        logSpy.mockRestore();
      }
      expect(otpCode).toBeDefined();

      const res = await request(server)
        .post(`${BASE}/auth/otp/verify`)
        .send({ phone, otp_code: otpCode })
        .expect(200);

      const setCookies = Array.isArray(res.headers["set-cookie"])
        ? (res.headers["set-cookie"] as string[])
        : res.headers["set-cookie"]
          ? [res.headers["set-cookie"] as string]
          : [];
      // Skip the migration clear (legacy Path=/api) so we assert on the
      // fresh access_token cookie the browser will actually use.
      const accessCookie = setCookies.find(
        (c) =>
          c.startsWith("access_token=") &&
          !/Expires=Thu,\s*01\s*Jan\s*1970/i.test(c) &&
          !/Max-Age=0/i.test(c),
      );
      expect(accessCookie).toBeDefined();
      expect(accessCookie).toMatch(/;\s*Path=\/(?:;|$)/i);
      expect(accessCookie).not.toMatch(/Path=\/api(?:;|$)/i);
    });
  });
});
