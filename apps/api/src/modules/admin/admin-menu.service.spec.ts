import { AdminMenuService } from "./admin-menu.service";

function createPrismaMock() {
  return {
    menuCategory: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
}

function createCacheMock() {
  return {
    invalidateLocation: jest.fn(),
  };
}

function createWebRevalidationMock() {
  return {
    revalidateLocation: jest.fn(),
  };
}

function createRealtimeMock() {
  return {
    emitCatalogUpdated: jest.fn(),
  };
}

type TestWingFlavour = {
  id: string;
  locationId: string;
  name: string;
  slug: string;
  heatLevel: "MILD" | "MEDIUM" | "HOT" | "DRY_RUB" | "PLAIN";
  isPlain: boolean;
  isActive: boolean;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function wingFlavour(
  id: string,
  heatLevel: TestWingFlavour["heatLevel"],
  sortOrder: number,
): TestWingFlavour {
  return {
    id,
    locationId: "loc-1",
    name: id,
    slug: id,
    heatLevel,
    isPlain: heatLevel === "PLAIN",
    isActive: true,
    sortOrder,
    archivedAt: null,
    createdAt: new Date(`2026-01-${String(sortOrder).padStart(2, "0")}T00:00:00.000Z`),
    updatedAt: new Date(`2026-01-${String(sortOrder).padStart(2, "0")}T00:00:00.000Z`),
  };
}

function createWingFlavourMutationPrismaMock(initial: TestWingFlavour[]) {
  const rows = initial.map((row) => ({ ...row }));
  const wingFlavourClient = {
    findMany: jest.fn(async ({ where }: any) => {
      return rows
        .filter(
          (row) =>
            row.locationId === where.locationId &&
            row.heatLevel === where.heatLevel &&
            row.archivedAt === null &&
            !row.isPlain &&
            (!where.id?.not || row.id !== where.id.not),
        )
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            right.updatedAt.getTime() - left.updatedAt.getTime() ||
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.id.localeCompare(right.id),
        )
        .map((row) => ({ id: row.id }));
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      return (
        rows.find(
          (row) =>
            row.id === where.id &&
            row.locationId === where.locationId &&
            row.archivedAt === null,
        ) ?? null
      );
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const key = where.locationId_slug;
      return (
        rows.find(
          (row) => row.locationId === key.locationId && row.slug === key.slug,
        ) ?? null
      );
    }),
    create: jest.fn(async ({ data }: any) => {
      const created: TestWingFlavour = {
        id: "created-sauce",
        ...data,
        archivedAt: null,
        createdAt: new Date("2026-07-21T00:00:00.000Z"),
        updatedAt: new Date("2026-07-21T00:00:00.000Z"),
      };
      rows.push(created);
      return { ...created };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error("Missing test sauce");
      Object.assign(row, data);
      return { ...row };
    }),
  };
  const tx = { wingFlavour: wingFlavourClient };
  const prisma = {
    wingFlavour: wingFlavourClient,
    $transaction: jest.fn(async (operation: (client: typeof tx) => unknown) =>
      operation(tx),
    ),
  };

  return { prisma, rows };
}

function activeCategoryOrder(
  rows: TestWingFlavour[],
  category: TestWingFlavour["heatLevel"],
): Array<{ id: string; sortOrder: number }> {
  return rows
    .filter((row) => row.heatLevel === category && row.archivedAt === null)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ id, sortOrder }) => ({ id, sortOrder }));
}

const itemPayload = {
  name: "Butter Tarts",
  description: "House-made butter tarts",
  base_price_cents: 599,
  category_id: "cat-sides",
  stock_status: "NORMAL" as const,
  is_hidden: false,
  is_wing_combo_side: true,
  allowed_fulfillment_type: "BOTH" as const,
};

