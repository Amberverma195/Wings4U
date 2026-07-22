import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { configureApp } from "../../app.setup";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { PrismaService } from "../../database/prisma.service";
import { RateLimiterService } from "../rate-limit/rate-limit.service";
import { RedisService } from "../redis/redis.service";
import { DeliveryPricingController } from "./delivery-pricing.controller";
import { DeliveryPricingService } from "./delivery-pricing.service";
import { DeliveryQuoteTokenService } from "./delivery-quote-token.service";
import { GoogleRoutesClient } from "./google-routes.client";

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

describe("POST /api/v1/delivery/quote", () => {
  const originalEnabled = process.env.DELIVERY_DISTANCE_PRICING_ENABLED;
  let app: INestApplication;
  let googleRoutes: { computeDrivingDistanceMetres: jest.Mock };
  let rateLimiterCheck: jest.Mock;
  let settings: Record<string, unknown>;
  let rateLimitAllowed = true;

  beforeAll(async () => {
    process.env.DELIVERY_DISTANCE_PRICING_ENABLED = "true";
    settings = {
      deliveryDisabled: false,
      deliveryAvailableFromMinutes: null,
      deliveryAvailableUntilMinutes: null,
      allowedPostalCodes: ["N5W"],
    };
    googleRoutes = {
      computeDrivingDistanceMetres: jest.fn().mockResolvedValue(6_001),
    };
    rateLimiterCheck = jest.fn(async () => ({
      allowed: rateLimitAllowed,
      remaining: rateLimitAllowed ? 11 : 0,
      resetAtMs: Date.now() + 900_000,
    }));
    const prisma = {
      location: {
        findUnique: jest.fn().mockResolvedValue({
          id: LOCATION_ID,
          isActive: true,
          timezoneName: "America/Toronto",
        }),
      },
      locationSettings: {
        findUnique: jest.fn(async () => settings),
      },
      locationHours: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const module = await Test.createTestingModule({
      controllers: [DeliveryPricingController],
      providers: [
        DeliveryPricingService,
        DeliveryQuoteTokenService,
        LocationScopeGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: GoogleRoutesClient, useValue: googleRoutes },
        {
          provide: RedisService,
          useValue: {
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: RateLimiterService,
          useValue: { check: rateLimiterCheck },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    process.env.DELIVERY_DISTANCE_PRICING_ENABLED = originalEnabled;
    await app.close();
  });

  beforeEach(() => {
    rateLimitAllowed = true;
    settings = {
      deliveryDisabled: false,
      deliveryAvailableFromMinutes: null,
      deliveryAvailableUntilMinutes: null,
      allowedPostalCodes: ["N5W"],
    };
    googleRoutes.computeDrivingDistanceMetres.mockClear();
    rateLimiterCheck.mockClear();
  });

  it("returns a signed exact quote", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/delivery/quote")
      .set("X-Location-Id", LOCATION_ID)
      .send({
        location_id: LOCATION_ID,
        address_snapshot_json: {
          line1: "123 Example Street",
          city: "London",
          postal_code: "N5W 3C1",
        },
        scheduled_for: "2026-07-22T18:00:00.000Z",
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      delivery_fee_cents: 700,
      attribution: "Google Maps",
    });
    expect(response.body.data.delivery_quote_token).toEqual(expect.any(String));
    expect(response.body.data.expires_at).toEqual(expect.any(String));
    expect(googleRoutes.computeDrivingDistanceMetres).toHaveBeenCalledTimes(1);
    expect(rateLimiterCheck).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^rate-limit:delivery-quote:ip:/),
      12,
      900_000,
    );
    expect(rateLimiterCheck).toHaveBeenNthCalledWith(
      2,
      "rate-limit:delivery-quote:global:burst",
      25,
      60_000,
    );
    expect(rateLimiterCheck).toHaveBeenNthCalledWith(
      3,
      "rate-limit:delivery-quote:global",
      300,
      900_000,
    );
  });

  it.each([
    [
      "invalid address",
      {
        deliveryDisabled: false,
        deliveryAvailableFromMinutes: null,
        deliveryAvailableUntilMinutes: null,
        allowedPostalCodes: ["N5W"],
      },
      "invalid",
    ],
    [
      "disabled delivery",
      {
        deliveryDisabled: true,
        deliveryAvailableFromMinutes: null,
        deliveryAvailableUntilMinutes: null,
        allowedPostalCodes: ["N5W"],
      },
      "N5W 3C1",
    ],
    [
      "disallowed postal",
      {
        deliveryDisabled: false,
        deliveryAvailableFromMinutes: null,
        deliveryAvailableUntilMinutes: null,
        allowedPostalCodes: ["N6A"],
      },
      "N5W 3C1",
    ],
  ])("makes zero Google calls for %s", async (_label, nextSettings, postalCode) => {
    settings = nextSettings;
    await request(app.getHttpServer())
      .post("/api/v1/delivery/quote")
      .set("X-Location-Id", LOCATION_ID)
      .send({
        location_id: LOCATION_ID,
        address_snapshot_json: {
          line1: "123 Example Street",
          city: "London",
          postal_code: postalCode,
        },
        scheduled_for: "2026-07-22T18:00:00.000Z",
      })
      .expect(422);

    expect(googleRoutes.computeDrivingDistanceMetres).not.toHaveBeenCalled();
  });

  it("enforces the public rate limit before Google", async () => {
    rateLimitAllowed = false;
    await request(app.getHttpServer())
      .post("/api/v1/delivery/quote")
      .set("X-Location-Id", LOCATION_ID)
      .send({
        location_id: LOCATION_ID,
        address_snapshot_json: {
          line1: "123 Example Street",
          city: "London",
          postal_code: "N5W 3C1",
        },
        scheduled_for: "2026-07-22T18:00:00.000Z",
      })
      .expect(429);

    expect(googleRoutes.computeDrivingDistanceMetres).not.toHaveBeenCalled();
  });

  it("enforces the API-wide quote budget before Google", async () => {
    rateLimiterCheck
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 11,
        resetAtMs: Date.now() + 900_000,
      })
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 24,
        resetAtMs: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAtMs: Date.now() + 900_000,
      });

    await request(app.getHttpServer())
      .post("/api/v1/delivery/quote")
      .set("X-Location-Id", LOCATION_ID)
      .send({
        location_id: LOCATION_ID,
        address_snapshot_json: {
          line1: "124 Example Street",
          city: "London",
          postal_code: "N5W 3C1",
        },
        scheduled_for: "2026-07-22T18:00:00.000Z",
      })
      .expect(429);

    expect(googleRoutes.computeDrivingDistanceMetres).not.toHaveBeenCalled();
  });

  it("enforces the global burst quota before Google", async () => {
    rateLimiterCheck
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 11,
        resetAtMs: Date.now() + 900_000,
      })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAtMs: Date.now() + 60_000,
      });

    await request(app.getHttpServer())
      .post("/api/v1/delivery/quote")
      .set("X-Location-Id", LOCATION_ID)
      .send({
        location_id: LOCATION_ID,
        address_snapshot_json: {
          line1: "125 Example Street",
          city: "London",
          postal_code: "N5W 3C1",
        },
        scheduled_for: "2026-07-22T18:00:00.000Z",
      })
      .expect(429);

    expect(googleRoutes.computeDrivingDistanceMetres).not.toHaveBeenCalled();
  });
});
