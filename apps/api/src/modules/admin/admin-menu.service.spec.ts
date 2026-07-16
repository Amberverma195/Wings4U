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
    const service = new AdminMenuService(prisma as any, cache as any, webRevalidation as any);

    const result = await service.createCategory("loc-1", {
      name: "Salads",
      sort_order: 1,
      is_active: true,
    });

    expect(result).toEqual({ id: "cat-1" });
    expect(cache.invalidateLocation).toHaveBeenCalledWith("loc-1");
    expect(webRevalidation.revalidateLocation).toHaveBeenCalledWith("loc-1");
  });

  it("does not invalidate when the write fails", async () => {
    const prisma = createPrismaMock();
    prisma.menuCategory.findUnique.mockResolvedValue(null);
    prisma.menuCategory.create.mockRejectedValue(new Error("db failed"));
    const cache = createCacheMock();
    const webRevalidation = createWebRevalidationMock();
    const service = new AdminMenuService(prisma as any, cache as any, webRevalidation as any);

    await expect(
      service.createCategory("loc-1", {
        name: "Salads",
        sort_order: 1,
        is_active: true,
      }),
    ).rejects.toThrow("db failed");
    expect(cache.invalidateLocation).not.toHaveBeenCalled();
    expect(webRevalidation.revalidateLocation).not.toHaveBeenCalled();
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
