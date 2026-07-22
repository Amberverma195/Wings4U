import { PrismaService } from "../../database/prisma.service";
import { RateLimiterService } from "../rate-limit/rate-limit.service";
import { DeliveryPricingService } from "./delivery-pricing.service";
import {
  DELIVERY_PRICING_RULE_VERSION,
  DELIVERY_ROUTE_LOCAL_CACHE_MAX_ENTRIES,
} from "./delivery-pricing.constants";
import { DeliveryQuoteTokenService } from "./delivery-quote-token.service";
import { GoogleRoutesClient } from "./google-routes.client";

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";
const ADDRESS = {
  line1: "123 Example Street",
  city: "London",
  postal_code: "N5W 3C1",
};
const SCHEDULED_FOR = "2026-07-22T18:00:00.000Z";

function createPrisma(settingsOverrides: Record<string, unknown> = {}) {
  return {
    location: {
      findUnique: jest.fn().mockResolvedValue({
        id: LOCATION_ID,
        isActive: true,
        timezoneName: "America/Toronto",
      }),
    },
    locationSettings: {
      findUnique: jest.fn().mockResolvedValue({
        deliveryDisabled: false,
        deliveryAvailableFromMinutes: null,
        deliveryAvailableUntilMinutes: null,
        allowedPostalCodes: ["N5W"],
        ...settingsOverrides,
      }),
    },
    locationHours: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function createRedisMock(overrides: Record<string, unknown> = {}) {
  return {
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function createRateLimiterMock(overrides: Record<string, unknown> = {}) {
  return {
    check: jest.fn().mockResolvedValue({
      allowed: true,
      remaining: 24,
      resetAtMs: Date.now() + 60_000,
    }),
    ...overrides,
  };
}

type CacheInternals = {
  localRouteCache: Map<
    string,
    {
      expiresAt: number;
      value:
        | { within_delivery_radius: true; delivery_fee_cents: number }
        | { within_delivery_radius: false };
    }
  >;
  getLocalRouteResult: (key: string) => unknown;
  setLocalRouteResult: (
    key: string,
    value: { within_delivery_radius: true; delivery_fee_cents: number },
  ) => void;
  routeCacheKey: (locationId: string, fingerprint: string) => string;
};

function getCacheInternals(service: DeliveryPricingService): CacheInternals {
  return service as unknown as CacheInternals;
}

describe("DeliveryPricingService", () => {
  const originalEnabled = process.env.DELIVERY_DISTANCE_PRICING_ENABLED;

  beforeEach(() => {
    process.env.DELIVERY_DISTANCE_PRICING_ENABLED = "true";
  });

  afterAll(() => {
    process.env.DELIVERY_DISTANCE_PRICING_ENABLED = originalEnabled;
  });

  it("shares a concurrent identical Google request and retains no distance in the quote", async () => {
    const prisma = createPrisma();
    const googleRoutes = {
      computeDrivingDistanceMetres: jest.fn().mockResolvedValue(6_001),
    };
    const tokens = new DeliveryQuoteTokenService();
    const redis = createRedisMock();
    const rateLimiter = createRateLimiterMock();
    const service = new DeliveryPricingService(
      prisma as unknown as PrismaService,
      googleRoutes as unknown as GoogleRoutesClient,
      tokens,
      redis as never,
      rateLimiter as unknown as RateLimiterService,
    );

    const [first, second] = await Promise.all([
      service.createQuote({
        locationId: LOCATION_ID,
        addressSnapshotJson: ADDRESS,
        scheduledFor: SCHEDULED_FOR,
      }),
      service.createQuote({
        locationId: LOCATION_ID,
        addressSnapshotJson: { ...ADDRESS },
        scheduledFor: SCHEDULED_FOR,
      }),
    ]);

    expect(googleRoutes.computeDrivingDistanceMetres).toHaveBeenCalledTimes(1);
    expect(rateLimiter.check).toHaveBeenCalledTimes(2);
    expect(rateLimiter.check).toHaveBeenNthCalledWith(
      1,
      "rate-limit:delivery-quote:global:burst",
      25,
      60_000,
    );
    expect(rateLimiter.check).toHaveBeenNthCalledWith(
      2,
      "rate-limit:delivery-quote:global",
      300,
      900_000,
    );
    expect(first.delivery_fee_cents).toBe(700);
    expect(second.delivery_fee_cents).toBe(700);
    expect(redis.setJson).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^wings4u:delivery-route:v${DELIVERY_PRICING_RULE_VERSION}:`),
      ),
      { within_delivery_radius: true, delivery_fee_cents: 700 },
      3_600,
    );
    const payload = JSON.parse(
      Buffer.from(first.delivery_quote_token.split(".")[0], "base64url").toString(
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("distanceMeters");
    expect(payload).not.toHaveProperty("distance_metres");
    expect(payload).not.toHaveProperty("address");
  });

  it("reuses a cached fee without calling Google again", async () => {
    const prisma = createPrisma();
    const googleRoutes = {
      computeDrivingDistanceMetres: jest.fn(),
    };
    const redis = createRedisMock({
      getJson: jest.fn().mockResolvedValue({
        within_delivery_radius: true,
        delivery_fee_cents: 700,
      }),
    });
    const rateLimiter = createRateLimiterMock();
    const service = new DeliveryPricingService(
      prisma as unknown as PrismaService,
      googleRoutes as unknown as GoogleRoutesClient,
      new DeliveryQuoteTokenService(),
      redis as never,
      rateLimiter as unknown as RateLimiterService,
    );

    const quote = await service.createQuote({
      locationId: LOCATION_ID,
      addressSnapshotJson: ADDRESS,
      scheduledFor: SCHEDULED_FOR,
    });

    expect(quote.delivery_fee_cents).toBe(700);
    expect(googleRoutes.computeDrivingDistanceMetres).not.toHaveBeenCalled();
    expect(rateLimiter.check).not.toHaveBeenCalled();
    expect(redis.getJson).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^wings4u:delivery-route:v${DELIVERY_PRICING_RULE_VERSION}:`),
      ),
    );
  });

  it.each([
    [
      "disabled delivery",
      { deliveryDisabled: true },
      ADDRESS,
      "Delivery is currently unavailable",
    ],
    [
      "closed delivery hours",
      {
        deliveryAvailableFromMinutes: 15 * 60,
        deliveryAvailableUntilMinutes: 16 * 60,
      },
      ADDRESS,
      "Delivery is currently unavailable",
    ],
    [
      "disallowed postal code",
      { allowedPostalCodes: ["N6A"] },
      ADDRESS,
      "Delivery is not available to postal code",
    ],
  ])(
    "does not contact Google for %s",
    async (_label, settings, address, expectedMessage) => {
      const prisma = createPrisma(settings);
      const googleRoutes = {
        computeDrivingDistanceMetres: jest.fn(),
      };
      const service = new DeliveryPricingService(
        prisma as unknown as PrismaService,
        googleRoutes as unknown as GoogleRoutesClient,
        new DeliveryQuoteTokenService(),
        createRedisMock() as never,
        createRateLimiterMock() as unknown as RateLimiterService,
      );

      await expect(
        service.createQuote({
          locationId: LOCATION_ID,
          addressSnapshotJson: address,
          scheduledFor: SCHEDULED_FOR,
        }),
      ).rejects.toThrow(expectedMessage);
      expect(googleRoutes.computeDrivingDistanceMetres).not.toHaveBeenCalled();
    },
  );

  it("does not contact Google for an invalid address", async () => {
    const prisma = createPrisma();
    const googleRoutes = {
      computeDrivingDistanceMetres: jest.fn(),
    };
    const service = new DeliveryPricingService(
      prisma as unknown as PrismaService,
      googleRoutes as unknown as GoogleRoutesClient,
      new DeliveryQuoteTokenService(),
      createRedisMock() as never,
      createRateLimiterMock() as unknown as RateLimiterService,
    );

    await expect(
      service.createQuote({
        locationId: LOCATION_ID,
        addressSnapshotJson: { ...ADDRESS, postal_code: "invalid" },
        scheduledFor: SCHEDULED_FOR,
      }),
    ).rejects.toThrow("valid Canadian postal code");
    expect(googleRoutes.computeDrivingDistanceMetres).not.toHaveBeenCalled();
    expect(prisma.location.findUnique).not.toHaveBeenCalled();
  });

  it("rejects routes beyond 20 km", async () => {
    const prisma = createPrisma();
    const googleRoutes = {
      computeDrivingDistanceMetres: jest.fn().mockResolvedValue(20_001),
    };
    const redis = createRedisMock();
    const service = new DeliveryPricingService(
      prisma as unknown as PrismaService,
      googleRoutes as unknown as GoogleRoutesClient,
      new DeliveryQuoteTokenService(),
      redis as never,
      createRateLimiterMock() as unknown as RateLimiterService,
    );

    await expect(
      service.createQuote({
        locationId: LOCATION_ID,
        addressSnapshotJson: ADDRESS,
        scheduledFor: SCHEDULED_FOR,
      }),
    ).rejects.toThrow("outside our 20 km delivery area");
    expect(redis.setJson).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^wings4u:delivery-route:v${DELIVERY_PRICING_RULE_VERSION}:`),
      ),
      { within_delivery_radius: false },
      3_600,
    );
  });

  it("rejects provider-limit exhaustion before calling Google", async () => {
    const googleRoutes = {
      computeDrivingDistanceMetres: jest.fn(),
    };
    const rateLimiter = createRateLimiterMock({
      check: jest.fn().mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAtMs: Date.now() + 60_000,
      }),
    });
    const service = new DeliveryPricingService(
      createPrisma() as unknown as PrismaService,
      googleRoutes as unknown as GoogleRoutesClient,
      new DeliveryQuoteTokenService(),
      createRedisMock() as never,
      rateLimiter as unknown as RateLimiterService,
    );

    await expect(
      service.createQuote({
        locationId: LOCATION_ID,
        addressSnapshotJson: ADDRESS,
        scheduledFor: SCHEDULED_FOR,
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(googleRoutes.computeDrivingDistanceMetres).not.toHaveBeenCalled();
    expect(rateLimiter.check).toHaveBeenCalledTimes(1);
  });

  it("sweeps expired local entries before inserting", () => {
    const service = new DeliveryPricingService(
      createPrisma() as unknown as PrismaService,
      { computeDrivingDistanceMetres: jest.fn() } as unknown as GoogleRoutesClient,
      new DeliveryQuoteTokenService(),
      createRedisMock() as never,
      createRateLimiterMock() as unknown as RateLimiterService,
    );
    const cache = getCacheInternals(service);
    cache.setLocalRouteResult("expired", {
      within_delivery_radius: true,
      delivery_fee_cents: 500,
    });
    const expired = cache.localRouteCache.get("expired");
    if (!expired) throw new Error("Expected cache entry");
    expired.expiresAt = Date.now() - 1;

    cache.setLocalRouteResult("fresh", {
      within_delivery_radius: true,
      delivery_fee_cents: 600,
    });

    expect(cache.localRouteCache.has("expired")).toBe(false);
    expect(cache.localRouteCache.has("fresh")).toBe(true);
  });

  it("caps the local cache and evicts the least-recently-used entry", () => {
    const service = new DeliveryPricingService(
      createPrisma() as unknown as PrismaService,
      { computeDrivingDistanceMetres: jest.fn() } as unknown as GoogleRoutesClient,
      new DeliveryQuoteTokenService(),
      createRedisMock() as never,
      createRateLimiterMock() as unknown as RateLimiterService,
    );
    const cache = getCacheInternals(service);
    for (let index = 0; index < DELIVERY_ROUTE_LOCAL_CACHE_MAX_ENTRIES; index += 1) {
      cache.setLocalRouteResult(`cache-${index}`, {
        within_delivery_radius: true,
        delivery_fee_cents: 500,
      });
    }

    cache.getLocalRouteResult("cache-0");
    cache.setLocalRouteResult("cache-new", {
      within_delivery_radius: true,
      delivery_fee_cents: 600,
    });

    expect(cache.localRouteCache.size).toBe(
      DELIVERY_ROUTE_LOCAL_CACHE_MAX_ENTRIES,
    );
    expect(cache.localRouteCache.has("cache-0")).toBe(true);
    expect(cache.localRouteCache.has("cache-1")).toBe(false);
    expect(cache.localRouteCache.has("cache-new")).toBe(true);
  });

  it("includes the pricing-rule version in route cache keys", () => {
    const service = new DeliveryPricingService(
      createPrisma() as unknown as PrismaService,
      { computeDrivingDistanceMetres: jest.fn() } as unknown as GoogleRoutesClient,
      new DeliveryQuoteTokenService(),
      createRedisMock() as never,
      createRateLimiterMock() as unknown as RateLimiterService,
    );

    expect(
      getCacheInternals(service).routeCacheKey(LOCATION_ID, "fingerprint"),
    ).toBe(
      `wings4u:delivery-route:v${DELIVERY_PRICING_RULE_VERSION}:${LOCATION_ID}:fingerprint`,
    );
  });
});
