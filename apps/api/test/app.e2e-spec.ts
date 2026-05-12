import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { createHash, randomBytes, randomUUID } from "crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { signJwt } from "../src/common/utils/jwt";
import { PrismaService } from "../src/database/prisma.service";
import { KdsAutoAcceptWorker } from "../src/modules/kds/kds-auto-accept.worker";
import { OverdueDeliveryWorker } from "../src/modules/kds/overdue-delivery.worker";
import { RealtimeGateway } from "../src/modules/realtime/realtime.gateway";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const BASE = "/api/v1";
const CSRF = "e2e-csrf-token";

process.env.SMS_PROVIDER ??= "console";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Mint an access token backed by a real `auth_sessions` row for `userId`.
 *
 * The API's auth guard now goes through SessionValidator, which looks up
 * the session row and the current DB role on every request. A plain
 * "signed JWT with a hardcoded sessionId" no longer authenticates — the
 * row has to exist and the user has to still be active. Tests that want
 * to act as a user must call this helper and pass the returned token.
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
      refreshTokenHash: sha256Hex(refresh),
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

function cookieHeader(setCookies?: string[]): string {
  return (setCookies ?? []).map((cookie) => cookie.split(";")[0]).join("; ");
}

function cookieList(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value : [value];
}

function cookieValue(setCookies: string[] | undefined, name: string): string | undefined {
  return setCookies
    ?.map((cookie) => cookie.split(";")[0])
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

let phoneCounter = 0;

function nextTestPhone(): string {
  phoneCounter += 1;
  const suffix = `${Date.now()}${phoneCounter}`.slice(-7).padStart(7, "0");
  return `+1519${suffix}`;
}

async function requestOtpAndCaptureCode(
  server: ReturnType<INestApplication["getHttpServer"]>,
  phone: string,
): Promise<string> {
  const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

  try {
    await request(server)
      .post(`${BASE}/auth/otp/request`)
      .send({ phone })
      .expect(200);

    const otpLog = logSpy.mock.calls
      .map((call) => call.map((value) => String(value)).join(" "))
      .find((line) => line.includes(`[DEV OTP] ${phone}:`));

    expect(otpLog).toBeDefined();
    const match = otpLog?.match(/: (\d{6})$/);
    expect(match).toBeDefined();
    return match![1];
  } finally {
    logSpy.mockRestore();
  }
}

async function createVerifiedCustomerSession(
  server: ReturnType<INestApplication["getHttpServer"]>,
  phone = nextTestPhone(),
) {
  const otpCode = await requestOtpAndCaptureCode(server, phone);
  const verifyRes = await request(server)
    .post(`${BASE}/auth/otp/verify`)
    .send({ phone, otp_code: otpCode })
    .expect(200);

  const setCookies = cookieList(verifyRes.headers["set-cookie"]);

  return {
    phone,
    otpCode,
    verifyRes,
    cookieHeader: cookieHeader(setCookies),
    csrfToken: cookieValue(setCookies, "csrf_token") ?? "",
  };
}

async function createCheckoutOrder(
  server: ReturnType<INestApplication["getHttpServer"]>,
  token: string,
  locationId: string,
  menuItemId: string,
  options?: {
    fulfillmentType?: "PICKUP" | "DELIVERY";
    quantity?: number;
    contactlessPref?: "HAND_TO_ME" | "LEAVE_AT_DOOR" | "CALL_ON_ARRIVAL" | "TEXT_ON_ARRIVAL";
    addressSnapshotJson?: Record<string, unknown>;
  },
): Promise<string> {
  const res = await authedPost(server, "/checkout", token, locationId)
    .set("Idempotency-Key", randomUUID())
    .send({
      location_id: locationId,
      fulfillment_type: options?.fulfillmentType ?? "PICKUP",
      items: [{ menu_item_id: menuItemId, quantity: options?.quantity ?? 1 }],
      contactless_pref: options?.contactlessPref,
      address_snapshot_json: options?.addressSnapshotJson,
    })
    .expect(201);

  return res.body.data.id;
}

async function getDeliveryOrderInput(
  prisma: PrismaService,
  locationId: string,
): Promise<{ itemId: string; quantity: number }> {
  const settings = await prisma.locationSettings.findUniqueOrThrow({
    where: { locationId },
    select: { minimumDeliverySubtotalCents: true },
  });
  const deliveryItem = await prisma.menuItem.findFirstOrThrow({
    where: {
      locationId,
      allowedFulfillmentType: { in: ["BOTH", "DELIVERY"] },
      isAvailable: true,
      archivedAt: null,
      basePriceCents: { gt: 0 },
    },
    orderBy: { basePriceCents: "desc" },
  });

  const minimumSubtotal = settings.minimumDeliverySubtotalCents;
  return {
    itemId: deliveryItem.id,
    quantity: Math.max(
      1,
      Math.ceil((minimumSubtotal > 0 ? minimumSubtotal : deliveryItem.basePriceCents) / deliveryItem.basePriceCents),
    ),
  };
}

async function setAlwaysOpenLocationHours(
  prisma: PrismaService,
  locationId: string,
) {
  await prisma.locationHours.deleteMany({
    where: { locationId, serviceType: { in: ["PICKUP", "DELIVERY"] } },
  });

  for (const serviceType of ["PICKUP", "DELIVERY"] as const) {
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      await prisma.locationHours.create({
        data: {
          locationId,
          serviceType,
          dayOfWeek,
          timeFrom: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
          timeTo: new Date(Date.UTC(1970, 0, 1, 23, 59, 0)),
          isClosed: false,
        },
      });
    }
  }
}

async function createBareOrderForSupportTest(
  prisma: PrismaService,
  params: {
    locationId: string;
    customerUserId: string;
    orderNumber?: bigint;
  },
): Promise<string> {
  const order = await prisma.order.create({
    data: {
      locationId: params.locationId,
      customerUserId: params.customerUserId,
      orderNumber:
        params.orderNumber ??
        BigInt(Date.now() + Math.floor(Math.random() * 100000)),
      orderSource: "ONLINE",
      fulfillmentType: "PICKUP",
      status: "PLACED",
      scheduledFor: new Date(),
      customerNameSnapshot: "Support Test Customer",
      customerPhoneSnapshot: "+15195550123",
      itemSubtotalCents: 1000,
      discountedSubtotalCents: 1000,
      taxableSubtotalCents: 1000,
      taxCents: 130,
      taxRateBps: 1300,
      finalPayableCents: 1130,
      paymentStatusSummary: "UNPAID",
    },
    select: { id: true },
  });

  return order.id;
}

async function createSupportTestCustomer(prisma: PrismaService): Promise<string> {
  const phone = nextTestPhone();
  const user = await prisma.user.create({
    data: {
      role: "CUSTOMER",
      displayName: "Support Test Customer",
      identities: {
        create: {
          provider: "PHONE_OTP",
          providerSubject: phone,
          phoneE164: phone,
          isPrimary: true,
          isVerified: true,
          verifiedAt: new Date(),
        },
      },
    },
    select: { id: true },
  });

  return user.id;
}

