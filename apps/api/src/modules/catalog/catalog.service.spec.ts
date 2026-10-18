import { CatalogService, type CatalogMenuBasePayload } from "./catalog.service";

const baseMenu: CatalogMenuBasePayload = {
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

function createPrismaMock() {
  return {
    location: {
      findUnique: jest.fn(),
    },
    customerProfile: {
      findUnique: jest.fn(),
    },
    locationSettings: {
      findUnique: jest.fn(),
    },
    wingFlavour: {
      findMany: jest.fn(),
    },
  };
}

function createCacheMock() {
  return {
    getMenuBase: jest.fn(),
    setMenuBase: jest.fn(),
    getWingFlavours: jest.fn(),
    setWingFlavours: jest.fn(),
  };
}

describe("CatalogService", () => {
  it('serializes concrete fractional, special and party SKU weights for current builders', async () => {
    const definitions = [
      ['wings', 'wings-1.5lb', '1.5 Pound – 1 Flavour', 1.5],
      ['wing-combos', 'combo-3lb', '3 Pound Combo', 3],
      ['specials', 'wings-4u-special', 'Wings-4-U Special', 2],
      ['party-specials', 'party-75-wings', '75 Wings — 5 Flavours', 5],
      ['party-specials', 'party-100-wings', '100 Wings — 5 Flavours', 6.67],
      ['lunch-specials', 'lunch-5-wings', '5 Wings + Fries + Pop', 0.33],
    ] as const;
    const prisma = createPrismaMock(), cache = createCacheMock();
    cache.getMenuBase.mockResolvedValue({ key: 'fixture', value: null });
    prisma.location.findUnique.mockResolvedValue({ id: 'local', name: 'Fixture', timezoneName: 'America/Toronto', isActive: true,
      settings: null, hours: [], menuCategories: [...new Set(definitions.map(row => row[0]))].map(slug => ({
        id: slug, name: slug, slug, menuItems: definitions.filter(row => row[0] === slug).map(([, sku, name]) => ({
          id: sku, slug: sku, name, basePriceCents: 1000, isAvailable: true, allowedFulfillmentType: 'BOTH', stockStatus: 'NORMAL',
          builderType: slug === 'wing-combos' ? 'WING_COMBO' : 'WINGS', schedules: [], modifierGroups: [], removableIngredients: [],
        })),
      })),
    });
    const result = await new CatalogService(prisma as never, cache as never).getMenu('local', 'PICKUP');
    const options = result.categories.flatMap(category => category.items.flatMap(item => item.weight_options ?? item.combo_options ?? []));
    expect(options.map(option => [option.menu_item_id, option.weight_lb])).toEqual(definitions.map(([, slug, , weight]) => [slug, weight]));
  });
  it("uses cached base menus but still computes customer no-show fields", async () => {
    const prisma = createPrismaMock();
    prisma.customerProfile.findUnique.mockResolvedValue({ totalNoShows: 4 });
    const cache = createCacheMock();
    cache.getMenuBase.mockResolvedValue({ key: "cache-key", value: baseMenu });
    const service = new CatalogService(prisma as any, cache as any);

    const result = await service.getMenu(
      "loc-1",
      "PICKUP",
      "2026-01-01T00:00:00.000Z",
      "user-1",
    );

    expect(prisma.location.findUnique).not.toHaveBeenCalled();
    expect(prisma.customerProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { totalNoShows: true },
    });
    expect(result.location.customer_total_no_shows).toBe(4);
    expect(result.location.delivery_blocked_due_to_no_shows).toBe(true);
    expect(cache.setMenuBase).not.toHaveBeenCalled();
  });

  it("builds and caches base menus without customer-specific fields on misses", async () => {
    const prisma = createPrismaMock();
    prisma.location.findUnique.mockResolvedValue({
      id: "loc-1",
      name: "Wings 4U",
      timezoneName: "America/Toronto",
      isActive: true,
      settings: null,
      hours: [],
      menuCategories: [],
    });
    const cache = createCacheMock();
    cache.getMenuBase.mockResolvedValue({ key: "cache-key", value: null });
    const service = new CatalogService(prisma as any, cache as any);

    const result = await service.getMenu("loc-1", "DELIVERY");

    expect(prisma.location.findUnique).toHaveBeenCalled();
    expect(cache.setMenuBase).toHaveBeenCalledTimes(1);
    const cachedPayload = cache.setMenuBase.mock.calls[0][1];
    expect(cachedPayload.location.customer_total_no_shows).toBeUndefined();
    expect(cachedPayload.location.delivery_blocked_due_to_no_shows).toBeUndefined();
    expect(result.location.customer_total_no_shows).toBeNull();
    expect(result.location.delivery_blocked_due_to_no_shows).toBe(false);
  });
});
