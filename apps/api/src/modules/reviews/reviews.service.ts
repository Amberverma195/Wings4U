import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

const REVIEWABLE_STATUSES = new Set(["PICKED_UP", "DELIVERED"]);

interface CreateReviewParams {
  orderId: string;
  orderItemId: string;
  customerUserId: string;
  rating: number;
  reviewBody?: string | null;
}

interface AdminReplyParams {
  reviewId: string;
  adminUserId: string;
  reply: string;
}

interface SetPublishParams {
  reviewId: string;
  publish: boolean;
}

function serialize(r: Record<string, unknown>) {
  return {
    id: r.id,
    order_id: r.orderId,
    order_item_id: r.orderItemId,
    customer_user_id: r.customerUserId,
    rating: r.rating,
    review_body: r.reviewBody,
    is_approved_public: r.isApprovedPublic,
    admin_reply: r.adminReply,
    admin_replied_at: r.adminRepliedAt,
    admin_replied_by_user_id: r.adminRepliedByUserId,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD §14.1 — review allowed only if order is PICKED_UP or DELIVERED.
   * PRD §14.2 — one review per order_item per customer (unique constraint).
   */
  async createReview(params: CreateReviewParams) {
    if (!Number.isInteger(params.rating) || params.rating < 1 || params.rating > 5) {
      throw new BadRequestException("rating must be an integer between 1 and 5");
    }

    const orderItem = await this.prisma.orderItem.findUnique({
      where: { id: params.orderItemId },
      select: {
        id: true,
        orderId: true,
        order: { select: { id: true, status: true, customerUserId: true } },
      },
    });
    if (!orderItem || orderItem.orderId !== params.orderId) {
      throw new NotFoundException("Order item not found for this order");
    }

    if (orderItem.order.customerUserId !== params.customerUserId) {
      throw new ForbiddenException("You can only review your own orders");
    }

    if (!REVIEWABLE_STATUSES.has(orderItem.order.status)) {
      throw new BadRequestException(
        `Reviews are only allowed for PICKED_UP or DELIVERED orders (current status: ${orderItem.order.status})`,
      );
    }

    try {
      const review = await this.prisma.itemReview.create({
        data: {
          orderId: params.orderId,
          orderItemId: params.orderItemId,
          customerUserId: params.customerUserId,
          rating: params.rating,
          reviewBody: params.reviewBody?.trim() || null,
        },
      });
      return serialize(review as unknown as Record<string, unknown>);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("You have already reviewed this item");
      }
      throw err;
    }
  }

  /**
   * List reviews for an order. Customers only see their own order's reviews;
   * staff/admin see all reviews attached to the order.
   */
  async listByOrder(
    orderId: string,
    viewerRole: "CUSTOMER" | "STAFF" | "ADMIN",
    viewerUserId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerUserId: true },
    });
    if (!order) throw new NotFoundException("Order not found");

    if (viewerRole === "CUSTOMER" && order.customerUserId !== viewerUserId) {
      throw new ForbiddenException("You do not have access to this order");
    }

    const reviews = await this.prisma.itemReview.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    });
    return reviews.map((r) => serialize(r as unknown as Record<string, unknown>));
  }

  /**
   * Admin list — paginated across all reviews, newest first.
   */
  async listAllForAdmin(params: {
    limit?: number;
    cursor?: string;
    hasReply?: boolean;
  }) {
    const take = Math.min(Math.max(params.limit ?? 50, 1), 100);
    const where: Prisma.ItemReviewWhereInput =
      params.hasReply === undefined
        ? {}
        : params.hasReply
          ? { adminReply: { not: null } }
          : { adminReply: null };

    const rows = await this.prisma.itemReview.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: page.map((r) => serialize(r as unknown as Record<string, unknown>)),
      next_cursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /**
   * PRD §14.3 — admin stores reply + admin_replied_at + admin_replied_by_user_id.
   */
  async adminReply(params: AdminReplyParams) {
    const trimmed = params.reply.trim();
    if (trimmed.length < 1) {
      throw new BadRequestException("Reply cannot be empty");
    }

    const existing = await this.prisma.itemReview.findUnique({
      where: { id: params.reviewId },
    });
    if (!existing) throw new NotFoundException("Review not found");

    const updated = await this.prisma.itemReview.update({
      where: { id: params.reviewId },
      data: {
        adminReply: trimmed,
        adminRepliedAt: new Date(),
        adminRepliedByUserId: params.adminUserId,
      },
    });
    return serialize(updated as unknown as Record<string, unknown>);
  }

  /**
   * PRD §14.3 — reviews are internal by default; `is_approved_public` is
   * toggled by the owner to publish a review externally.
   */
  async setPublish(params: SetPublishParams) {
    const existing = await this.prisma.itemReview.findUnique({
      where: { id: params.reviewId },
    });
    if (!existing) throw new NotFoundException("Review not found");

    const updated = await this.prisma.itemReview.update({
      where: { id: params.reviewId },
      data: { isApprovedPublic: params.publish },
    });
    return serialize(updated as unknown as Record<string, unknown>);
  }
}
