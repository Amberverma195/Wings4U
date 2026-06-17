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