describe("API (e2e)", () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication["getHttpServer"]>;
  let prisma: PrismaService;
  let realtime: RealtimeGateway;

  let locationId: string;
  let customerUserId: string;
  let adminUserId: string;
  let managerUserId: string;
  let kitchenUserId: string;
  let cashierUserId: string;
  let driverUserId: string;
  let customerToken: string;
  let adminToken: string;
  let managerToken: string;
  let kitchenToken: string;
  let cashierToken: string;
  let driverToken: string;

  let firstMenuItemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    realtime = app.get(RealtimeGateway);

    const location = await prisma.location.findUnique({
      where: { code: "LON01" },
    });
    locationId = location!.id;
    await setAlwaysOpenLocationHours(prisma, locationId);

    const users = await prisma.user.findMany({
      include: { employeeProfile: true },
    });
    customerUserId = users.find((u) => u.role === "CUSTOMER")!.id;
    adminUserId = users.find((u) => u.role === "ADMIN")!.id;
    managerUserId = users.find(
      (u) => u.employeeProfile?.role === "MANAGER",
    )!.id;
    kitchenUserId = users.find(
      (u) => u.employeeProfile?.role === "KITCHEN",
    )!.id;
    cashierUserId = users.find(
      (u) => u.employeeProfile?.role === "CASHIER",
    )!.id;
    driverUserId = users.find(
      (u) => u.employeeProfile?.role === "DRIVER",
    )!.id;

    customerToken = await createSessionToken(prisma, customerUserId, "CUSTOMER");
    adminToken = await createSessionToken(prisma, adminUserId, "ADMIN");
    managerToken = await createSessionToken(
      prisma,
      managerUserId,
      "STAFF",
      "MANAGER",
    );
    kitchenToken = await createSessionToken(
      prisma,
      kitchenUserId,
      "STAFF",
      "KITCHEN",
    );
    cashierToken = await createSessionToken(
      prisma,
      cashierUserId,
      "STAFF",
      "CASHIER",
    );
    driverToken = await createSessionToken(
      prisma,
      driverUserId,
      "STAFF",
      "DRIVER",
    );
  });

  afterAll(async () => {
    await app.close();
  });

  /* ------------------------------------------------------------------ */
  /*  1. Health                                                          */
  /* ------------------------------------------------------------------ */

  describe("Health", () => {
    it("GET /health returns contract envelope", async () => {
      const res = await request(server).get(`${BASE}/health`).expect(200);

      expect(res.body.data).toMatchObject({ status: "ok", service: "api" });
      expect(res.body.meta?.request_id).toBeDefined();
      expect(res.body.errors).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  2. Auth flow                                                       */
  /* ------------------------------------------------------------------ */

  describe("Auth", () => {
    it("POST /auth/otp/request with valid phone returns success", async () => {
      const phone = nextTestPhone();
      const res = await request(server)
        .post(`${BASE}/auth/otp/request`)
        .send({ phone })
        .expect(200);

      expect(res.body.data).toMatchObject({
        otp_sent: true,
        expires_in_seconds: expect.any(Number),
      });
      expect(res.body.errors).toBeNull();
    });

    it("POST /auth/otp/request with invalid phone returns 422", async () => {
      await request(server)
        .post(`${BASE}/auth/otp/request`)
        .send({ phone: "not-a-phone" })
        .expect(422);
    });

    it("POST /auth/otp/request throttles repeat requests for the same phone", async () => {
      const phone = nextTestPhone();

      await request(server)
        .post(`${BASE}/auth/otp/request`)
        .send({ phone })
        .expect(200);

      const res = await request(server)
        .post(`${BASE}/auth/otp/request`)
        .send({ phone })
        .expect(401);

      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "UNAUTHORIZED",
            message: expect.stringContaining("Please wait"),
          }),
        ]),
      );
    });

    it("POST /auth/otp/verify with wrong code returns 401", async () => {
      const phone = nextTestPhone();
      await request(server)
        .post(`${BASE}/auth/otp/request`)
        .send({ phone })
        .expect(200);

      const res = await request(server)
        .post(`${BASE}/auth/otp/verify`)
        .send({ phone, otp_code: "0000" })
        .expect(401);

      expect(res.body.data).toBeNull();
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "UNAUTHORIZED" }),
        ]),
      );
    });

    it("POST /auth/otp/verify with invalid payload returns 422", async () => {
      await request(server)
        .post(`${BASE}/auth/otp/verify`)
        .send({ phone: "bad", otp_code: "" })
        .expect(422);
    });

    it("POST /auth/otp/verify with a valid code returns auth cookies and profile flags", async () => {
      const phone = nextTestPhone();
      const otpCode = await requestOtpAndCaptureCode(server, phone);

      const res = await request(server)
        .post(`${BASE}/auth/otp/verify`)
        .send({ phone, otp_code: otpCode })
        .expect(200);

      expect(res.body.data).toMatchObject({
        user: expect.objectContaining({
          role: "CUSTOMER",
          displayName: phone,
          phone,
        }),
        profile_complete: false,
        needs_profile_completion: true,
      });
      expect(cookieList(res.headers["set-cookie"])).toEqual(
        expect.arrayContaining([
          expect.stringContaining("access_token="),
          expect.stringContaining("refresh_token="),
          expect.stringContaining("csrf_token="),
        ]),
      );
    });

    it("GET /auth/session without auth returns a signed-out session", async () => {
      const res = await request(server)
        .get(`${BASE}/auth/session`)
        .expect(200);

      expect(res.body.data).toEqual({
        authenticated: false,
        profile_complete: false,
        needs_profile_completion: false,
      });
    });

    it("GET /auth/session with auth cookie returns the current customer session", async () => {
      const session = await createVerifiedCustomerSession(server);

      const res = await request(server)
        .get(`${BASE}/auth/session`)
        .set("Cookie", session.cookieHeader)
        .expect(200);

      expect(res.body.data).toMatchObject({
        authenticated: true,
        user: expect.objectContaining({
          role: "CUSTOMER",
          displayName: session.phone,
          phone: session.phone,
        }),
        profile_complete: false,
        needs_profile_completion: true,
      });
    });

    it("PUT /auth/profile without auth returns 401", async () => {
      await request(server)
        .put(`${BASE}/auth/profile`)
        .send({ full_name: "Unauthed User" })
        .expect(401);
    });

    it("PUT /auth/profile completes a provisional customer profile", async () => {
      const session = await createVerifiedCustomerSession(server);

      const res = await request(server)
        .put(`${BASE}/auth/profile`)
        .set("Cookie", session.cookieHeader)
        .set("X-CSRF-Token", session.csrfToken)
        .send({
          full_name: "Jane Verified",
          email: `verified.${Date.now()}@example.com`,
        })
        .expect(200);

      expect(res.body.data).toMatchObject({
        user: expect.objectContaining({
          displayName: "Jane Verified",
          firstName: "Jane",
          lastName: "Verified",
        }),
        profile_complete: true,
      });

      const sessionRes = await request(server)
        .get(`${BASE}/auth/session`)
        .set("Cookie", session.cookieHeader)
        .expect(200);

      expect(sessionRes.body.data).toMatchObject({
        authenticated: true,
        user: expect.objectContaining({
          displayName: "Jane Verified",
          phone: session.phone,
        }),
        profile_complete: true,
        needs_profile_completion: false,
      });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  3. Menu                                                            */
  /* ------------------------------------------------------------------ */

  describe("Menu", () => {
    it("GET /menu returns categories with items", async () => {
      const res = await request(server)
        .get(`${BASE}/menu`)
        .query({ location_id: locationId, fulfillment_type: "PICKUP" })
        .set("X-Location-Id", locationId)
        .expect(200);

      const { data } = res.body;
      expect(data).toHaveProperty("categories");
      expect(Array.isArray(data.categories)).toBe(true);
      expect(data.categories.length).toBeGreaterThan(0);

      const category = data.categories[0];
      expect(category).toHaveProperty("name");
      expect(category).toHaveProperty("items");
      expect(Array.isArray(category.items)).toBe(true);

      const allItems = data.categories.flatMap(
        (c: { items: unknown[] }) => c.items,
      ) as { id: string; name: string }[];
      expect(allItems.length).toBeGreaterThan(0);

      const wingItem = allItems.find((i) =>
        i.name.toLowerCase().includes("pound"),
      );
      expect(wingItem).toBeDefined();

      firstMenuItemId = allItems[0].id;
    });

    it("GET /menu without location header returns 422", async () => {
      await request(server)
        .get(`${BASE}/menu`)
        .query({ location_id: locationId, fulfillment_type: "PICKUP" })
        .expect(422);
    });

    it("GET /menu with mismatched location_id returns 422", async () => {
      const otherId = randomUUID();
      await request(server)
        .get(`${BASE}/menu`)
        .query({ location_id: otherId, fulfillment_type: "PICKUP" })
        .set("X-Location-Id", locationId)
        .expect(422);
    });

    it("GET /menu/wing-flavours returns flavours array", async () => {
      const res = await request(server)
        .get(`${BASE}/menu/wing-flavours`)
        .set("X-Location-Id", locationId)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  4. Cart quote                                                      */
  /* ------------------------------------------------------------------ */

  describe("Cart quote", () => {
    it("POST /cart/quote with valid items returns pricing", async () => {
      const res = await authedPost(server, "/cart/quote", customerToken, locationId)
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);

      const { data } = res.body;
      expect(data).toHaveProperty("item_subtotal_cents");
      expect(data).toHaveProperty("tax_cents");
      expect(data).toHaveProperty("final_payable_cents");
      expect(typeof data.item_subtotal_cents).toBe("number");
      expect(typeof data.final_payable_cents).toBe("number");
    });

    it("POST /cart/quote without auth still returns pricing", async () => {
      const res = await request(server)
        .post(`${BASE}/cart/quote`)
        .set("X-Location-Id", locationId)
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);

      expect(res.body.data).toHaveProperty("item_subtotal_cents");
      expect(res.body.data).toHaveProperty("tax_cents");
      expect(res.body.data).toHaveProperty("final_payable_cents");
    });

    it("POST /cart/quote with invalid item ID returns 422", async () => {
      const res = await authedPost(server, "/cart/quote", customerToken, locationId)
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: "not-a-uuid", quantity: 1 }],
        })
        .expect(422);

      expect(res.body.errors).toBeDefined();
      expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it("authenticated delivery quotes are blocked when customer no-shows exceed the threshold, but anonymous quotes still work", async () => {
      const { itemId, quantity } = await getDeliveryOrderInput(prisma, locationId);
      const settings = await prisma.locationSettings.findUniqueOrThrow({
        where: { locationId },
        select: { prepaymentThresholdNoShows: true },
      });

      await prisma.customerProfile.upsert({
        where: { userId: customerUserId },
        update: {
          totalNoShows: settings.prepaymentThresholdNoShows + 1,
          prepaymentRequired: false,
        },
        create: {
          userId: customerUserId,
          totalNoShows: settings.prepaymentThresholdNoShows + 1,
        },
      });

      try {
        const blocked = await authedPost(server, "/cart/quote", customerToken, locationId)
          .send({
            location_id: locationId,
            fulfillment_type: "DELIVERY",
            items: [{ menu_item_id: itemId, quantity }],
          })
          .expect(422);

        expect(blocked.body.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining("Delivery is unavailable"),
            }),
          ]),
        );

        await request(server)
          .post(`${BASE}/cart/quote`)
          .set("X-Location-Id", locationId)
          .send({
            location_id: locationId,
            fulfillment_type: "DELIVERY",
            items: [{ menu_item_id: itemId, quantity }],
          })
          .expect(201);
      } finally {
        await prisma.customerProfile.upsert({
          where: { userId: customerUserId },
          update: {
            totalNoShows: 0,
            prepaymentRequired: false,
          },
          create: { userId: customerUserId },
        });
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  5. Checkout + order creation                                       */
  /* ------------------------------------------------------------------ */

  describe("Checkout", () => {
    const idempotencyKey = randomUUID();
    let orderId: string;

    it("POST /checkout without Idempotency-Key returns 400", async () => {
      const res = await authedPost(server, "/checkout", customerToken, locationId)
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(400);

      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining("Idempotency-Key"),
          }),
        ]),
      );
    });

    it("POST /checkout with an incomplete customer profile returns 403 PROFILE_INCOMPLETE", async () => {
      const session = await createVerifiedCustomerSession(server);

      const res = await request(server)
        .post(`${BASE}/checkout`)
        .set("X-Location-Id", locationId)
        .set("Cookie", session.cookieHeader)
        .set("X-CSRF-Token", session.csrfToken)
        .set("Idempotency-Key", randomUUID())
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(403);

      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "PROFILE_INCOMPLETE",
            message: "Customer profile is incomplete",
          }),
        ]),
      );
    });

    it("over-threshold customers cannot checkout DELIVERY but can still checkout PICKUP", async () => {
      const { itemId, quantity } = await getDeliveryOrderInput(prisma, locationId);
      const settings = await prisma.locationSettings.findUniqueOrThrow({
        where: { locationId },
        select: { prepaymentThresholdNoShows: true },
      });

      await prisma.customerProfile.upsert({
        where: { userId: customerUserId },
        update: {
          totalNoShows: settings.prepaymentThresholdNoShows + 1,
          prepaymentRequired: false,
        },
        create: {
          userId: customerUserId,
          totalNoShows: settings.prepaymentThresholdNoShows + 1,
        },
      });

      try {
        const blocked = await authedPost(server, "/checkout", customerToken, locationId)
          .set("Idempotency-Key", randomUUID())
          .send({
            location_id: locationId,
            fulfillment_type: "DELIVERY",
            items: [{ menu_item_id: itemId, quantity }],
            address_snapshot_json: {
              line1: "1544 Dundas St",
              city: "London",
              postal_code: "N5W3C1",
            },
          })
          .expect(422);

        expect(blocked.body.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining("Delivery is unavailable"),
            }),
          ]),
        );

        await authedPost(server, "/checkout", customerToken, locationId)
          .set("Idempotency-Key", randomUUID())
          .send({
            location_id: locationId,
            fulfillment_type: "PICKUP",
            items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
          })
          .expect(201);
      } finally {
        await prisma.customerProfile.upsert({
          where: { userId: customerUserId },
          update: {
            totalNoShows: 0,
            prepaymentRequired: false,
          },
          create: { userId: customerUserId },
        });
      }
    });

    it("POST /checkout rejects archived menu items explicitly", async () => {
      await prisma.menuItem.update({
        where: { id: firstMenuItemId },
        data: { archivedAt: new Date() },
      });

      try {
        const res = await authedPost(server, "/checkout", customerToken, locationId)
          .set("Idempotency-Key", randomUUID())
          .send({
            location_id: locationId,
            fulfillment_type: "PICKUP",
            items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
          })
          .expect(422);

        expect(res.body.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining("no longer available"),
            }),
          ]),
        );
      } finally {
        await prisma.menuItem.update({
          where: { id: firstMenuItemId },
          data: { archivedAt: null },
        });
      }
    });

    it("POST /checkout rejects archived salad customization targets explicitly", async () => {
      const wingItem = await prisma.menuItem.findFirstOrThrow({
        where: {
          locationId,
          builderType: { in: ["WINGS", "WING_COMBO"] },
          isAvailable: true,
          archivedAt: null,
        },
        orderBy: { createdAt: "asc" },
      });
      const saladItem = await prisma.menuItem.findFirstOrThrow({
        where: {
          locationId,
          category: { slug: "salads" },
          isAvailable: true,
          archivedAt: null,
        },
        orderBy: { createdAt: "asc" },
      });

      await prisma.menuItem.update({
        where: { id: saladItem.id },
        data: { archivedAt: new Date() },
      });

      try {
        const res = await authedPost(server, "/checkout", customerToken, locationId)
          .set("Idempotency-Key", randomUUID())
          .send({
            location_id: locationId,
            fulfillment_type: "PICKUP",
            items: [
              {
                menu_item_id: wingItem.id,
                quantity: 1,
                builder_payload: {
                  builder_type: wingItem.builderType,
                  wing_type: "BONE_IN",
                  preparation: "BREADED",
                  weight_lb: 1,
                  flavour_slots: [],
                  salad_customization: {
                    salad_menu_item_id: saladItem.id,
                    removed_ingredients: [],
                    modifier_selections: [],
                  },
                },
              },
            ],
          })
          .expect(422);

        expect(res.body.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining("Salad menu item"),
            }),
          ]),
        );
      } finally {
        await prisma.menuItem.update({
          where: { id: saladItem.id },
          data: { archivedAt: null },
        });
      }
    });

    it("POST /checkout rejects delivery postals outside allowed_postal_codes", async () => {
      const { itemId, quantity } = await getDeliveryOrderInput(prisma, locationId);

      const res = await authedPost(server, "/checkout", customerToken, locationId)
        .set("Idempotency-Key", randomUUID())
        .send({
          location_id: locationId,
          fulfillment_type: "DELIVERY",
          items: [{ menu_item_id: itemId, quantity }],
          address_snapshot_json: {
            line1: "999 Test Ave",
            city: "London",
            province: "ON",
            postal_code: "N1N1N1",
          },
        })
        .expect(422);

      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "address_snapshot_json.postal_code",
            message: expect.stringContaining("Delivery is not available"),
          }),
        ]),
      );
    });

    it("POST /checkout rejects scheduled_for values before the minimum lead time", async () => {
      const settings = await prisma.locationSettings.findUniqueOrThrow({
        where: { locationId },
        select: {
          defaultPrepTimeMinutes: true,
          busyModeEnabled: true,
          busyModePrepTimeMinutes: true,
        },
      });
      const minLeadMinutes =
        settings.busyModeEnabled && settings.busyModePrepTimeMinutes
          ? settings.busyModePrepTimeMinutes
          : settings.defaultPrepTimeMinutes;
      const tooSoon = new Date(
        Date.now() + Math.max(1, minLeadMinutes - 1) * 60_000,
      ).toISOString();

      const res = await authedPost(server, "/checkout", customerToken, locationId)
        .set("Idempotency-Key", randomUUID())
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          scheduled_for: tooSoon,
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(422);

      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "scheduled_for",
            message: expect.stringContaining("Scheduled time must be at least"),
          }),
        ]),
      );
    });

    it("concurrent wallet-backed checkouts debit once and reject the overspend", async () => {
      const item = await prisma.menuItem.findUniqueOrThrow({
        where: { id: firstMenuItemId },
        select: { basePriceCents: true },
      });
      const walletAppliedCents = Math.max(1, Math.min(item.basePriceCents, 500));

      await prisma.customerWallet.upsert({
        where: { customerUserId: customerUserId },
        update: { balanceCents: walletAppliedCents, lifetimeCreditCents: walletAppliedCents },
        create: {
          customerUserId,
          balanceCents: walletAppliedCents,
          lifetimeCreditCents: walletAppliedCents,
        },
      });

      try {
        const [first, second] = await Promise.all([
          authedPost(server, "/checkout", customerToken, locationId)
            .set("Idempotency-Key", randomUUID())
            .send({
              location_id: locationId,
              fulfillment_type: "PICKUP",
              wallet_applied_cents: walletAppliedCents,
              items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
            }),
          authedPost(server, "/checkout", customerToken, locationId)
            .set("Idempotency-Key", randomUUID())
            .send({
              location_id: locationId,
              fulfillment_type: "PICKUP",
              wallet_applied_cents: walletAppliedCents,
              items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
            }),
        ]);

        const statuses = [first.status, second.status].sort((a, b) => a - b);
        expect(statuses).toEqual([201, 422]);

        const failed = first.status === 422 ? first : second;
        expect(failed.body.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: "wallet_applied_cents",
              message: "Insufficient wallet balance",
            }),
          ]),
        );

        const wallet = await prisma.customerWallet.findUniqueOrThrow({
          where: { customerUserId },
          select: { balanceCents: true },
        });
        expect(wallet.balanceCents).toBe(0);
      } finally {
        await prisma.customerWallet.upsert({
          where: { customerUserId },
          update: { balanceCents: 0 },
          create: {
            customerUserId,
            balanceCents: 0,
            lifetimeCreditCents: 0,
          },
        });
      }
    });

    it("POST /checkout with valid cart creates order", async () => {
      const res = await authedPost(server, "/checkout", customerToken, locationId)
        .set("Idempotency-Key", idempotencyKey)
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 2 }],
        })
        .expect(201);

      const { data } = res.body;
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("status");
      expect(data).toHaveProperty("cancel_allowed_until");
      expect(new Date(data.cancel_allowed_until).getTime()).toBeGreaterThan(Date.now());
      orderId = data.id;
    });

    it("POST /checkout with same Idempotency-Key is idempotent", async () => {
      const res = await authedPost(server, "/checkout", customerToken, locationId)
        .set("Idempotency-Key", idempotencyKey)
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 2 }],
        })
        .expect(201);

      expect(res.body.data.id).toBe(orderId);
    });

    it("POST /checkout without auth returns 401", async () => {
      await request(server)
        .post(`${BASE}/checkout`)
        .set("X-Location-Id", locationId)
        .set("Idempotency-Key", randomUUID())
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(401);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  6. Orders                                                          */
  /* ------------------------------------------------------------------ */

  describe("Orders", () => {
    let orderId: string;

    beforeAll(async () => {
      const res = await authedPost(server, "/checkout", customerToken, locationId)
        .set("Idempotency-Key", randomUUID())
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        });
      orderId = res.body.data.id;
    });

    it("GET /orders returns order list for customer", async () => {
      const res = await authedGet(server, "/orders", customerToken, locationId)
        .expect(200);

      const { data } = res.body;
      expect(data).toHaveProperty("orders");
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBeGreaterThan(0);

      const order = data.orders[0];
      expect(order).toHaveProperty("id");
      expect(order).toHaveProperty("status");
      expect(order).toHaveProperty("unread_chat_count");
      expect(typeof order.unread_chat_count).toBe("number");
    });

    it("GET /orders surfaces unread_chat_count when staff messages are unread", async () => {
      // Post a staff message on orderId so the customer sees unread > 0.
      await authedPost(server, `/orders/${orderId}/chat`, managerToken, locationId)
        .send({ message_body: "Heads up — your order is in prep." })
        .expect(201);

      const res = await authedGet(server, "/orders", customerToken, locationId)
        .expect(200);
      const row = res.body.data.orders.find(
        (o: { id: string }) => o.id === orderId,
      );
      expect(row).toBeTruthy();
      expect(row.unread_chat_count).toBeGreaterThan(0);
    });

    it("GET /orders/:id returns order detail", async () => {
      const res = await authedGet(
        server,
        `/orders/${orderId}`,
        customerToken,
        locationId,
      ).expect(200);

      expect(res.body.data).toHaveProperty("id", orderId);
      expect(res.body.data).toHaveProperty("items");
    });

    it("GET /orders without auth returns 401", async () => {
      await request(server)
        .get(`${BASE}/orders`)
        .set("X-Location-Id", locationId)
        .expect(401);
    });

    it("POST /orders/:id/cancel directly cancels within 2-min window", async () => {
      const res = await authedPost(
        server,
        `/orders/${orderId}/cancel`,
        customerToken,
        locationId,
      )
        .send({ reason: "Changed my mind" })
        .expect(201);

      expect(res.body.data).toMatchObject({
        status: "CANCELLED",
        cancellation_source: "CUSTOMER_SELF",
      });
      expect(res.body.data.cancelled_at).toBeDefined();
      expect(res.body.errors).toBeNull();
    });

    it("POST /orders/:id/cancel without reason also succeeds in window", async () => {
      const freshOrder = await authedPost(
        server,
        "/checkout",
        customerToken,
        locationId,
      )
        .set("Idempotency-Key", `cancel-test-${Date.now()}`)
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        });

      if (freshOrder.status === 201 && freshOrder.body.data?.id) {
        const cancelRes = await authedPost(
          server,
          `/orders/${freshOrder.body.data.id}/cancel`,
          customerToken,
          locationId,
        )
          .send({})
          .expect(201);

        expect(cancelRes.body.data.status).toBe("CANCELLED");
      }
    });

    it("POST /orders/:id/cancel emits KDS realtime removal and excludes order from active KDS feed", async () => {
      const freshOrder = await authedPost(
        server,
        "/checkout",
        customerToken,
        locationId,
      )
        .set("Idempotency-Key", randomUUID())
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);

      const freshOrderId = freshOrder.body.data.id as string;
      const emitSpy = jest.spyOn(realtime, "emitOrderEvent");
      emitSpy.mockClear();

      try {
        await authedPost(
          server,
          `/orders/${freshOrderId}/cancel`,
          customerToken,
          locationId,
        )
          .send({})
          .expect(201);

        expect(emitSpy).toHaveBeenCalledWith(
          locationId,
          freshOrderId,
          "order.cancelled",
          expect.objectContaining({
            order_id: freshOrderId,
            from_status: "PLACED",
            to_status: "CANCELLED",
            cancellation_source: "CUSTOMER_SELF",
          }),
        );
      } finally {
        emitSpy.mockRestore();
      }

      const kdsRes = await authedGet(
        server,
        "/kds/orders?statuses=PLACED,ACCEPTED,PREPARING,READY,OUT_FOR_DELIVERY",
        managerToken,
        locationId,
      ).expect(200);
      const activeIds = (kdsRes.body.data as Array<{ id: string }>).map(
        (order) => order.id,
      );
      expect(activeIds).not.toContain(freshOrderId);
    });

    // PRD §12.6 / QA matrix: customer self-cancel with captured payment → auto PENDING refund_request
    it("POST /orders/:id/cancel creates pending refund request when order has successful capture", async () => {
      const checkoutRes = await authedPost(server, "/checkout", customerToken, locationId)
        .set("Idempotency-Key", randomUUID())
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);

      const paidOrderId = checkoutRes.body.data.id as string;
      const orderRow = await prisma.order.findUniqueOrThrow({
        where: { id: paidOrderId },
        select: { finalPayableCents: true, locationId: true },
      });

      await prisma.orderPayment.create({
        data: {
          orderId: paidOrderId,
          locationId: orderRow.locationId,
          paymentMethod: "CARD",
          transactionType: "CAPTURE",
          transactionStatus: "SUCCESS",
          signedAmountCents: orderRow.finalPayableCents,
          initiatedByUserId: customerUserId,
          createdByUserId: customerUserId,
        },
      });

      await prisma.order.update({
        where: { id: paidOrderId },
        data: { cancelAllowedUntil: new Date(Date.now() + 120_000) },
      });

      const cancelRes = await authedPost(
        server,
        `/orders/${paidOrderId}/cancel`,
        customerToken,
        locationId,
      )
        .send({ reason: "no longer needed" })
        .expect(201);

      expect(cancelRes.body.data).toMatchObject({
        status: "CANCELLED",
        cancellation_source: "CUSTOMER_SELF",
      });

      const refunds = await prisma.refundRequest.findMany({
        where: { orderId: paidOrderId },
        orderBy: { createdAt: "asc" },
      });
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({
        status: "PENDING",
        amountCents: orderRow.finalPayableCents,
      });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  7. KDS lifecycle                                                   */
  /* ------------------------------------------------------------------ */

  describe("KDS lifecycle", () => {
    it("POST /kds/orders/:id/accept moves PLACED pickup orders to PREPARING and records both audit hops", async () => {
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        firstMenuItemId,
      );

      const res = await authedPost(
        server,
        `/kds/orders/${orderId}/accept`,
        managerToken,
        locationId,
      )
        .send({})
        .expect(201);

      expect(res.body.data.status).toBe("PREPARING");
      expect(res.body.data.accepted_at).toBeDefined();

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true, acceptedAt: true },
      });

      expect(order).toMatchObject({
        status: "PREPARING",
        acceptedAt: expect.any(Date),
      });

      const events = await prisma.orderStatusEvent.findMany({
        where: { orderId },
        orderBy: { createdAt: "asc" },
      });

      const acceptEvent = events.find((event) => event.eventType === "KDS_ACCEPT");
      const autoPreparingEvent = events.find(
        (event) => event.eventType === "KDS_AUTO_PREPARING",
      );

      expect(acceptEvent).toMatchObject({
        fromStatus: "PLACED",
        toStatus: "ACCEPTED",
      });
      expect(autoPreparingEvent).toMatchObject({
        fromStatus: "ACCEPTED",
        toStatus: "PREPARING",
      });
    });

    it("READY pickup orders can transition to NO_SHOW_PICKUP and close chat", async () => {
      await prisma.customerProfile.upsert({
        where: { userId: customerUserId },
        update: {
          totalNoShows: 0,
          prepaymentRequired: false,
        },
        create: { userId: customerUserId },
      });

      try {
        const orderId = await createCheckoutOrder(
          server,
          customerToken,
          locationId,
          firstMenuItemId,
        );

        await authedPost(
          server,
          `/orders/${orderId}/chat`,
          customerToken,
          locationId,
        )
          .send({ message_body: "Will my pickup be ready soon?" })
          .expect(201);

        await authedPost(
          server,
          `/kds/orders/${orderId}/accept`,
          managerToken,
          locationId,
        )
          .send({})
          .expect(201);

        await authedPost(
          server,
          `/kds/orders/${orderId}/status`,
          managerToken,
          locationId,
        )
          .send({ status: "READY" })
          .expect(201);

        const noShowRes = await authedPost(
          server,
          `/kds/orders/${orderId}/status`,
          managerToken,
          locationId,
        )
          .send({ status: "NO_SHOW_PICKUP" })
          .expect(201);

        expect(noShowRes.body.data.status).toBe("NO_SHOW_PICKUP");

        const chatRes = await authedGet(
          server,
          `/orders/${orderId}/chat`,
          customerToken,
          locationId,
        ).expect(200);

        expect(chatRes.body.data.is_closed).toBe(true);
      } finally {
        await prisma.customerProfile.upsert({
          where: { userId: customerUserId },
          update: {
            totalNoShows: 0,
            prepaymentRequired: false,
          },
          create: { userId: customerUserId },
        });
      }
    });

    it("NO_SHOW transitions increment customer total_no_shows exactly once", async () => {
      await prisma.customerProfile.upsert({
        where: { userId: customerUserId },
        update: {
          totalNoShows: 0,
          prepaymentRequired: false,
        },
        create: { userId: customerUserId },
      });

      try {
        const orderId = await createCheckoutOrder(
          server,
          customerToken,
          locationId,
          firstMenuItemId,
        );

        await authedPost(server, `/kds/orders/${orderId}/accept`, managerToken, locationId)
          .send({})
          .expect(201);
        await authedPost(server, `/kds/orders/${orderId}/status`, managerToken, locationId)
          .send({ status: "READY" })
          .expect(201);
        await authedPost(server, `/kds/orders/${orderId}/status`, managerToken, locationId)
          .send({ status: "NO_SHOW_PICKUP" })
          .expect(201);

        const profile = await prisma.customerProfile.findUniqueOrThrow({
          where: { userId: customerUserId },
          select: { totalNoShows: true },
        });
        expect(profile.totalNoShows).toBe(1);
      } finally {
        await prisma.customerProfile.upsert({
          where: { userId: customerUserId },
          update: {
            totalNoShows: 0,
            prepaymentRequired: false,
          },
          create: { userId: customerUserId },
        });
      }
    });

    it("delivery orders can progress from READY to assigned driver to OUT_FOR_DELIVERY to DELIVERED", async () => {
      const deliveryItem = await prisma.menuItem.findFirstOrThrow({
        where: {
          locationId,
          allowedFulfillmentType: { in: ["BOTH", "DELIVERY"] },
          basePriceCents: { gt: 0 },
        },
        orderBy: { basePriceCents: "desc" },
      });

      const { minimumDeliverySubtotalCents } = await prisma.locationSettings.findUniqueOrThrow({
        where: { locationId },
        select: { minimumDeliverySubtotalCents: true },
      });
      const quantity = Math.max(
        1,
        Math.ceil(minimumDeliverySubtotalCents / deliveryItem.basePriceCents),
      );
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        deliveryItem.id,
        {
          fulfillmentType: "DELIVERY",
          quantity,
          contactlessPref: "HAND_TO_ME",
          addressSnapshotJson: {
            line1: "1544 Dundas St",
            city: "London",
            province: "ON",
            postal_code: "N5W3C1",
          },
        },
      );

      await prisma.driverProfile.update({
        where: { userId: driverUserId },
        data: {
          availabilityStatus: "AVAILABLE",
          isOnDelivery: false,
        },
      });

      await authedPost(
        server,
        `/kds/orders/${orderId}/accept`,
        managerToken,
        locationId,
      )
        .send({})
        .expect(201);

      await authedPost(
        server,
        `/kds/orders/${orderId}/status`,
        managerToken,
        locationId,
      )
        .send({ status: "READY" })
        .expect(201);

      const assignRes = await authedPost(
        server,
        `/kds/orders/${orderId}/assign-driver`,
        managerToken,
        locationId,
      )
        .send({ driver_user_id: driverUserId })
        .expect(201);

      expect(assignRes.body.data.assigned_driver_user_id).toBe(driverUserId);

      const startRes = await authedPost(
        server,
        `/kds/orders/${orderId}/start-delivery`,
        managerToken,
        locationId,
      )
        .send({})
        .expect(201);

      expect(startRes.body.data.status).toBe("OUT_FOR_DELIVERY");
      expect(startRes.body.data.delivery_started_at).toBeDefined();

      const pinRow = await prisma.deliveryPinVerification.findUniqueOrThrow({
        where: { orderId },
        select: { pinPlaintext: true },
      });
      const completeRes = await authedPost(
        server,
        `/kds/orders/${orderId}/complete-delivery`,
        managerToken,
        locationId,
      )
        .send({ pin: pinRow.pinPlaintext ?? "0000" })
        .expect(201);

      expect(completeRes.body.data.status).toBe("DELIVERED");
      expect(completeRes.body.data.delivery_completed_at).toBeDefined();

      const driver = await prisma.driverProfile.findUniqueOrThrow({
        where: { userId: driverUserId },
        select: { availabilityStatus: true, isOnDelivery: true },
      });

      expect(driver).toMatchObject({
        availabilityStatus: "AVAILABLE",
        isOnDelivery: false,
      });
    });

    // Delivery no-shows should close out the driver assignment.
    it("NO_SHOW_DELIVERY releases the assigned driver for the next delivery order", async () => {
      const { itemId, quantity } = await getDeliveryOrderInput(prisma, locationId);
      const deliveryOrderOptions = {
        fulfillmentType: "DELIVERY" as const,
        quantity,
        contactlessPref: "HAND_TO_ME" as const,
        addressSnapshotJson: {
          line1: "1544 Dundas St",
          city: "London",
          province: "ON",
          postal_code: "N5W3C1",
        },
      };

      await prisma.driverProfile.update({
        where: { userId: driverUserId },
        data: {
          availabilityStatus: "AVAILABLE",
          isOnDelivery: false,
        },
      });

      const firstOrderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        itemId,
        deliveryOrderOptions,
      );

      await authedPost(server, `/kds/orders/${firstOrderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);
      await authedPost(server, `/kds/orders/${firstOrderId}/status`, managerToken, locationId)
        .send({ status: "READY" })
        .expect(201);
      await authedPost(server, `/kds/orders/${firstOrderId}/assign-driver`, managerToken, locationId)
        .send({ driver_user_id: driverUserId })
        .expect(201);
      await authedPost(server, `/kds/orders/${firstOrderId}/start-delivery`, managerToken, locationId)
        .send({})
        .expect(201);

      const noShowRes = await authedPost(
        server,
        `/kds/orders/${firstOrderId}/status`,
        managerToken,
        locationId,
      )
        .send({ status: "NO_SHOW_DELIVERY", reason: "Customer unavailable" })
        .expect(201);

      expect(noShowRes.body.data.status).toBe("NO_SHOW_DELIVERY");
      expect(noShowRes.body.data.delivery_completed_at).toBeDefined();

      const driverAfterNoShow = await prisma.driverProfile.findUniqueOrThrow({
        where: { userId: driverUserId },
        select: {
          availabilityStatus: true,
          isOnDelivery: true,
          lastDeliveryCompletedAt: true,
        },
      });
      expect(driverAfterNoShow).toMatchObject({
        availabilityStatus: "AVAILABLE",
        isOnDelivery: false,
      });
      expect(driverAfterNoShow.lastDeliveryCompletedAt).not.toBeNull();

      const noShowDriverEvent = await prisma.orderDriverEvent.findFirst({
        where: { orderId: firstOrderId, eventType: "DELIVERY_NO_SHOW" },
      });
      expect(noShowDriverEvent?.driverUserId).toBe(driverUserId);

      const secondOrderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        itemId,
        deliveryOrderOptions,
      );

      await authedPost(server, `/kds/orders/${secondOrderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);
      await authedPost(server, `/kds/orders/${secondOrderId}/status`, managerToken, locationId)
        .send({ status: "READY" })
        .expect(201);

      const nextAssignRes = await authedPost(
        server,
        `/kds/orders/${secondOrderId}/assign-driver`,
        managerToken,
        locationId,
      )
        .send({ driver_user_id: driverUserId })
        .expect(201);

      expect(nextAssignRes.body.data.assigned_driver_user_id).toBe(driverUserId);
    });

    // PRD §11.1B: auto-accept fires when the KDS heartbeat is fresh.
    it("auto-accept worker promotes PLACED orders to PREPARING when heartbeat is healthy", async () => {
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        firstMenuItemId,
      );

      // Backdate placedAt past the auto-accept deadline.
      await prisma.order.update({
        where: { id: orderId },
        data: { placedAt: new Date(Date.now() - 60_000) },
      });

      await authedPost(server, "/kds/heartbeat", managerToken, locationId)
        .send({ session_key: "e2e-auto-accept" })
        .expect(201);

      const worker = app.get(KdsAutoAcceptWorker);
      await worker.tick();

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true, requiresManualReview: true, acceptedAt: true },
      });
      expect(order.status).toBe("PREPARING");
      expect(order.requiresManualReview).toBe(false);
      expect(order.acceptedAt).not.toBeNull();

      const events = await prisma.orderStatusEvent.findMany({
        where: { orderId },
        select: { eventType: true },
      });
      expect(events.map((e) => e.eventType)).toEqual(
        expect.arrayContaining(["SYSTEM_AUTO_ACCEPT", "SYSTEM_AUTO_PREPARING"]),
      );
    });

    // PRD §11.1B: without a fresh heartbeat the worker must flag rather than
    // silently auto-accept.
    it("auto-accept worker flags manual review when no recent heartbeat", async () => {
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        firstMenuItemId,
      );

      await prisma.order.update({
        where: { id: orderId },
        data: { placedAt: new Date(Date.now() - 60_000) },
      });
      await prisma.kdsHeartbeat.deleteMany({ where: { locationId } });

      const worker = app.get(KdsAutoAcceptWorker);
      await worker.tick();

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true, requiresManualReview: true },
      });
      expect(order.status).toBe("PLACED");
      expect(order.requiresManualReview).toBe(true);
    });

    // PRD §11.1B: a human accept on a flagged order clears manual_review.
    it("KDS accept clears requires_manual_review flag on flagged orders", async () => {
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        firstMenuItemId,
      );
      await prisma.order.update({
        where: { id: orderId },
        data: { requiresManualReview: true },
      });

      await authedPost(server, `/kds/orders/${orderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { requiresManualReview: true, status: true },
      });
      expect(order.requiresManualReview).toBe(false);
      expect(order.status).toBe("PREPARING");
    });

    // PRD §11.3: ETA delta buttons shift estimatedReadyAt and log an event.
    it("KDS ETA delta shifts estimated_ready_at and records an order_eta_event", async () => {
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        firstMenuItemId,
      );
      await authedPost(server, `/kds/orders/${orderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);

      const before = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { estimatedReadyAt: true, estimatedWindowMaxMinutes: true },
      });

      const res = await authedPost(
        server,
        `/kds/orders/${orderId}/eta-delta`,
        managerToken,
        locationId,
      )
        .send({ delta_minutes: 5 })
        .expect(201);

      expect(res.body.data.delta_minutes).toBe(5);

      const after = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { estimatedReadyAt: true, estimatedWindowMaxMinutes: true },
      });
      const baseline = (before.estimatedReadyAt ?? new Date()).getTime();
      expect(after.estimatedReadyAt!.getTime() - baseline).toBe(5 * 60_000);
      if (before.estimatedWindowMaxMinutes != null) {
        expect(after.estimatedWindowMaxMinutes).toBe(
          before.estimatedWindowMaxMinutes + 5,
        );
      }

      const etaEvents = await prisma.orderEtaEvent.findMany({
        where: { orderId },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(etaEvents[0]?.reason).toBe("KDS_ETA_DELTA:+5");
    });

    it("KDS ETA delta rejects stale PLACED orders after the auto-accept window", async () => {
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        firstMenuItemId,
      );

      await prisma.order.update({
        where: { id: orderId },
        data: { placedAt: new Date(Date.now() - 60_000) },
      });

      const res = await authedPost(
        server,
        `/kds/orders/${orderId}/eta-delta`,
        managerToken,
        locationId,
      )
        .send({ delta_minutes: 5 })
        .expect(422);

      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining("ETA can only be adjusted within"),
          }),
        ]),
      );
    });

    it("KDS-approved cancel requests close chat and preserve KDS_CANCEL_REQUEST as the source", async () => {
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        firstMenuItemId,
      );

      await authedPost(server, `/orders/${orderId}/chat`, customerToken, locationId)
        .send({ message_body: "Please cancel if possible." })
        .expect(201);

      await authedPost(server, `/kds/orders/${orderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);

      await authedPost(
        server,
        `/kds/orders/${orderId}/request-cancellation`,
        managerToken,
        locationId,
      )
        .send({ reason: "Kitchen cannot fulfill this item" })
        .expect(201);

      await authedPost(
        server,
        `/kds/orders/${orderId}/cancel-request`,
        managerToken,
        locationId,
      )
        .send({ action: "APPROVE", admin_notes: "Approved in kitchen" })
        .expect(201);

      const chatRes = await authedGet(
        server,
        `/orders/${orderId}/chat`,
        customerToken,
        locationId,
      ).expect(200);
      expect(chatRes.body.data.is_closed).toBe(true);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true, cancellationSource: true },
      });
      expect(order).toMatchObject({
        status: "CANCELLED",
        cancellationSource: "KDS_CANCEL_REQUEST",
      });
    });

    it("admin-approved chat cancellations close chat, preserve KDS_CHAT_REQUEST, and create one pending refund request", async () => {
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        firstMenuItemId,
      );

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { finalPayableCents: true },
      });
      await prisma.orderPayment.create({
        data: {
          orderId,
          locationId,
          paymentMethod: "CARD",
          transactionType: "CAPTURE",
          transactionStatus: "SUCCESS",
          signedAmountCents: order.finalPayableCents,
          initiatedByUserId: customerUserId,
          createdByUserId: customerUserId,
        },
      });

      await authedPost(server, `/orders/${orderId}/chat`, customerToken, locationId)
        .send({ message_body: "I requested a cancellation in chat." })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);

      const conversation = await prisma.orderConversation.findUniqueOrThrow({
        where: { orderId },
        select: { id: true },
      });

      const requestRes = await authedPost(
        server,
        `/kds/orders/${orderId}/request-chat-cancellation`,
        managerToken,
        locationId,
      )
        .send({
          reason: "Customer requested cancellation in chat",
          conversation_id: conversation.id,
        })
        .expect(201);

      expect(requestRes.body.data.request_source).toBe("KDS_CHAT_REQUEST");
      expect(requestRes.body.data.chat_thread_id).toBe(conversation.id);

      await authedPost(
        server,
        `/admin/cancellation-requests/${requestRes.body.data.id}/decide`,
        adminToken,
        locationId,
      )
        .send({ action: "APPROVE", admin_notes: "Approved from support review" })
        .expect(201);

      const chatRes = await authedGet(
        server,
        `/orders/${orderId}/chat`,
        customerToken,
        locationId,
      ).expect(200);
      expect(chatRes.body.data.is_closed).toBe(true);

      const cancelledOrder = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true, cancellationSource: true },
      });
      expect(cancelledOrder).toMatchObject({
        status: "CANCELLED",
        cancellationSource: "KDS_CHAT_REQUEST",
      });

      const refundRequests = await prisma.refundRequest.findMany({
        where: { orderId },
        orderBy: { createdAt: "asc" },
      });
      expect(refundRequests).toHaveLength(1);
      expect(refundRequests[0]).toMatchObject({
        status: "PENDING",
        amountCents: order.finalPayableCents,
      });
    });

    it("overdue delivery worker opens one overdue support ticket per order", async () => {
      const { itemId, quantity } = await getDeliveryOrderInput(prisma, locationId);
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        itemId,
        {
          fulfillmentType: "DELIVERY",
          quantity,
          contactlessPref: "HAND_TO_ME",
          addressSnapshotJson: {
            line1: "1544 Dundas St",
            city: "London",
            province: "ON",
            postal_code: "N5W3C1",
          },
        },
      );

      await prisma.driverProfile.update({
        where: { userId: driverUserId },
        data: { availabilityStatus: "AVAILABLE", isOnDelivery: false },
      });

      await authedPost(server, `/kds/orders/${orderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/status`, managerToken, locationId)
        .send({ status: "READY" })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/assign-driver`, managerToken, locationId)
        .send({ driver_user_id: driverUserId })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/start-delivery`, managerToken, locationId)
        .send({})
        .expect(201);

      await prisma.order.update({
        where: { id: orderId },
        data: {
          estimatedArrivalAt: new Date(Date.now() - 30 * 60_000),
        },
      });

      const worker = app.get(OverdueDeliveryWorker);
      await worker.tick();
      await worker.tick();

      const tickets = await prisma.supportTicket.findMany({
        where: { orderId, ticketType: "DELIVERY_OVERDUE" },
      });
      expect(tickets).toHaveLength(1);
    });

    // PRD §7.8.5: PIN flows — phone-last-four completes delivery; bad
    // attempts stay retryable; admin regenerate resets the attempt count.
    const startDeliveryForPinTest = async (token: string) => {
      const deliveryItem = await prisma.menuItem.findFirstOrThrow({
        where: {
          locationId,
          allowedFulfillmentType: { in: ["BOTH", "DELIVERY"] },
          basePriceCents: { gt: 0 },
        },
        orderBy: { basePriceCents: "desc" },
      });
      const { minimumDeliverySubtotalCents } = await prisma.locationSettings.findUniqueOrThrow({
        where: { locationId },
        select: { minimumDeliverySubtotalCents: true },
      });
      const quantity = Math.max(
        1,
        Math.ceil(minimumDeliverySubtotalCents / deliveryItem.basePriceCents),
      );
      const orderId = await createCheckoutOrder(
        server,
        token,
        locationId,
        deliveryItem.id,
        {
          fulfillmentType: "DELIVERY",
          quantity,
          contactlessPref: "HAND_TO_ME",
          addressSnapshotJson: {
            line1: "1544 Dundas St",
            city: "London",
            province: "ON",
            postal_code: "N5W3C1",
          },
        },
      );

      await prisma.driverProfile.update({
        where: { userId: driverUserId },
        data: { availabilityStatus: "AVAILABLE", isOnDelivery: false },
      });
      await authedPost(server, `/kds/orders/${orderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/status`, managerToken, locationId)
        .send({ status: "READY" })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/assign-driver`, managerToken, locationId)
        .send({ driver_user_id: driverUserId })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/start-delivery`, managerToken, locationId)
        .send({})
        .expect(201);

      return orderId;
    };

    it("delivery PIN: correct PIN completes delivery", async () => {
      const deliveryItem = await prisma.menuItem.findFirstOrThrow({
        where: {
          locationId,
          allowedFulfillmentType: { in: ["BOTH", "DELIVERY"] },
          basePriceCents: { gt: 0 },
        },
        orderBy: { basePriceCents: "desc" },
      });
      const { minimumDeliverySubtotalCents } = await prisma.locationSettings.findUniqueOrThrow({
        where: { locationId },
        select: { minimumDeliverySubtotalCents: true },
      });
      const quantity = Math.max(
        1,
        Math.ceil(minimumDeliverySubtotalCents / deliveryItem.basePriceCents),
      );
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        deliveryItem.id,
        {
          fulfillmentType: "DELIVERY",
          quantity,
          contactlessPref: "HAND_TO_ME",
          addressSnapshotJson: {
            line1: "1544 Dundas St",
            city: "London",
            province: "ON",
            postal_code: "N5W3C1",
          },
        },
      );

      await prisma.driverProfile.update({
        where: { userId: driverUserId },
        data: { availabilityStatus: "AVAILABLE", isOnDelivery: false },
      });

      await authedPost(server, `/kds/orders/${orderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/status`, managerToken, locationId)
        .send({ status: "READY" })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/assign-driver`, managerToken, locationId)
        .send({ driver_user_id: driverUserId })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/start-delivery`, managerToken, locationId)
        .send({})
        .expect(201);

      const pinRow = await prisma.deliveryPinVerification.findUniqueOrThrow({
        where: { orderId },
      });
      expect(pinRow.pinPlaintext).toBe("0005");

      const completeRes = await authedPost(
        server,
        `/kds/orders/${orderId}/complete-delivery`,
        managerToken,
        locationId,
      )
        .send({ pin: pinRow.pinPlaintext })
        .expect(201);
      expect(completeRes.body.data.status).toBe("DELIVERED");

      const verified = await prisma.deliveryPinVerification.findUniqueOrThrow({
        where: { orderId },
      });
      expect(verified.verificationResult).toBe("VERIFIED");
    });

    it("delivery PIN: same phone is stable and different phones differ", async () => {
      const firstOrderId = await startDeliveryForPinTest(customerToken);
      const secondOrderId = await startDeliveryForPinTest(customerToken);

      const otherPhone = "+15195551234";
      const otherUser = await prisma.user.create({
        data: {
          role: "CUSTOMER",
          displayName: "PIN Test Customer",
          identities: {
            create: {
              provider: "PHONE_OTP",
              phoneE164: otherPhone,
              isPrimary: true,
              isVerified: true,
              verifiedAt: new Date(),
            },
          },
          customerProfile: { create: {} },
        },
        select: { id: true },
      });
      const otherToken = await createSessionToken(prisma, otherUser.id, "CUSTOMER");
      const otherOrderId = await startDeliveryForPinTest(otherToken);

      const [first, second, other] = await Promise.all([
        prisma.deliveryPinVerification.findUniqueOrThrow({ where: { orderId: firstOrderId } }),
        prisma.deliveryPinVerification.findUniqueOrThrow({ where: { orderId: secondOrderId } }),
        prisma.deliveryPinVerification.findUniqueOrThrow({ where: { orderId: otherOrderId } }),
      ]);
      const expectedOtherPin = otherPhone.replace(/\D/g, "").slice(-4);

      expect(first.pinPlaintext).toBe("0005");
      expect(second.pinPlaintext).toBe("0005");
      expect(other.pinPlaintext).toBe(expectedOtherPin);
      expect(other.pinPlaintext).not.toBe(first.pinPlaintext);
    });

    it("delivery PIN: wrong attempts do not lock and correct PIN still completes", async () => {
      const deliveryItem = await prisma.menuItem.findFirstOrThrow({
        where: {
          locationId,
          allowedFulfillmentType: { in: ["BOTH", "DELIVERY"] },
          basePriceCents: { gt: 0 },
        },
        orderBy: { basePriceCents: "desc" },
      });
      const { minimumDeliverySubtotalCents } = await prisma.locationSettings.findUniqueOrThrow({
        where: { locationId },
        select: { minimumDeliverySubtotalCents: true },
      });
      const quantity = Math.max(
        1,
        Math.ceil(minimumDeliverySubtotalCents / deliveryItem.basePriceCents),
      );
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        deliveryItem.id,
        {
          fulfillmentType: "DELIVERY",
          quantity,
          contactlessPref: "HAND_TO_ME",
          addressSnapshotJson: {
            line1: "1544 Dundas St",
            city: "London",
            province: "ON",
            postal_code: "N5W3C1",
          },
        },
      );

      await prisma.driverProfile.update({
        where: { userId: driverUserId },
        data: { availabilityStatus: "AVAILABLE", isOnDelivery: false },
      });

      await authedPost(server, `/kds/orders/${orderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/status`, managerToken, locationId)
        .send({ status: "READY" })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/assign-driver`, managerToken, locationId)
        .send({ driver_user_id: driverUserId })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/start-delivery`, managerToken, locationId)
        .send({})
        .expect(201);

      const pinRow = await prisma.deliveryPinVerification.findUniqueOrThrow({
        where: { orderId },
      });
      const wrong = pinRow.pinPlaintext === "0000" ? "1111" : "0000";

      for (let i = 0; i < 5; i += 1) {
        await authedPost(
          server,
          `/kds/orders/${orderId}/complete-delivery`,
          managerToken,
          locationId,
        )
          .send({ pin: wrong })
          .expect(422);
      }

      const afterWrongAttempts = await prisma.deliveryPinVerification.findUniqueOrThrow({
        where: { orderId },
      });
      expect(afterWrongAttempts.failedAttempts).toBe(5);
      expect(afterWrongAttempts.verificationResult).toBe("PENDING");
      expect(afterWrongAttempts.lockedAt).toBeNull();

      const completeRes = await authedPost(
        server,
        `/kds/orders/${orderId}/complete-delivery`,
        managerToken,
        locationId,
      )
        .send({ pin: pinRow.pinPlaintext ?? "0000" })
        .expect(201);
      expect(completeRes.body.data.status).toBe("DELIVERED");
    });

    it("delivery PIN: admin regenerate resets attempts and returns same phone PIN", async () => {
      const deliveryItem = await prisma.menuItem.findFirstOrThrow({
        where: {
          locationId,
          allowedFulfillmentType: { in: ["BOTH", "DELIVERY"] },
          basePriceCents: { gt: 0 },
        },
        orderBy: { basePriceCents: "desc" },
      });
      const { minimumDeliverySubtotalCents } = await prisma.locationSettings.findUniqueOrThrow({
        where: { locationId },
        select: { minimumDeliverySubtotalCents: true },
      });
      const quantity = Math.max(
        1,
        Math.ceil(minimumDeliverySubtotalCents / deliveryItem.basePriceCents),
      );
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        deliveryItem.id,
        {
          fulfillmentType: "DELIVERY",
          quantity,
          contactlessPref: "HAND_TO_ME",
          addressSnapshotJson: {
            line1: "1544 Dundas St",
            city: "London",
            province: "ON",
            postal_code: "N5W3C1",
          },
        },
      );

      await prisma.driverProfile.update({
        where: { userId: driverUserId },
        data: { availabilityStatus: "AVAILABLE", isOnDelivery: false },
      });

      await authedPost(server, `/kds/orders/${orderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/status`, managerToken, locationId)
        .send({ status: "READY" })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/assign-driver`, managerToken, locationId)
        .send({ driver_user_id: driverUserId })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/start-delivery`, managerToken, locationId)
        .send({})
        .expect(201);

      const original = await prisma.deliveryPinVerification.findUniqueOrThrow({
        where: { orderId },
      });

      // Burn a failed attempt so we can verify the counter resets.
      const wrong = original.pinPlaintext === "0000" ? "1111" : "0000";
      await authedPost(
        server,
        `/kds/orders/${orderId}/complete-delivery`,
        managerToken,
        locationId,
      )
        .send({ pin: wrong })
        .expect(422);

      const regenRes = await authedPost(
        server,
        `/kds/orders/${orderId}/pin/regenerate`,
        adminToken,
        locationId,
      )
        .send({})
        .expect(201);

      expect(regenRes.body.data.pin).toMatch(/^\d{4}$/);
      expect(regenRes.body.data.pin).toBe(original.pinPlaintext);

      const fresh = await prisma.deliveryPinVerification.findUniqueOrThrow({
        where: { orderId },
      });
      expect(fresh.failedAttempts).toBe(0);
      expect(fresh.verificationResult).toBe("PENDING");
    });

    it("delivery PIN: expired timestamp does not block phone PIN", async () => {
      const deliveryItem = await prisma.menuItem.findFirstOrThrow({
        where: {
          locationId,
          allowedFulfillmentType: { in: ["BOTH", "DELIVERY"] },
          basePriceCents: { gt: 0 },
        },
        orderBy: { basePriceCents: "desc" },
      });
      const { minimumDeliverySubtotalCents } = await prisma.locationSettings.findUniqueOrThrow({
        where: { locationId },
        select: { minimumDeliverySubtotalCents: true },
      });
      const quantity = Math.max(
        1,
        Math.ceil(minimumDeliverySubtotalCents / deliveryItem.basePriceCents),
      );
      const orderId = await createCheckoutOrder(
        server,
        customerToken,
        locationId,
        deliveryItem.id,
        {
          fulfillmentType: "DELIVERY",
          quantity,
          contactlessPref: "HAND_TO_ME",
          addressSnapshotJson: {
            line1: "1544 Dundas St",
            city: "London",
            province: "ON",
            postal_code: "N5W3C1",
          },
        },
      );

      await prisma.driverProfile.update({
        where: { userId: driverUserId },
        data: { availabilityStatus: "AVAILABLE", isOnDelivery: false },
      });

      await authedPost(server, `/kds/orders/${orderId}/accept`, managerToken, locationId)
        .send({})
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/status`, managerToken, locationId)
        .send({ status: "READY" })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/assign-driver`, managerToken, locationId)
        .send({ driver_user_id: driverUserId })
        .expect(201);
      await authedPost(server, `/kds/orders/${orderId}/start-delivery`, managerToken, locationId)
        .send({})
        .expect(201);

      const original = await prisma.deliveryPinVerification.findUniqueOrThrow({
        where: { orderId },
      });

      await prisma.deliveryPinVerification.update({
        where: { orderId },
        data: {
          expiresAt: new Date(Date.now() - 60_000),
          verificationResult: "PENDING",
        },
      });

      const pinRes = await authedGet(
        server,
        `/orders/${orderId}/delivery-pin`,
        customerToken,
        locationId,
      ).expect(200);

      expect(pinRes.body.data.pin).toBe(original.pinPlaintext);

      const unchanged = await prisma.deliveryPinVerification.findUniqueOrThrow({
        where: { orderId },
      });
      expect(unchanged.pinPlaintext).toBe(pinRes.body.data.pin);
      expect(unchanged.failedAttempts).toBe(0);
      expect(unchanged.verificationResult).toBe("PENDING");
      expect(unchanged.expiresAt.getTime()).toBeLessThan(Date.now());

      const completeRes = await authedPost(
        server,
        `/kds/orders/${orderId}/complete-delivery`,
        managerToken,
        locationId,
      )
        .send({ pin: original.pinPlaintext })
        .expect(201);
      expect(completeRes.body.data.status).toBe("DELIVERED");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  7. Permission checks                                               */
  /* ------------------------------------------------------------------ */

  describe("Permissions", () => {
    it("customer cannot access GET /kds/orders", async () => {
      await authedGet(server, "/kds/orders", customerToken, locationId)
        .expect(403);
    });

    it("customer cannot access POST /admin/customers/:id/credit", async () => {
      await authedPost(
        server,
        `/admin/customers/${customerUserId}/credit`,
        customerToken,
        locationId,
      )
        .send({ amount_cents: 100, reason: "test" })
        .expect(403);
    });

    it("customer cannot access GET /admin/audit-log", async () => {
      await authedGet(server, "/admin/audit-log", customerToken, locationId)
        .expect(403);
    });

    it("staff (manager) can access GET /kds/orders", async () => {
      const res = await authedGet(server, "/kds/orders", managerToken, locationId)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.errors).toBeNull();
    });

    it("admin can access GET /admin/audit-log", async () => {
      const res = await authedGet(server, "/admin/audit-log", adminToken, locationId)
        .expect(200);

      expect(res.body.errors).toBeNull();
    });

    it("unauthenticated request to protected route returns 401", async () => {
      await request(server)
        .get(`${BASE}/wallets/me`)
        .set("X-Location-Id", locationId)
        .expect(401);
    });

    it("expired token returns 401", async () => {
      const expired = signJwt(
        { sub: customerUserId, role: "CUSTOMER", sessionId: "expired-sess" },
        JWT_SECRET,
        -10,
      );

      await request(server)
        .get(`${BASE}/wallets/me`)
        .set("X-Location-Id", locationId)
        .set("Cookie", `access_token=${expired}`)
        .expect(401);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  8. Wallet                                                          */
  /* ------------------------------------------------------------------ */

  describe("Wallet", () => {
    it("GET /wallets/me returns wallet balance", async () => {
      const res = await authedGet(server, "/wallets/me", customerToken, locationId)
        .expect(200);

      const { data } = res.body;
      expect(data).toHaveProperty("customer_user_id");
      expect(data).toHaveProperty("balance_cents");
      expect(typeof data.balance_cents).toBe("number");
      expect(data).toHaveProperty("lifetime_credit_cents");
    });

    it("GET /wallets/me/ledger returns ledger entries", async () => {
      const res = await authedGet(
        server,
        "/wallets/me/ledger",
        customerToken,
        locationId,
      ).expect(200);

      const { data } = res.body;
      expect(data).toHaveProperty("entries");
      expect(Array.isArray(data.entries)).toBe(true);
    });

    it("staff cannot access GET /wallets/me", async () => {
      await authedGet(server, "/wallets/me", managerToken, locationId)
        .expect(403);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  9. Support tickets                                                 */
  /* ------------------------------------------------------------------ */

  describe("Support tickets", () => {
    let ticketId: string;

    it("POST /support/tickets creates a ticket with new fields", async () => {
      const res = await authedPost(
        server,
        "/support/tickets",
        customerToken,
        locationId,
      )
        .send({
          ticket_type: "MISSING_ITEM",
          subject: "Missing item in order",
          description: "I ordered wings but they were not in the bag.",
          priority: "HIGH",
        })
        .expect(201);

      const { data } = res.body;
      expect(data).toHaveProperty("id");
      expect(data.status).toBe("OPEN");
      expect(data.priority).toBe("HIGH");
      expect(data.created_source).toBe("CUSTOMER_APP");
      ticketId = data.id;
    });

    it("POST /support/tickets can link the customer's own order", async () => {
      const orderId = await createBareOrderForSupportTest(prisma, {
        locationId,
        customerUserId,
      });

      const res = await authedPost(
        server,
        "/support/tickets",
        customerToken,
        locationId,
      )
        .send({
          ticket_type: "OTHER",
          subject: "Question about my order",
          description: "Please check this order.",
          order_id: orderId,
        })
        .expect(201);

      expect(res.body.data.order_id).toBe(orderId);
    });

    it("POST /support/tickets rejects another customer's order", async () => {
      const otherCustomerUserId = await createSupportTestCustomer(prisma);
      const otherOrderId = await createBareOrderForSupportTest(prisma, {
        locationId,
        customerUserId: otherCustomerUserId,
      });

      await authedPost(
        server,
        "/support/tickets",
        customerToken,
        locationId,
      )
        .send({
          ticket_type: "OTHER",
          subject: "Wrong customer order",
          description: "This should not link.",
          order_id: otherOrderId,
        })
        .expect(403);
    });

    it("POST /support/tickets rejects an order from another location", async () => {
      const otherLocation = await prisma.location.create({
        data: {
          code: `SUP${randomUUID().slice(0, 8)}`,
          name: "Support Test Location",
          addressLine1: "1 Test Street",
          city: "London",
          provinceCode: "ON",
          postalCode: "N6A 1A1",
          phoneNumber: "+15195550124",
          timezoneName: "America/Toronto",
        },
        select: { id: true },
      });
      const otherLocationOrderId = await createBareOrderForSupportTest(prisma, {
        locationId: otherLocation.id,
        customerUserId,
      });

      await authedPost(
        server,
        "/support/tickets",
        customerToken,
        locationId,
      )
        .send({
          ticket_type: "OTHER",
          subject: "Wrong location order",
          description: "This should not link.",
          order_id: otherLocationOrderId,
        })
        .expect(403);
    });

    it("GET /support/tickets/:id rejects staff when the ticket belongs to another location", async () => {
      const otherLocation = await prisma.location.create({
        data: {
          code: `SUPX${randomUUID().slice(0, 8)}`,
          name: "Support Cross-Loc Test",
          addressLine1: "2 Test Street",
          city: "London",
          provinceCode: "ON",
          postalCode: "N6A 1A1",
          phoneNumber: "+15195550125",
          timezoneName: "America/Toronto",
        },
        select: { id: true },
      });
      const foreignTicket = await prisma.supportTicket.create({
        data: {
          locationId: otherLocation.id,
          customerUserId,
          ticketType: "OTHER",
          status: "OPEN",
          priority: "NORMAL",
          createdSource: "CUSTOMER_APP",
          subject: "Other location ticket",
          description: "Should not be readable from primary location scope.",
        },
        select: { id: true },
      });

      await authedGet(
        server,
        `/support/tickets/${foreignTicket.id}`,
        managerToken,
        locationId,
      ).expect(403);
    });

    it("GET /admin/support-tickets/:id/order-details returns linked order details", async () => {
      const orderId = await createBareOrderForSupportTest(prisma, {
        locationId,
        customerUserId,
      });
      const createRes = await authedPost(
        server,
        "/support/tickets",
        customerToken,
        locationId,
      )
        .send({
          ticket_type: "OTHER",
          subject: "Order details modal",
          description: "Admin should see this linked order.",
          order_id: orderId,
        })
        .expect(201);

      const res = await authedGet(
        server,
        `/admin/support-tickets/${createRes.body.data.id}/order-details`,
        adminToken,
        locationId,
      ).expect(200);

      expect(res.body.data.ticket_id).toBe(createRes.body.data.id);
      expect(res.body.data.order.id).toBe(orderId);
      expect(res.body.data.customer.user_id).toBe(customerUserId);
    });

    it("GET /admin/support-tickets/:id/order-details rejects a mismatched legacy order link", async () => {
      const otherCustomerUserId = await createSupportTestCustomer(prisma);
      const otherOrderId = await createBareOrderForSupportTest(prisma, {
        locationId,
        customerUserId: otherCustomerUserId,
      });
      const legacyTicket = await prisma.supportTicket.create({
        data: {
          locationId,
          customerUserId,
          orderId: otherOrderId,
          ticketType: "OTHER",
          status: "OPEN",
          priority: "NORMAL",
          createdSource: "CUSTOMER_APP",
          subject: "Legacy mismatched link",
          description: "This simulates a bad historical ticket-order link.",
        },
        select: { id: true },
      });

      await authedGet(
        server,
        `/admin/support-tickets/${legacyTicket.id}/order-details`,
        adminToken,
        locationId,
      ).expect(403);
    });

    it("GET /support/tickets lists tickets for customer", async () => {
      const res = await authedGet(
        server,
        "/support/tickets",
        customerToken,
        locationId,
      ).expect(200);

      const { data } = res.body;
      expect(data).toHaveProperty("tickets");
      expect(Array.isArray(data.tickets)).toBe(true);
      expect(data.tickets.length).toBeGreaterThan(0);
      expect(data.tickets[0]).toHaveProperty("priority");
      expect(data.tickets[0]).toHaveProperty("created_source");
    });

    it("GET /support/tickets/:id returns ticket detail with events", async () => {
      const res = await authedGet(
        server,
        `/support/tickets/${ticketId}`,
        customerToken,
        locationId,
      ).expect(200);

      expect(res.body.data).toHaveProperty("id", ticketId);
      expect(res.body.data).toHaveProperty("events");
      expect(Array.isArray(res.body.data.events)).toBe(true);
      const createdEvent = res.body.data.events.find(
        (e: Record<string, unknown>) => e.event_type === "CREATED",
      );
      expect(createdEvent).toBeDefined();
    });

    it("POST /support/tickets/:id/messages adds a public message", async () => {
      const res = await authedPost(
        server,
        `/support/tickets/${ticketId}/messages`,
        customerToken,
        locationId,
      )
        .send({ message_body: "Any update on this?" })
        .expect(201);

      expect(res.body.data).toHaveProperty("id");
      expect(res.body.data.is_internal_note).toBe(false);
      expect(res.body.errors).toBeNull();
    });

    it("customer cannot see internal notes", async () => {
      if (adminToken) {
        await authedPost(
          server,
          `/support/tickets/${ticketId}/messages`,
          adminToken,
          locationId,
        ).send({ message_body: "Internal: check refund eligibility", is_internal_note: true });
      }

      const res = await authedGet(
        server,
        `/support/tickets/${ticketId}`,
        customerToken,
        locationId,
      ).expect(200);

      const internalNotes = (res.body.data.messages ?? []).filter(
        (m: Record<string, unknown>) => m.is_internal_note === true,
      );
      expect(internalNotes.length).toBe(0);
    });

    it("POST /support/tickets without auth returns 401", async () => {
      await request(server)
        .post(`${BASE}/support/tickets`)
        .set("X-Location-Id", locationId)
        .send({
          ticket_type: "OTHER",
          subject: "test",
          description: "test",
        })
        .expect(401);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  10. Timeclock                                                       */
  /* ------------------------------------------------------------------ */

  describe("Timeclock", () => {
    it("POST /timeclock/clock-in creates a CLOCKED_IN shift", async () => {
      const res = await authedPost(
        server,
        "/timeclock/clock-in",
        managerToken,
        locationId,
      ).expect(201);

      const { data } = res.body;
      expect(data.status).toBe("CLOCKED_IN");
      expect(data.total_break_minutes).toBe(0);
      expect(data.net_worked_minutes).toBeNull();
      expect(data.clock_in_at).toBeDefined();
      expect(data.clock_out_at).toBeNull();
    });

    it("second clock-in is rejected while shift is active", async () => {
      await authedPost(
        server,
        "/timeclock/clock-in",
        managerToken,
        locationId,
      ).expect(409);
    });

    it("GET /timeclock/current returns the active shift", async () => {
      const res = await authedGet(
        server,
        "/timeclock/current",
        managerToken,
        locationId,
      ).expect(200);

      expect(res.body.data.status).toBe("CLOCKED_IN");
    });

    it("POST /timeclock/break/start sets shift to ON_BREAK", async () => {
      const res = await authedPost(
        server,
        "/timeclock/break/start",
        managerToken,
        locationId,
      ).expect(201);

      expect(res.body.data.status).toBe("ON_BREAK");
      const openBreak = res.body.data.breaks.find(
        (b: Record<string, unknown>) => b.ended_at === null,
      );
      expect(openBreak).toBeDefined();
      expect(openBreak.break_type).toBe("UNPAID");
    });

    it("second break start is rejected while already on break", async () => {
      await authedPost(
        server,
        "/timeclock/break/start",
        managerToken,
        locationId,
      ).expect(409);
    });

    it("POST /timeclock/break/end restores CLOCKED_IN and updates total_break_minutes", async () => {
      const res = await authedPost(
        server,
        "/timeclock/break/end",
        managerToken,
        locationId,
      ).expect(201);

      expect(res.body.data.status).toBe("CLOCKED_IN");
      expect(typeof res.body.data.total_break_minutes).toBe("number");
      const allClosed = res.body.data.breaks.every(
        (b: Record<string, unknown>) => b.ended_at !== null,
      );
      expect(allClosed).toBe(true);
    });

    it("POST /timeclock/clock-out sets CLOCKED_OUT and computes net_worked_minutes", async () => {
      const res = await authedPost(
        server,
        "/timeclock/clock-out",
        managerToken,
        locationId,
      ).expect(201);

      const { data } = res.body;
      expect(data.status).toBe("CLOCKED_OUT");
      expect(typeof data.total_break_minutes).toBe("number");
      expect(typeof data.net_worked_minutes).toBe("number");
      expect(data.clock_out_at).toBeDefined();
    });

    it("clock-out from ON_BREAK auto-closes the break", async () => {
      await authedPost(
        server,
        "/timeclock/clock-in",
        managerToken,
        locationId,
      ).expect(201);

      await authedPost(
        server,
        "/timeclock/break/start",
        managerToken,
        locationId,
      ).expect(201);

      const res = await authedPost(
        server,
        "/timeclock/clock-out",
        managerToken,
        locationId,
      ).expect(201);

      expect(res.body.data.status).toBe("CLOCKED_OUT");
      const allClosed = res.body.data.breaks.every(
        (b: Record<string, unknown>) => b.ended_at !== null,
      );
      expect(allClosed).toBe(true);
    });

    it("GET /timeclock/history returns completed shifts with totals", async () => {
      const res = await authedGet(
        server,
        "/timeclock/history",
        managerToken,
        locationId,
      ).expect(200);

      expect(Array.isArray(res.body.data.shifts)).toBe(true);
      expect(res.body.data.shifts.length).toBeGreaterThanOrEqual(2);
      for (const s of res.body.data.shifts) {
        expect(s).toHaveProperty("total_break_minutes");
        expect(s).toHaveProperty("net_worked_minutes");
        expect(s).toHaveProperty("breaks");
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  11. Chat — sender_surface, visibility, side-based unread           */
  /* ------------------------------------------------------------------ */

  describe("Chat", () => {
    let chatOrderId: string;

    beforeAll(async () => {
      const res = await authedPost(server, "/checkout", customerToken, locationId)
        .set("Idempotency-Key", randomUUID())
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);
      chatOrderId = res.body.data.id;
    });

    it("customer sends message -> stored as sender_surface = CUSTOMER", async () => {
      const res = await authedPost(
        server,
        `/orders/${chatOrderId}/chat`,
        customerToken,
        locationId,
      )
        .send({ message_body: "Hello from customer" })
        .expect(201);

      expect(res.body.data.sender_surface).toBe("CUSTOMER");
      expect(res.body.data.message_body).toBe("Hello from customer");
      expect(res.body.data.visibility).toBe("BOTH");
    });

    it("kitchen user sends message -> stored as sender_surface = KDS", async () => {
      const res = await authedPost(
        server,
        `/orders/${chatOrderId}/chat`,
        kitchenToken,
        locationId,
      )
        .send({ message_body: "Preparing your order" })
        .expect(201);

      expect(res.body.data.sender_surface).toBe("KDS");
    });

    it("manager sends message -> stored as sender_surface = MANAGER", async () => {
      const res = await authedPost(
        server,
        `/orders/${chatOrderId}/chat`,
        managerToken,
        locationId,
      )
        .send({ message_body: "Manager here" })
        .expect(201);

      expect(res.body.data.sender_surface).toBe("MANAGER");
    });

    it("admin sends message -> stored as sender_surface = ADMIN", async () => {
      const res = await authedPost(
        server,
        `/orders/${chatOrderId}/chat`,
        adminToken,
        locationId,
      )
        .send({ message_body: "Admin note" })
        .expect(201);

      expect(res.body.data.sender_surface).toBe("ADMIN");
    });

    it("cashier send attempt -> rejected", async () => {
      await authedPost(
        server,
        `/orders/${chatOrderId}/chat`,
        cashierToken,
        locationId,
      )
        .send({ message_body: "Cashier trying" })
        .expect(403);
    });

    it("driver send attempt -> rejected", async () => {
      await authedPost(
        server,
        `/orders/${chatOrderId}/chat`,
        driverToken,
        locationId,
      )
        .send({ message_body: "Driver trying" })
        .expect(403);
    });

    it("customer cannot send STAFF_ONLY visibility", async () => {
      await authedPost(
        server,
        `/orders/${chatOrderId}/chat`,
        customerToken,
        locationId,
      )
        .send({ message_body: "Secret", visibility: "STAFF_ONLY" })
        .expect(403);
    });

    it("staff can send STAFF_ONLY visibility", async () => {
      const res = await authedPost(
        server,
        `/orders/${chatOrderId}/chat`,
        managerToken,
        locationId,
      )
        .send({ message_body: "Internal note", visibility: "STAFF_ONLY" })
        .expect(201);

      expect(res.body.data.visibility).toBe("STAFF_ONLY");
    });

    it("customer GET does not see STAFF_ONLY messages", async () => {
      const res = await authedGet(
        server,
        `/orders/${chatOrderId}/chat`,
        customerToken,
        locationId,
      ).expect(200);

      const messages = res.body.data.messages;
      const staffOnly = messages.filter(
        (m: Record<string, unknown>) => m.visibility === "STAFF_ONLY",
      );
      expect(staffOnly.length).toBe(0);
    });

    it("staff GET sees all messages including STAFF_ONLY", async () => {
      const res = await authedGet(
        server,
        `/orders/${chatOrderId}/chat`,
        managerToken,
        locationId,
      ).expect(200);

      const messages = res.body.data.messages;
      const staffOnly = messages.filter(
        (m: Record<string, unknown>) => m.visibility === "STAFF_ONLY",
      );
      expect(staffOnly.length).toBeGreaterThan(0);
    });

    it("customer read updates CUSTOMER side cursor", async () => {
      const res = await authedPost(
        server,
        `/orders/${chatOrderId}/chat/read`,
        customerToken,
        locationId,
      ).expect(201);

      expect(res.body.data.side).toBe("CUSTOMER");
      expect(res.body.data.last_read_message_id).toBeDefined();
    });

    it("staff read updates STAFF side cursor (shared across staff)", async () => {
      const res = await authedPost(
        server,
        `/orders/${chatOrderId}/chat/read`,
        managerToken,
        locationId,
      ).expect(201);

      expect(res.body.data.side).toBe("STAFF");
      expect(res.body.data.last_read_message_id).toBeDefined();
    });

    it("GET returns is_closed = false while order is active", async () => {
      const res = await authedGet(
        server,
        `/orders/${chatOrderId}/chat`,
        customerToken,
        locationId,
      ).expect(200);

      expect(res.body.data.is_closed).toBe(false);
    });

    describe("side-based unread — staff reads are shared (PRD §15)", () => {
      let sharedOrderId: string;

      beforeAll(async () => {
        const item = await prisma.menuItem.findFirst({ where: { locationId } });
        const checkout = await authedPost(server, "/checkout", customerToken, locationId)
          .set("Idempotency-Key", randomUUID())
          .send({
            location_id: locationId,
            fulfillment_type: "PICKUP",
            items: [{ menu_item_id: item!.id, quantity: 1 }],
          })
          .expect(201);
        sharedOrderId = checkout.body.data.id;

        await authedPost(
          server,
          `/orders/${sharedOrderId}/chat`,
          customerToken,
          locationId,
        )
          .send({ message_body: "hello staff" })
          .expect(201);
      });

      it("manager read creates a single STAFF side row", async () => {
        await authedPost(
          server,
          `/orders/${sharedOrderId}/chat/read`,
          managerToken,
          locationId,
        ).expect(201);

        const rows = await prisma.chatSideReadState.findMany({
          where: { orderId: sharedOrderId, readerSide: "STAFF" },
        });
        expect(rows.length).toBe(1);
      });

      it("kitchen read advances the same STAFF row (no per-user row)", async () => {
        await authedPost(
          server,
          `/orders/${sharedOrderId}/chat`,
          customerToken,
          locationId,
        )
          .send({ message_body: "followup" })
          .expect(201);

        await authedPost(
          server,
          `/orders/${sharedOrderId}/chat/read`,
          kitchenToken,
          locationId,
        ).expect(201);

        const rows = await prisma.chatSideReadState.findMany({
          where: { orderId: sharedOrderId, readerSide: "STAFF" },
        });
        expect(rows.length).toBe(1);

        const latest = await prisma.orderMessage.findFirst({
          where: { orderId: sharedOrderId },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        expect(rows[0].lastReadMessageId).toBe(latest!.id);
      });

      it("customer read writes an independent CUSTOMER side row", async () => {
        await authedPost(
          server,
          `/orders/${sharedOrderId}/chat/read`,
          customerToken,
          locationId,
        ).expect(201);

        const sides = await prisma.chatSideReadState.findMany({
          where: { orderId: sharedOrderId },
        });
        expect(sides.length).toBe(2);
        expect(sides.map((r) => r.readerSide).sort()).toEqual(["CUSTOMER", "STAFF"]);
      });
    });

    describe("rate limiting — 5 messages/min per user (PRD §15.2)", () => {
      let rateOrderId: string;

      beforeAll(async () => {
        const item = await prisma.menuItem.findFirst({ where: { locationId } });
        const checkout = await authedPost(server, "/checkout", customerToken, locationId)
          .set("Idempotency-Key", randomUUID())
          .send({
            location_id: locationId,
            fulfillment_type: "PICKUP",
            items: [{ menu_item_id: item!.id, quantity: 1 }],
          })
          .expect(201);
        rateOrderId = checkout.body.data.id;
      });

      it("first 5 messages pass, 6th returns 429", async () => {
        for (let i = 0; i < 5; i++) {
          await authedPost(
            server,
            `/orders/${rateOrderId}/chat`,
            customerToken,
            locationId,
          )
            .send({ message_body: `msg ${i}` })
            .expect(201);
        }

        const res = await authedPost(
          server,
          `/orders/${rateOrderId}/chat`,
          customerToken,
          locationId,
        )
          .send({ message_body: "over-limit" })
          .expect(429);

        expect(res.body.errors?.[0]?.code).toBe("RATE_LIMITED");
      });

      it("other users on the same order are unaffected", async () => {
        await authedPost(
          server,
          `/orders/${rateOrderId}/chat`,
          managerToken,
          locationId,
        )
          .send({ message_body: "staff still ok" })
          .expect(201);
      });
    });

    describe("lifecycle — terminal order closes chat", () => {
      let lifecycleOrderId: string;

      beforeAll(async () => {
        const item = await prisma.menuItem.findFirst({ where: { locationId } });
        const checkout = await authedPost(server, "/checkout", customerToken, locationId)
          .set("Idempotency-Key", randomUUID())
          .send({
            location_id: locationId,
            fulfillment_type: "PICKUP",
            items: [{ menu_item_id: item!.id, quantity: 1 }],
          })
          .expect(201);
        lifecycleOrderId = checkout.body.data.id;

        await authedPost(
          server,
          `/orders/${lifecycleOrderId}/chat`,
          customerToken,
          locationId,
        )
          .send({ message_body: "Quick question about my order" })
          .expect(201);
      });

      it("chat works while order is active", async () => {
        const res = await authedPost(
          server,
          `/orders/${lifecycleOrderId}/chat`,
          managerToken,
          locationId,
        )
          .send({ message_body: "Sure, how can I help?" })
          .expect(201);

        expect(res.body.data.sender_surface).toBe("MANAGER");
      });

      it("transitioning order to terminal status closes the conversation", async () => {
        await authedPost(
          server,
          `/kds/orders/${lifecycleOrderId}/status`,
          managerToken,
          locationId,
        )
          .send({ status: "CANCELLED", reason: "Test lifecycle" })
          .expect(201);

        const res = await authedGet(
          server,
          `/orders/${lifecycleOrderId}/chat`,
          customerToken,
          locationId,
        ).expect(200);

        expect(res.body.data.is_closed).toBe(true);
        expect(res.body.data.messages.length).toBeGreaterThan(0);
      });

      it("new message on terminal order is rejected with 409", async () => {
        await authedPost(
          server,
          `/orders/${lifecycleOrderId}/chat`,
          customerToken,
          locationId,
        )
          .send({ message_body: "Can I still chat?" })
          .expect(409);
      });

      it("GET still returns full chat history after close", async () => {
        const res = await authedGet(
          server,
          `/orders/${lifecycleOrderId}/chat`,
          customerToken,
          locationId,
        ).expect(200);

        expect(res.body.data.messages.length).toBeGreaterThanOrEqual(2);
        expect(res.body.data.is_closed).toBe(true);
      });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  11b. Reviews — PRD §14 eligibility + admin reply + publish         */
  /* ------------------------------------------------------------------ */

  describe("Reviews (PRD §14)", () => {
    let reviewOrderId: string;
    let reviewOrderItemId: string;

    async function newOrderWithItem() {
      const res = await authedPost(server, "/checkout", customerToken, locationId)
        .set("Idempotency-Key", randomUUID())
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);
      const orderId = res.body.data.id as string;
      const oi = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
      return { orderId, orderItemId: oi.id };
    }

    beforeAll(async () => {
      const { orderId, orderItemId } = await newOrderWithItem();
      reviewOrderId = orderId;
      reviewOrderItemId = orderItemId;
      await prisma.order.update({
        where: { id: reviewOrderId },
        data: { status: "PICKED_UP" },
      });
    });

    it("customer can review a PICKED_UP order item (1–5 stars + text)", async () => {
      const res = await authedPost(
        server,
        `/orders/${reviewOrderId}/order-items/${reviewOrderItemId}/reviews`,
        customerToken,
        locationId,
      )
        .send({ rating: 5, review_body: "Perfect crisp" })
        .expect(201);

      expect(res.body.data.rating).toBe(5);
      expect(res.body.data.review_body).toBe("Perfect crisp");
      expect(res.body.data.is_approved_public).toBe(false);
      expect(res.body.data.admin_reply).toBeNull();
    });

    it("duplicate review on same order item returns 409", async () => {
      await authedPost(
        server,
        `/orders/${reviewOrderId}/order-items/${reviewOrderItemId}/reviews`,
        customerToken,
        locationId,
      )
        .send({ rating: 4 })
        .expect(409);
    });

    it("rating outside 1..5 is rejected", async () => {
      const { orderId, orderItemId } = await newOrderWithItem();
      await prisma.order.update({
        where: { id: orderId },
        data: { status: "DELIVERED" },
      });
      await authedPost(
        server,
        `/orders/${orderId}/order-items/${orderItemId}/reviews`,
        customerToken,
        locationId,
      )
        .send({ rating: 6 })
        .expect(422);
    });

    it.each([
      "PLACED",
      "ACCEPTED",
      "PREPARING",
      "READY",
      "OUT_FOR_DELIVERY",
      "NO_SHOW_PICKUP",
      "NO_SHOW_DELIVERY",
      "CANCELLED",
    ])("rejects review when order status is %s", async (status) => {
      const { orderId, orderItemId } = await newOrderWithItem();
      await prisma.order.update({
        where: { id: orderId },
        data: { status: status as any },
      });
      await authedPost(
        server,
        `/orders/${orderId}/order-items/${orderItemId}/reviews`,
        customerToken,
        locationId,
      )
        .send({ rating: 3 })
        .expect(400);
    });

    it("allows review on a DELIVERED order", async () => {
      const { orderId, orderItemId } = await newOrderWithItem();
      await prisma.order.update({
        where: { id: orderId },
        data: { status: "DELIVERED" },
      });
      const res = await authedPost(
        server,
        `/orders/${orderId}/order-items/${orderItemId}/reviews`,
        customerToken,
        locationId,
      )
        .send({ rating: 4, review_body: "Good" })
        .expect(201);
      expect(res.body.data.rating).toBe(4);
    });

    it("customer GET lists own reviews for the order", async () => {
      const res = await authedGet(
        server,
        `/orders/${reviewOrderId}/reviews`,
        customerToken,
        locationId,
      ).expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].rating).toBe(5);
    });

    it("admin can list all reviews on the order", async () => {
      await authedGet(
        server,
        `/orders/${reviewOrderId}/reviews`,
        adminToken,
        locationId,
      ).expect(200);
    });

    it("admin can reply to a review", async () => {
      const review = await prisma.itemReview.findFirstOrThrow({
        where: { orderId: reviewOrderId },
      });

      const res = await authedPost(
        server,
        `/admin/reviews/${review.id}/reply`,
        adminToken,
        locationId,
      )
        .send({ reply: "Thanks for the kind words!" })
        .expect(201);

      expect(res.body.data.admin_reply).toBe("Thanks for the kind words!");
      expect(res.body.data.admin_replied_at).toBeTruthy();
      expect(res.body.data.admin_replied_by_user_id).toBeTruthy();
    });

    it("customer cannot hit admin reply endpoint", async () => {
      const review = await prisma.itemReview.findFirstOrThrow({
        where: { orderId: reviewOrderId },
      });
      await authedPost(
        server,
        `/admin/reviews/${review.id}/reply`,
        customerToken,
        locationId,
      )
        .send({ reply: "sneaky" })
        .expect(403);
    });

    it("admin can publish a review (is_approved_public = true)", async () => {
      const review = await prisma.itemReview.findFirstOrThrow({
        where: { orderId: reviewOrderId },
      });
      const res = await authedPost(
        server,
        `/admin/reviews/${review.id}/publish`,
        adminToken,
        locationId,
      )
        .send({ publish: true })
        .expect(201);
      expect(res.body.data.is_approved_public).toBe(true);
    });

    it("admin list returns reviews, filterable by has_reply", async () => {
      const res = await authedGet(
        server,
        `/admin/reviews?has_reply=true`,
        adminToken,
        locationId,
      ).expect(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      for (const r of res.body.data.items) {
        expect(r.admin_reply).not.toBeNull();
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  §13 Post-order add-items change requests                            */
  /* ------------------------------------------------------------------ */

  describe("Order changes — add items (PRD §13)", () => {
    async function newOnlineOrder() {
      const res = await authedPost(server, "/checkout", customerToken, locationId)
        .set("Idempotency-Key", randomUUID())
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [{ menu_item_id: firstMenuItemId, quantity: 1 }],
        })
        .expect(201);
      return res.body.data.id as string;
    }

    it("customer can submit an add-items request on a fresh order", async () => {
      const orderId = await newOnlineOrder();

      const res = await authedPost(
        server,
        `/orders/${orderId}/changes`,
        customerToken,
        locationId,
      )
        .send({ items: [{ menu_item_id: firstMenuItemId, quantity: 1 }] })
        .expect(201);

      expect(res.body.data.status).toBe("PENDING");
      expect(res.body.data.type).toBe("ADD_ITEMS");
      expect(Array.isArray(res.body.data.requested_items_json)).toBe(true);
    });

    it("rejects add-items once the 3-minute window has elapsed", async () => {
      const orderId = await newOnlineOrder();
      await prisma.order.update({
        where: { id: orderId },
        data: { placedAt: new Date(Date.now() - 4 * 60 * 1000) },
      });
      const res = await authedPost(
        server,
        `/orders/${orderId}/changes`,
        customerToken,
        locationId,
      )
        .send({ items: [{ menu_item_id: firstMenuItemId, quantity: 1 }] })
        .expect(422);
      expect(res.body.errors[0].code).toBe("ADD_ITEMS_WINDOW_EXPIRED");
    });

    it("online-card order blocks add-items once status leaves PLACED", async () => {
      const orderId = await newOnlineOrder();
      await prisma.order.update({
        where: { id: orderId },
        data: { status: "ACCEPTED", paymentMethod: "CARD" },
      });
      const res = await authedPost(
        server,
        `/orders/${orderId}/changes`,
        customerToken,
        locationId,
      )
        .send({ items: [{ menu_item_id: firstMenuItemId, quantity: 1 }] })
        .expect(422);
      expect(res.body.errors[0].code).toBe("ADD_ITEMS_NOT_ALLOWED_IN_STATUS");
    });

    it("POS cash order allows add-items through PREPARING", async () => {
      const orderId = await newOnlineOrder();
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: "PREPARING",
          orderSource: "POS",
          paymentMethod: "CASH",
          paymentStatusSummary: "UNPAID",
        },
      });
      await authedPost(
        server,
        `/orders/${orderId}/changes`,
        customerToken,
        locationId,
      )
        .send({ items: [{ menu_item_id: firstMenuItemId, quantity: 1 }] })
        .expect(201);
    });

    it("manager approval appends a line item and recomputes totals", async () => {
      const orderId = await newOnlineOrder();

      const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const beforeItemCount = await prisma.orderItem.count({ where: { orderId } });

      const created = await authedPost(
        server,
        `/orders/${orderId}/changes`,
        customerToken,
        locationId,
      )
        .send({ items: [{ menu_item_id: firstMenuItemId, quantity: 2 }] })
        .expect(201);
      const changeRequestId = created.body.data.id as string;

      await authedPost(
        server,
        `/admin/order-changes/${changeRequestId}/approve`,
        managerToken,
        locationId,
      ).expect(201);

      const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const afterItemCount = await prisma.orderItem.count({ where: { orderId } });
      expect(afterItemCount).toBe(beforeItemCount + 1);
      expect(after.itemSubtotalCents).toBeGreaterThan(before.itemSubtotalCents);
      expect(after.finalPayableCents).toBeGreaterThanOrEqual(before.finalPayableCents);
    });

    it("rejection requires a reason of at least 5 characters", async () => {
      const orderId = await newOnlineOrder();
      const created = await authedPost(
        server,
        `/orders/${orderId}/changes`,
        customerToken,
        locationId,
      )
        .send({ items: [{ menu_item_id: firstMenuItemId, quantity: 1 }] })
        .expect(201);
      const changeRequestId = created.body.data.id as string;

      await authedPost(
        server,
        `/admin/order-changes/${changeRequestId}/reject`,
        managerToken,
        locationId,
      )
        .send({ reason: "no" })
        .expect(400);

      const ok = await authedPost(
        server,
        `/admin/order-changes/${changeRequestId}/reject`,
        managerToken,
        locationId,
      )
        .send({ reason: "sold out" })
        .expect(201);
      expect(ok.body.data.status).toBe("REJECTED");
      expect(ok.body.data.rejection_reason).toBe("sold out");
    });

    it("auto-approve applies inline when the location flag is set", async () => {
      await prisma.locationSettings.update({
        where: { locationId },
        data: { addItemsAutoApproveEnabled: true },
      });
      try {
        const orderId = await newOnlineOrder();
        const res = await authedPost(
          server,
          `/orders/${orderId}/changes`,
          customerToken,
          locationId,
        )
          .send({ items: [{ menu_item_id: firstMenuItemId, quantity: 1 }] })
          .expect(201);
        expect(res.body.data.status).toBe("APPROVED");
      } finally {
        await prisma.locationSettings.update({
          where: { locationId },
          data: { addItemsAutoApproveEnabled: false },
        });
      }
    });

    it("store-credit order debits the wallet on approval", async () => {
      const orderId = await newOnlineOrder();
      await prisma.order.update({
        where: { id: orderId },
        data: { paymentMethod: "STORE_CREDIT" },
      });
      await prisma.customerWallet.upsert({
        where: { customerUserId },
        update: { balanceCents: 100_000 },
        create: {
          customerUserId,
          balanceCents: 100_000,
          lifetimeCreditCents: 100_000,
        },
      });
      const walletBefore = await prisma.customerWallet.findUniqueOrThrow({
        where: { customerUserId },
      });

      const created = await authedPost(
        server,
        `/orders/${orderId}/changes`,
        customerToken,
        locationId,
      )
        .send({ items: [{ menu_item_id: firstMenuItemId, quantity: 1 }] })
        .expect(201);

      await authedPost(
        server,
        `/admin/order-changes/${created.body.data.id}/approve`,
        managerToken,
        locationId,
      ).expect(201);

      const walletAfter = await prisma.customerWallet.findUniqueOrThrow({
        where: { customerUserId },
      });
      expect(walletAfter.balanceCents).toBeLessThan(walletBefore.balanceCents);
    });

    it("customer cannot approve their own request", async () => {
      const orderId = await newOnlineOrder();
      const created = await authedPost(
        server,
        `/orders/${orderId}/changes`,
        customerToken,
        locationId,
      )
        .send({ items: [{ menu_item_id: firstMenuItemId, quantity: 1 }] })
        .expect(201);

      await authedPost(
        server,
        `/admin/order-changes/${created.body.data.id}/approve`,
        customerToken,
        locationId,
      ).expect(403);
    });

    it("approve rejects builder-type items (must use full builder flow)", async () => {
      const wingItem = await prisma.menuItem.findFirst({
        where: { locationId, builderType: { not: null } },
        select: { id: true },
      });
      if (!wingItem) {
        // No builder items seeded — nothing to assert.
        return;
      }
      const orderId = await newOnlineOrder();
      const created = await authedPost(
        server,
        `/orders/${orderId}/changes`,
        customerToken,
        locationId,
      )
        .send({ items: [{ menu_item_id: wingItem.id, quantity: 1 }] })
        .expect(201);

      const res = await authedPost(
        server,
        `/admin/order-changes/${created.body.data.id}/approve`,
        managerToken,
        locationId,
      ).expect(422);
      expect(res.body.errors[0].code).toBe("ADD_ITEMS_BUILDER_NOT_SUPPORTED");
    });

    it("approve rejects items whose fulfillment type doesn't match the order", async () => {
      // Order is PICKUP; mark the menu item DELIVERY-only so approval must fail.
      const original = await prisma.menuItem.findUniqueOrThrow({
        where: { id: firstMenuItemId },
        select: { allowedFulfillmentType: true },
      });
      await prisma.menuItem.update({
        where: { id: firstMenuItemId },
        data: { allowedFulfillmentType: "DELIVERY" },
      });
      try {
        const orderId = await newOnlineOrder();
        const created = await authedPost(
          server,
          `/orders/${orderId}/changes`,
          customerToken,
          locationId,
        )
          .send({ items: [{ menu_item_id: firstMenuItemId, quantity: 1 }] })
          .expect(201);

        const res = await authedPost(
          server,
          `/admin/order-changes/${created.body.data.id}/approve`,
          managerToken,
          locationId,
        ).expect(422);
        expect(res.body.errors[0].code).toBe("ADD_ITEMS_FULFILLMENT_MISMATCH");
      } finally {
        await prisma.menuItem.update({
          where: { id: firstMenuItemId },
          data: { allowedFulfillmentType: original.allowedFulfillmentType },
        });
      }
    });

    it("approve rejects items that fall outside their menu schedule window", async () => {
      const orderId = await newOnlineOrder();
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { placedAt: true, locationId: true },
      });
      const loc = await prisma.location.findUniqueOrThrow({
        where: { id: order.locationId },
        select: { timezoneName: true },
      });
      // Compute day-of-week in the location's timezone, then pick a DIFFERENT
      // day so the schedule can't match the order's placedAt.
      const localStr = order.placedAt.toLocaleString("en-US", {
        timeZone: loc.timezoneName ?? "America/Toronto",
      });
      const todayDow = new Date(localStr).getDay();
      const otherDow = (todayDow + 1) % 7;

      const schedule = await prisma.menuItemSchedule.create({
        data: {
          menuItemId: firstMenuItemId,
          dayOfWeek: otherDow,
          timeFrom: new Date("1970-01-01T11:00:00.000Z"),
          timeTo: new Date("1970-01-01T15:00:00.000Z"),
        },
      });
      try {
        const created = await authedPost(
          server,
          `/orders/${orderId}/changes`,
          customerToken,
          locationId,
        )
          .send({ items: [{ menu_item_id: firstMenuItemId, quantity: 1 }] })
          .expect(201);

        const res = await authedPost(
          server,
          `/admin/order-changes/${created.body.data.id}/approve`,
          managerToken,
          locationId,
        ).expect(422);
        // Either SCHEDULE_VIOLATION or LUNCH_SPECIAL_SCHEDULE_CONFLICT depending
        // on whether firstMenuItemId is classified as a lunch special.
        const code = res.body.errors[0].code;
        expect([
          "SCHEDULE_VIOLATION",
          "LUNCH_SPECIAL_SCHEDULE_CONFLICT",
        ]).toContain(code);
      } finally {
        await prisma.menuItemSchedule.delete({ where: { id: schedule.id } });
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  12. Envelope contract consistency                                   */
  /* ------------------------------------------------------------------ */

  describe("Envelope contract", () => {
    it("success responses have { data, meta.request_id, errors: null }", async () => {
      const res = await request(server).get(`${BASE}/health`).expect(200);

      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("meta");
      expect(res.body).toHaveProperty("errors", null);
      expect(typeof res.body.meta.request_id).toBe("string");
      expect(res.body.meta.request_id.length).toBeGreaterThan(0);
    });

    it("error responses have { data: null, meta.request_id, errors[] }", async () => {
      const res = await request(server)
        .get(`${BASE}/orders`)
        .set("X-Location-Id", locationId)
        .expect(401);

      expect(res.body.data).toBeNull();
      expect(typeof res.body.meta.request_id).toBe("string");
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors.length).toBeGreaterThan(0);
      expect(res.body.errors[0]).toHaveProperty("code");
      expect(res.body.errors[0]).toHaveProperty("message");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  13. Admin Sauces & Checkout Safety                                  */
  /* ------------------------------------------------------------------ */

  describe("Admin Sauces & Checkout Safety", () => {
    let sauceId: string;
    let inactiveSauceId: string;
    let categoryId: string;
    let archivedSaladId: string;
    let pickupOnlySaladId: string;
    let wingItemId: string;
    let foreignModifierOptionId: string;

    const adminCookie = () => `access_token=${adminToken}; csrf_token=${CSRF}`;

    beforeAll(async () => {
      const suffix = randomUUID().slice(0, 8);
      const wingItem = await prisma.menuItem.findFirstOrThrow({
        where: {
          locationId,
          builderType: "WINGS",
          isAvailable: true,
          archivedAt: null,
        },
      });
      wingItemId = wingItem.id;

      // 1. Create a sauce
      const createSauceRes = await request(server)
        .post(`${BASE}/admin/menu/wing-flavours`)
        .set("Cookie", adminCookie())
        .set("X-CSRF-Token", CSRF)
        .set("X-Location-Id", locationId)
        .send({
          name: `Test Archivable Sauce ${suffix}`,
          category: "HOT",
          sort_order: 1,
          is_active: true,
        })
        .expect(201);
      sauceId = createSauceRes.body.data.id;

      const inactiveSauceRes = await request(server)
        .post(`${BASE}/admin/menu/wing-flavours`)
        .set("Cookie", adminCookie())
        .set("X-CSRF-Token", CSRF)
        .set("X-Location-Id", locationId)
        .send({
          name: `Test Inactive Sauce ${suffix}`,
          category: "MILD",
          sort_order: 2,
          is_active: false,
        })
        .expect(201);
      inactiveSauceId = inactiveSauceRes.body.data.id;

      // 2. Setup category and salad for child validation tests
      const catRes = await request(server)
        .post(`${BASE}/admin/menu/categories`)
        .set("Cookie", adminCookie())
        .set("X-CSRF-Token", CSRF)
        .set("X-Location-Id", locationId)
        .send({
          name: `Safety Category ${suffix}`,
          sort_order: 10,
          is_active: true,
        })
        .expect(201);
      categoryId = catRes.body.data.id;

      const saladRes = await request(server)
        .post(`${BASE}/admin/menu/items`)
        .set("Cookie", adminCookie())
        .set("X-CSRF-Token", CSRF)
        .set("X-Location-Id", locationId)
        .send({
          name: `Test Salad ${suffix}`,
          category_id: categoryId,
          base_price_cents: 800,
          stock_status: "NORMAL",
          is_hidden: false,
          allowed_fulfillment_type: "BOTH",
        })
        .expect(201);
      archivedSaladId = saladRes.body.data.id;

      const pickupOnlySaladRes = await request(server)
        .post(`${BASE}/admin/menu/items`)
        .set("Cookie", adminCookie())
        .set("X-CSRF-Token", CSRF)
        .set("X-Location-Id", locationId)
        .send({
          name: `Pickup Salad ${suffix}`,
          category_id: categoryId,
          base_price_cents: 800,
          stock_status: "NORMAL",
          is_hidden: false,
          allowed_fulfillment_type: "PICKUP",
        })
        .expect(201);
      pickupOnlySaladId = pickupOnlySaladRes.body.data.id;

      const foreignGroup = await prisma.modifierGroup.create({
        data: {
          locationId,
          name: `Foreign Safety Group ${suffix}`,
          displayLabel: "Foreign Safety Group",
          selectionMode: "SINGLE",
          minSelect: 0,
          maxSelect: 1,
          sortOrder: 999,
        },
      });
      const foreignOption = await prisma.modifierOption.create({
        data: {
          modifierGroupId: foreignGroup.id,
          name: `Foreign Option ${suffix}`,
          priceDeltaCents: 50,
          isActive: true,
          sortOrder: 1,
        },
      });
      foreignModifierOptionId = foreignOption.id;
    });

    it("Archived sauce rejection: should reject cart if a sauce is archived", async () => {
      // Archive the sauce
      await request(server)
        .delete(`${BASE}/admin/menu/wing-flavours/${sauceId}`)
        .set("Cookie", adminCookie())
        .set("X-CSRF-Token", CSRF)
        .set("X-Location-Id", locationId)
        .expect(200);

      // Quote should fail
      const quoteRes = await request(server)
        .post(`${BASE}/cart/quote`)
        .set("X-Location-Id", locationId)
        .send({
          fulfillment_type: "PICKUP",
          items: [
            {
              menu_item_id: wingItemId,
              quantity: 1,
              modifier_selections: [],
              builder_payload: {
                builder_type: "WINGS",
                flavour_slots: [{ slot_no: 1, wing_flavour_id: sauceId, flavour_name: "Test Archivable Sauce", placement: "ON_WINGS" }],
              },
            },
          ],
        });

      expect(quoteRes.status).toBe(422);
      expect(quoteRes.body.errors[0].message).toContain("Test Archivable Sauce");
      expect(quoteRes.body.errors[0].message).toContain("no longer available");
    });

    it("Archived sauce rejection: should also reject checkout", async () => {
      const res = await authedPost(server, "/checkout", customerToken, locationId)
        .set("Idempotency-Key", randomUUID())
        .send({
          location_id: locationId,
          fulfillment_type: "PICKUP",
          items: [
            {
              menu_item_id: wingItemId,
              quantity: 1,
              modifier_selections: [],
              builder_payload: {
                builder_type: "WINGS",
                flavour_slots: [{ slot_no: 1, wing_flavour_id: sauceId, flavour_name: "Test Archivable Sauce", placement: "ON_WINGS" }],
              },
            },
          ],
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].message).toContain("Test Archivable Sauce");
      expect(res.body.errors[0].message).toContain("no longer available");
    });

    it("Inactive and missing sauces are rejected by quote", async () => {
      const inactiveRes = await request(server)
        .post(`${BASE}/cart/quote`)
        .set("X-Location-Id", locationId)
        .send({
          fulfillment_type: "PICKUP",
          items: [
            {
              menu_item_id: wingItemId,
              quantity: 1,
              builder_payload: {
                builder_type: "WINGS",
                flavour_slots: [{ slot_no: 1, wing_flavour_id: inactiveSauceId, flavour_name: "Test Inactive Sauce", placement: "ON_WINGS" }],
              },
            },
          ],
        });
      expect(inactiveRes.status).toBe(422);
      expect(inactiveRes.body.errors[0].message).toContain("currently unavailable");

      const missingRes = await request(server)
        .post(`${BASE}/cart/quote`)
        .set("X-Location-Id", locationId)
        .send({
          fulfillment_type: "PICKUP",
          items: [
            {
              menu_item_id: wingItemId,
              quantity: 1,
              builder_payload: {
                builder_type: "WINGS",
                flavour_slots: [{ slot_no: 1, wing_flavour_id: randomUUID(), flavour_name: "Ghost Sauce", placement: "ON_WINGS" }],
              },
            },
          ],
        });
      expect(missingRes.status).toBe(422);
      expect(missingRes.body.errors[0].message).toContain("Ghost Sauce");
    });

    it("Store hour enforcement: should reject quote if store is closed for fulfillment type", async () => {
      try {
        await prisma.locationHours.deleteMany({
          where: { locationId, serviceType: "PICKUP" },
        });
        for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
          await prisma.locationHours.create({
            data: {
              locationId,
              serviceType: "PICKUP",
              dayOfWeek,
              timeFrom: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
              timeTo: new Date(Date.UTC(1970, 0, 1, 23, 59, 0)),
              isClosed: true,
            },
          });
        }

        const quoteRes = await request(server)
          .post(`${BASE}/cart/quote`)
          .set("X-Location-Id", locationId)
          .send({
            fulfillment_type: "PICKUP",
            items: [
              {
                menu_item_id: wingItemId,
                quantity: 1,
                modifier_selections: [],
              },
            ],
          });

        expect(quoteRes.status).toBe(422);
        expect(quoteRes.body.errors[0].message).toContain("not open for pickup at the selected time");
      } finally {
        await setAlwaysOpenLocationHours(prisma, locationId);
      }
    });

    it("Salad child-item validation: should reject quote if salad is archived", async () => {
      // Archive the salad
      await request(server)
        .delete(`${BASE}/admin/menu/items/${archivedSaladId}`)
        .set("Cookie", adminCookie())
        .set("X-CSRF-Token", CSRF)
        .set("X-Location-Id", locationId)
        .expect(200);

      const quoteRes = await request(server)
        .post(`${BASE}/cart/quote`)
        .set("X-Location-Id", locationId)
        .send({
          fulfillment_type: "DELIVERY",
          items: [
            {
              menu_item_id: wingItemId,
              quantity: 1,
              modifier_selections: [],
              builder_payload: {
                builder_type: "WINGS",
                salad_customization: {
                  salad_menu_item_id: archivedSaladId,
                  removed_ingredients: [],
                  modifier_selections: [],
                },
              },
            },
          ],
        });

      expect(quoteRes.status).toBe(422);
      expect(quoteRes.body.errors[0].message).toContain("no longer available");
      expect(quoteRes.body.errors[0].message).toContain("Test Salad");
    });

    it("Salad child-item validation: should reject pickup-only salad in delivery cart", async () => {
      const quoteRes = await request(server)
        .post(`${BASE}/cart/quote`)
        .set("X-Location-Id", locationId)
        .send({
          fulfillment_type: "DELIVERY",
          items: [
            {
              menu_item_id: wingItemId,
              quantity: 1,
              modifier_selections: [],
              builder_payload: {
                builder_type: "WINGS",
                salad_customization: {
                  salad_menu_item_id: pickupOnlySaladId,
                  removed_ingredients: [],
                  modifier_selections: [],
                },
              },
            },
          ],
        });

      expect(quoteRes.status).toBe(422);
      expect(quoteRes.body.errors[0].message).toContain("not available for DELIVERY");
    });

    it("Modifier validation: should reject active options not attached to the menu item", async () => {
      const quoteRes = await request(server)
        .post(`${BASE}/cart/quote`)
        .set("X-Location-Id", locationId)
        .send({
          fulfillment_type: "PICKUP",
          items: [
            {
              menu_item_id: wingItemId,
              quantity: 1,
              modifier_selections: [{ modifier_option_id: foreignModifierOptionId }],
            },
          ],
        });

      expect(quoteRes.status).toBe(422);
      expect(quoteRes.body.errors[0].message).toContain("not valid");
    });

    it("Admin sauce management should not expose or mutate Plain sauce", async () => {
      const plainSauce = await prisma.wingFlavour.findFirstOrThrow({
        where: { locationId, heatLevel: "PLAIN", archivedAt: null },
      });

      const listRes = await request(server)
        .get(`${BASE}/admin/menu/wing-flavours`)
        .set("Cookie", adminCookie())
        .set("X-Location-Id", locationId)
        .expect(200);
      expect(listRes.body.data.some((flavour: { id: string }) => flavour.id === plainSauce.id)).toBe(false);

      const createPlainRes = await request(server)
        .post(`${BASE}/admin/menu/wing-flavours`)
        .set("Cookie", adminCookie())
        .set("X-CSRF-Token", CSRF)
        .set("X-Location-Id", locationId)
        .send({
          name: "Should Not Create Plain",
          category: "PLAIN",
          sort_order: 1,
          is_active: true,
        });
      expect([400, 422]).toContain(createPlainRes.status);

      const archivePlainRes = await request(server)
        .delete(`${BASE}/admin/menu/wing-flavours/${plainSauce.id}`)
        .set("Cookie", adminCookie())
        .set("X-CSRF-Token", CSRF)
        .set("X-Location-Id", locationId);
      expect(archivePlainRes.status).toBe(422);
    });
  });
});