function createItemMutationPrismaMock(tx: Record<string, unknown>) {
  return {
    menuCategory: {
      findFirst: jest.fn().mockResolvedValue({ id: "cat-sides" }),
    },
    menuItem: {
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
}

describe("AdminMenuService catalog invalidation", () => {
  it("invalidates the catalog after a successful category create", async () => {
    const prisma = createPrismaMock();
    prisma.menuCategory.findUnique.mockResolvedValue(null);
    prisma.menuCategory.create.mockResolvedValue({ id: "cat-1" });
    const cache = createCacheMock();
    const webRevalidation = createWebRevalidationMock();
    const realtime = createRealtimeMock();
    const service = new AdminMenuService(
      prisma as any,
      cache as any,
      webRevalidation as any,
      realtime as any,
    );

    const result = await service.createCategory("loc-1", {
      name: "Salads",
      sort_order: 1,
      is_active: true,
    });

    expect(result).toEqual({ id: "cat-1" });
    expect(cache.invalidateLocation).toHaveBeenCalledWith("loc-1");
    expect(webRevalidation.revalidateLocation).toHaveBeenCalledWith("loc-1");
    expect(realtime.emitCatalogUpdated).toHaveBeenCalledWith("loc-1");
  });

  it("does not invalidate when the write fails", async () => {
    const prisma = createPrismaMock();
    prisma.menuCategory.findUnique.mockResolvedValue(null);
    prisma.menuCategory.create.mockRejectedValue(new Error("db failed"));
    const cache = createCacheMock();
    const webRevalidation = createWebRevalidationMock();
    const realtime = createRealtimeMock();
    const service = new AdminMenuService(
      prisma as any,
      cache as any,
      webRevalidation as any,
      realtime as any,
    );

    await expect(
      service.createCategory("loc-1", {
        name: "Salads",
        sort_order: 1,
        is_active: true,
      }),
    ).rejects.toThrow("db failed");
    expect(cache.invalidateLocation).not.toHaveBeenCalled();
    expect(webRevalidation.revalidateLocation).not.toHaveBeenCalled();
    expect(realtime.emitCatalogUpdated).not.toHaveBeenCalled();
  });
});

describe("AdminMenuService wing flavour ordering", () => {
  function createService(initial: TestWingFlavour[]) {
    const state = createWingFlavourMutationPrismaMock(initial);
    const service = new AdminMenuService(
      state.prisma as any,
      createCacheMock() as any,
      createWebRevalidationMock() as any,
      createRealtimeMock() as any,
    );
    return { service, rows: state.rows };
  }

  it("moves a sauce to position 2 and shifts later sauces down", async () => {
    const { service, rows } = createService([
      wingFlavour("one", "MILD", 1),
      wingFlavour("two", "MILD", 2),
      wingFlavour("three", "MILD", 3),
      wingFlavour("eight", "MILD", 8),
    ]);

    await service.updateWingFlavour("loc-1", "eight", {
      name: "eight",
      category: "MILD",
      sort_order: 2,
      is_active: true,
    });

    expect(activeCategoryOrder(rows, "MILD")).toEqual([
      { id: "one", sortOrder: 1 },
      { id: "eight", sortOrder: 2 },
      { id: "two", sortOrder: 3 },
      { id: "three", sortOrder: 4 },
    ]);
  });

  it("moves a sauce to a later position and shifts intervening sauces up", async () => {
    const { service, rows } = createService([
      wingFlavour("one", "MILD", 1),
      wingFlavour("two", "MILD", 2),
      wingFlavour("three", "MILD", 3),
      wingFlavour("four", "MILD", 4),
    ]);

    await service.updateWingFlavour("loc-1", "two", {
      name: "two",
      category: "MILD",
      sort_order: 4,
      is_active: true,
    });

    expect(activeCategoryOrder(rows, "MILD")).toEqual([
      { id: "one", sortOrder: 1 },
      { id: "three", sortOrder: 2 },
      { id: "four", sortOrder: 3 },
      { id: "two", sortOrder: 4 },
    ]);
  });

  it("closes the old category gap and inserts into the new category", async () => {
    const { service, rows } = createService([
      wingFlavour("mild-one", "MILD", 1),
      wingFlavour("moving", "MILD", 2),
      wingFlavour("medium-one", "MEDIUM", 1),
      wingFlavour("medium-two", "MEDIUM", 2),
    ]);

    await service.updateWingFlavour("loc-1", "moving", {
      name: "moving",
      category: "MEDIUM",
      sort_order: 2,
      is_active: true,
    });

    expect(activeCategoryOrder(rows, "MILD")).toEqual([
      { id: "mild-one", sortOrder: 1 },
    ]);
    expect(activeCategoryOrder(rows, "MEDIUM")).toEqual([
      { id: "medium-one", sortOrder: 1 },
      { id: "moving", sortOrder: 2 },
      { id: "medium-two", sortOrder: 3 },
    ]);
  });

  it("inserts a new sauce at the requested category position", async () => {
    const { service, rows } = createService([
      wingFlavour("one", "HOT", 1),
      wingFlavour("two", "HOT", 2),
    ]);

    await service.createWingFlavour("loc-1", {
      name: "New Hot Sauce",
      category: "HOT",
      sort_order: 2,
      is_active: true,
    });

    expect(activeCategoryOrder(rows, "HOT")).toEqual([
      { id: "one", sortOrder: 1 },
      { id: "created-sauce", sortOrder: 2 },
      { id: "two", sortOrder: 3 },
    ]);
  });

  it("closes the category gap after archiving a sauce", async () => {
    const { service, rows } = createService([
      wingFlavour("one", "DRY_RUB", 1),
      wingFlavour("two", "DRY_RUB", 2),
      wingFlavour("three", "DRY_RUB", 3),
    ]);

    await service.archiveWingFlavour("loc-1", "two");

    expect(activeCategoryOrder(rows, "DRY_RUB")).toEqual([
      { id: "one", sortOrder: 1 },
      { id: "three", sortOrder: 2 },
    ]);
    expect(rows.find((row) => row.id === "two")).toMatchObject({
      archivedAt: expect.any(Date),
      isActive: false,
    });
  });

  it("normalizes legacy duplicate and gapped positions during a move", async () => {
    const first = wingFlavour("bbq-ranch", "MILD", 5);
    const second = wingFlavour("honey-dill", "MILD", 5);
    second.createdAt = new Date("2026-02-01T00:00:00.000Z");
    const { service, rows } = createService([
      first,
      second,
      wingFlavour("honey-ranch", "MILD", 9),
    ]);

    await service.updateWingFlavour("loc-1", "honey-dill", {
      name: "honey-dill",
      category: "MILD",
      sort_order: 2,
      is_active: true,
    });

    expect(activeCategoryOrder(rows, "MILD")).toEqual([
      { id: "bbq-ranch", sortOrder: 1 },
      { id: "honey-dill", sortOrder: 2 },
      { id: "honey-ranch", sortOrder: 3 },
    ]);
  });
});

describe("AdminMenuService wing combo side synchronization", () => {
  it("creates a linked modifier option in every side group", async () => {
    const createdItem = {
      id: "item-butter-tarts",
      name: "Butter Tarts",
      isWingComboSide: true,
      isAvailable: true,
      archivedAt: null,
    };
    const tx = {
      menuItem: {
        create: jest.fn().mockResolvedValue(createdItem),
      },
      menuItemSchedule: { createMany: jest.fn() },
      modifierGroup: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "small-side",
            options: [
              {
                id: "fries-small",
                name: "Fries",
                linkedMenuItemId: "item-fries",
                sortOrder: 4,
              },
            ],
          },
          { id: "large-side", options: [] },
        ]),
      },
      modifierOption: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn(),
      },
    };
    const prisma = createItemMutationPrismaMock(tx);
    const cache = createCacheMock();
    const webRevalidation = createWebRevalidationMock();
    const service = new AdminMenuService(
      prisma as any,
      cache as any,
      webRevalidation as any,
      createRealtimeMock() as any,
    );

    await service.createItem("loc-1", itemPayload);

    expect(tx.modifierOption.create).toHaveBeenCalledTimes(2);
    expect(tx.modifierOption.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        modifierGroupId: "small-side",
        linkedMenuItemId: "item-butter-tarts",
        name: "Butter Tarts",
        priceDeltaCents: 0,
        sortOrder: 5,
      }),
    });
    expect(tx.modifierOption.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        modifierGroupId: "large-side",
        linkedMenuItemId: "item-butter-tarts",
        sortOrder: 1,
      }),
    });
    expect(cache.invalidateLocation).toHaveBeenCalledWith("loc-1");
  });

  it("renames and deactivates linked options when the item is unavailable", async () => {
    const existingItem = {
      id: "item-butter-tarts",
      name: "Butter Tarts",
      isWingComboSide: true,
      isAvailable: true,
      archivedAt: null,
    };
    const updatedItem = {
      ...existingItem,
      name: "Butter Tart Bites",
      isAvailable: false,
    };
    const tx = {
      removableIngredient: { deleteMany: jest.fn(), createMany: jest.fn() },
      menuItemModifierGroup: { deleteMany: jest.fn(), createMany: jest.fn() },
      menuItemSchedule: { deleteMany: jest.fn(), createMany: jest.fn() },
      menuItem: {
        update: jest.fn().mockResolvedValue(updatedItem),
      },
      modifierGroup: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "small-side",
            options: [
              {
                id: "option-butter-tarts",
                name: "Butter Tarts",
                linkedMenuItemId: existingItem.id,
                sortOrder: 5,
              },
            ],
          },
        ]),
      },
      modifierOption: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = createItemMutationPrismaMock(tx);
    prisma.menuItem.findFirst.mockResolvedValue(existingItem);
    const service = new AdminMenuService(
      prisma as any,
      createCacheMock() as any,
      createWebRevalidationMock() as any,
      createRealtimeMock() as any,
    );

    await service.updateItem("loc-1", existingItem.id, {
      ...itemPayload,
      name: "Butter Tart Bites",
      stock_status: "UNAVAILABLE",
    });

    expect(tx.modifierOption.update).toHaveBeenCalledWith({
      where: { id: "option-butter-tarts" },
      data: {
        name: "Butter Tart Bites",
        isActive: false,
        linkedMenuItemId: existingItem.id,
      },
    });
    expect(tx.modifierOption.create).not.toHaveBeenCalled();
  });

  it("deactivates linked options when the menu item is archived", async () => {
    const existingItem = {
      id: "item-butter-tarts",
      name: "Butter Tarts",
      isWingComboSide: true,
      isAvailable: true,
      archivedAt: null,
    };
    const archivedItem = { ...existingItem, archivedAt: new Date() };
    const tx = {
      menuItem: {
        update: jest.fn().mockResolvedValue(archivedItem),
      },
      modifierGroup: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "small-side",
            options: [
              {
                id: "option-butter-tarts",
                name: "Butter Tarts",
                linkedMenuItemId: existingItem.id,
                sortOrder: 5,
              },
            ],
          },
        ]),
      },
      modifierOption: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = createItemMutationPrismaMock(tx);
    prisma.menuItem.findFirst.mockResolvedValue(existingItem);
    const service = new AdminMenuService(
      prisma as any,
      createCacheMock() as any,
      createWebRevalidationMock() as any,
      createRealtimeMock() as any,
    );

    await service.deleteItem("loc-1", existingItem.id);

    expect(tx.modifierOption.update).toHaveBeenCalledWith({
      where: { id: "option-butter-tarts" },
      data: {
        name: "Butter Tarts",
        isActive: false,
        linkedMenuItemId: existingItem.id,
      },
    });
  });
});
