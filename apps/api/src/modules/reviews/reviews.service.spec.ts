import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ReviewsService } from "./reviews.service";
import type { PrismaService } from "../../database/prisma.service";

describe("ReviewsService (Isolated Mock Unit Tests)", () => {
  let service: ReviewsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      orderItem: {
        findUnique: jest.fn(),
      },
      order: {
        findUnique: jest.fn(),
      },
      itemReview: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new ReviewsService(mockPrisma as unknown as PrismaService);
  });

  describe("listPublicApproved", () => {
    it("retrieves ONLY approved public reviews and omits all PII and order identifiers", async () => {
      const mockDbRows = [
        {
          id: "review-1",
          rating: 5,
          reviewBody: "Crispy and juicy!",
          createdAt: new Date("2026-10-20T12:00:00Z"),
          adminReply: "Thank you for visiting Wings 4 U!",
          adminRepliedAt: new Date("2026-10-21T10:00:00Z"),
          orderItem: {
            productNameSnapshot: "Honey Gold Wings",
          },
        },
      ];

      mockPrisma.itemReview.findMany.mockResolvedValueOnce(mockDbRows);

      const result = await service.listPublicApproved(10);

      // Verify Prisma query strictly enforces isApprovedPublic = true
      expect(mockPrisma.itemReview.findMany).toHaveBeenCalledWith({
        where: { isApprovedPublic: true },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          rating: true,
          reviewBody: true,
          createdAt: true,
          adminReply: true,
          adminRepliedAt: true,
          orderItem: {
            select: {
              productNameSnapshot: true,
            },
          },
        },
      });

      expect(result).toHaveLength(1);
      const item = result[0];
      expect(item.id).toBe("review-1");
      expect(item.rating).toBe(5);
      expect(item.comment).toBe("Crispy and juicy!");
      expect(item.item_name).toBe("Honey Gold Wings");
      expect(item.attribution).toBe("Verified Wings4U Customer");
      expect(item.admin_reply).toBe("Thank you for visiting Wings 4 U!");

      // Confirm no private customer fields exist
      expect((item as any).customer_user_id).toBeUndefined();
      expect((item as any).customer_name).toBeUndefined();
      expect((item as any).customer_email).toBeUndefined();
      expect((item as any).customer_phone).toBeUndefined();
      expect((item as any).order_id).toBeUndefined();
      expect((item as any).order_item_id).toBeUndefined();
      expect((item as any).order_number).toBeUndefined();
    });

    it("returns an empty array when no reviews are approved", async () => {
      mockPrisma.itemReview.findMany.mockResolvedValueOnce([]);
      const result = await service.listPublicApproved(10);
      expect(result).toEqual([]);
    });
  });

  describe("listAllForAdmin", () => {
    it("enriches admin review list with customer snapshot and order details", async () => {
      const mockRows = [
        {
          id: "rev-uuid-1",
          orderId: "order-uuid-1",
          orderItemId: "item-uuid-1",
          customerUserId: "user-uuid-1",
          rating: 4,
          reviewBody: "Great dry rubs",
          isApprovedPublic: false,
          adminReply: null,
          adminRepliedAt: null,
          adminRepliedByUserId: null,
          createdAt: new Date("2026-10-21T14:00:00Z"),
          updatedAt: new Date("2026-10-21T14:00:00Z"),
          order: {
            orderNumber: "1055",
            customerNameSnapshot: "John Doe",
            customerPhoneSnapshot: "+15195550199",
            customerEmailSnapshot: "john.doe@example.com",
          },
          orderItem: {
            productNameSnapshot: "1lb Traditional Wings",
            categoryNameSnapshot: "Wings",
          },
        },
      ];

      mockPrisma.itemReview.findMany.mockResolvedValueOnce(mockRows);

      const result = await service.listAllForAdmin({ limit: 20 });

      expect(mockPrisma.itemReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            order: {
              select: {
                orderNumber: true,
                customerNameSnapshot: true,
                customerPhoneSnapshot: true,
                customerEmailSnapshot: true,
              },
            },
            orderItem: {
              select: {
                productNameSnapshot: true,
                categoryNameSnapshot: true,
              },
            },
          },
        }),
      );

      expect(result.items).toHaveLength(1);
      const row = result.items[0];
      expect(row.order_number).toBe("1055");
      expect(row.customer_name).toBe("John Doe");
      expect(row.customer_phone).toBe("+15195550199");
      expect(row.customer_email).toBe("john.doe@example.com");
      expect(row.item_name).toBe("1lb Traditional Wings");
      expect(row.is_approved_public).toBe(false);
    });

    it("respects anonymized deleted customers without restoring PII", async () => {
      const mockRows = [
        {
          id: "rev-uuid-2",
          orderId: "order-uuid-2",
          orderItemId: "item-uuid-2",
          customerUserId: "user-uuid-2",
          rating: 5,
          reviewBody: "Tasty",
          isApprovedPublic: false,
          adminReply: null,
          adminRepliedAt: null,
          adminRepliedByUserId: null,
          createdAt: new Date("2026-10-21T14:00:00Z"),
          updatedAt: new Date("2026-10-21T14:00:00Z"),
          order: {
            orderNumber: "1056",
            customerNameSnapshot: "Deleted customer",
            customerPhoneSnapshot: "",
            customerEmailSnapshot: null,
          },
          orderItem: {
            productNameSnapshot: "Garlic Parm Wings",
            categoryNameSnapshot: "Wings",
          },
        },
      ];

      mockPrisma.itemReview.findMany.mockResolvedValueOnce(mockRows);

      const result = await service.listAllForAdmin({});
      expect(result.items[0].customer_name).toBe("Deleted customer");
      expect(result.items[0].customer_phone).toBe("");
      expect(result.items[0].customer_email).toBeNull();
    });
  });

  describe("adminReply", () => {
    it("saves reply and updates adminRepliedAt and adminRepliedByUserId", async () => {
      mockPrisma.itemReview.findUnique.mockResolvedValueOnce({ id: "rev-1" });
      mockPrisma.itemReview.update.mockResolvedValueOnce({
        id: "rev-1",
        orderId: "ord-1",
        orderItemId: "item-1",
        customerUserId: "user-1",
        rating: 5,
        reviewBody: "Loved it!",
        isApprovedPublic: false,
        adminReply: "Thanks for coming in!",
        adminRepliedAt: new Date("2026-10-22T12:00:00Z"),
        adminRepliedByUserId: "admin-user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        order: {
          orderNumber: "1057",
          customerNameSnapshot: "Alice",
          customerPhoneSnapshot: "+15195550123",
          customerEmailSnapshot: "alice@example.com",
        },
        orderItem: {
          productNameSnapshot: "Honey Garlic",
        },
      });

      const updated = await service.adminReply({
        reviewId: "rev-1",
        adminUserId: "admin-user-1",
        reply: "Thanks for coming in!",
      });

      expect(updated.admin_reply).toBe("Thanks for coming in!");
      expect(updated.admin_replied_by_user_id).toBe("admin-user-1");
      expect(updated.customer_name).toBe("Alice");
    });

    it("rejects blank or empty replies", async () => {
      await expect(
        service.adminReply({
          reviewId: "rev-1",
          adminUserId: "admin-1",
          reply: "   ",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("listByOrder", () => {
    it("forbids a customer from viewing reviews of an order they do not own", async () => {
      mockPrisma.order.findUnique.mockResolvedValueOnce({
        id: "ord-1",
        customerUserId: "owner-customer-id",
      });

      await expect(
        service.listByOrder("ord-1", "CUSTOMER", "different-customer-id"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("allows the owner customer to view their own review with admin reply", async () => {
      mockPrisma.order.findUnique.mockResolvedValueOnce({
        id: "ord-1",
        customerUserId: "customer-1",
      });
      mockPrisma.itemReview.findMany.mockResolvedValueOnce([
        {
          id: "rev-1",
          orderId: "ord-1",
          orderItemId: "item-1",
          customerUserId: "customer-1",
          rating: 5,
          reviewBody: "Super crispy!",
          isApprovedPublic: false, // Internal/unpublished review
          adminReply: "Glad you enjoyed them!",
          adminRepliedAt: new Date("2026-10-22T10:00:00Z"),
          adminRepliedByUserId: "admin-1",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const reviews = await service.listByOrder("ord-1", "CUSTOMER", "customer-1");
      expect(reviews).toHaveLength(1);
      expect(reviews[0].admin_reply).toBe("Glad you enjoyed them!");
      expect(reviews[0].is_approved_public).toBe(false);
    });
  });
});
