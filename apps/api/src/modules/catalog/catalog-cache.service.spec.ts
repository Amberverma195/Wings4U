import { CatalogCacheService } from "./catalog-cache.service";
import type { CatalogMenuBasePayload } from "./catalog.service";

function createRedisMock() {
  return {
    get: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
    incr: jest.fn(),
    isReady: jest.fn(),
  };
}

const menuPayload: CatalogMenuBasePayload = {
  categories: [],
  location: {
    id: "loc-1",
    name: "Wings 4U",
    timezone: "America/Toronto",
    is_open: true,
    busy_mode: false,
    estimated_prep_minutes: 30,
    delivery_fee_cents: 0,
    tax_rate_bps: 1300,
    free_delivery_threshold_cents: null,
    minimum_delivery_subtotal_cents: 0,
    delivery_disabled: false,
    delivery_available_from_minutes: null,
    delivery_available_until_minutes: null,
    delivery_currently_available: true,
    delivery_unavailable_reason: null,
    pickup_min_minutes: 30,
    pickup_max_minutes: 40,
    delivery_min_minutes: 40,
    delivery_max_minutes: 60,
    prepayment_threshold_no_shows: 3,
    pickup_hours: [],
    delivery_hours: [],
    store_hours: [],
  },
};

describe("CatalogCacheService", () => {
  it("reads menu payloads from a versioned minute-bucket key", async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue("7");
    redis.getJson.mockResolvedValue(menuPayload);
    const service = new CatalogCacheService(redis as any);

    const lookup = await service.getMenuBase({
      locationId: "loc-1",
      fulfillmentType: "PICKUP",
      scheduleReference: new Date("2026-01-01T00:01:30.000Z"),
    });

    expect(lookup.value).toBe(menuPayload);
    expect(lookup.key).toBe("wings4u:catalog:menu:loc-1:7:PICKUP:29453761");
    expect(redis.getJson).toHaveBeenCalledWith(lookup.key);
  });

  it("uses version 0 when no location version exists", async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue(null);
    redis.getJson.mockResolvedValue(null);
    const service = new CatalogCacheService(redis as any);

    const lookup = await service.getWingFlavours("loc-1");

    expect(lookup).toEqual({
      key: "wings4u:catalog:wing-flavours:loc-1:0",
      value: null,
    });
  });

  it("writes menu and wing flavour payloads with configured default TTLs", async () => {
    const redis = createRedisMock();
    const service = new CatalogCacheService(redis as any);

    await service.setMenuBase("menu-key", menuPayload);
    await service.setWingFlavours("flavour-key", []);

    expect(redis.setJson).toHaveBeenNthCalledWith(1, "menu-key", menuPayload, 60);
    expect(redis.setJson).toHaveBeenNthCalledWith(2, "flavour-key", [], 300);
  });

  it("treats unexpected Redis read errors as cache misses", async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValue("2");
    redis.getJson.mockRejectedValue(new Error("redis unavailable"));
    const service = new CatalogCacheService(redis as any);

    const lookup = await service.getMenuBase({
      locationId: "loc-1",
      fulfillmentType: "DELIVERY",
      scheduleReference: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(lookup.value).toBeNull();
  });

  it("bumps the per-location version when invalidating", async () => {
    const redis = createRedisMock();
    redis.incr.mockResolvedValue(8);
    redis.isReady.mockReturnValue(true);
    const service = new CatalogCacheService(redis as any);

    await service.invalidateLocation("loc-1");

    expect(redis.incr).toHaveBeenCalledWith("wings4u:catalog:version:loc-1");
  });
});
