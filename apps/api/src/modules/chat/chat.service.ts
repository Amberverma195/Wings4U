import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RateLimiterService } from "../rate-limit/rate-limit.service";

const CHAT_MESSAGE_RATE_LIMIT = 5;
const CHAT_MESSAGE_RATE_WINDOW_MS = 60_000;

type SenderSurface = "CUSTOMER" | "KDS" | "MANAGER" | "ADMIN";
type ReaderSide = "CUSTOMER" | "STAFF";

const TERMINAL_ORDER_STATUSES = new Set([
  "CANCELLED",
  "DELIVERED",
  "PICKED_UP",
  "NO_SHOW_PICKUP",
  "NO_SHOW_DELIVERY",
  "NO_PIN_DELIVERY",
]);

function serializeMessage(m: Record<string, unknown>) {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    order_id: m.orderId,
    sender_user_id: m.senderUserId,
    sender_surface: m.senderSurface,
    message_body: m.messageBody,
    is_system_message: m.isSystemMessage ?? false,
    visibility: m.visibility ?? "BOTH",
    created_at: m.createdAt,
  };
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  /**
   * Derive the canonical sender_surface from the authenticated user.
   * CASHIER and DRIVER are not allowed to send order chat messages.
   */
  deriveSenderSurface(
    role: "CUSTOMER" | "STAFF" | "ADMIN",
    employeeRole?: string,
  ): SenderSurface {
    if (role === "CUSTOMER") return "CUSTOMER";
    if (role === "ADMIN") return "ADMIN";

    switch (employeeRole) {
      case "KITCHEN":
        return "KDS";
      case "MANAGER":
        return "MANAGER";
      default:
        throw new ForbiddenException(
          `Employee role "${employeeRole ?? "unknown"}" cannot send order chat messages`,
        );
    }
  }

  deriveReaderSide(role: "CUSTOMER" | "STAFF" | "ADMIN"): ReaderSide {
    return role === "CUSTOMER" ? "CUSTOMER" : "STAFF";
  }

  async getMessages(
    orderId: string,
    viewerRole: "CUSTOMER" | "STAFF" | "ADMIN",
    viewerUserId: string,
    cursor?: string,
    limit = 30,
  ) {
    const conversation = await this.prisma.orderConversation.findUnique({
      where: { orderId },
    });
    if (!conversation) {
      return {
        conversation_id: null,
        is_closed: false,
        messages: [],
        next_cursor: null,
      };
    }

    const take = Math.min(limit, 100);
    const isStaff = viewerRole !== "CUSTOMER";

    const messages = await this.prisma.orderMessage.findMany({
      where: {
        conversationId: conversation.id,
        ...(isStaff ? {} : { visibility: "BOTH" }),
      },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = messages.length > take;
    const page = hasMore ? messages.slice(0, take) : messages;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    const latestMessage = page[0] ?? null;
    if (latestMessage) {
      await this.advanceReadCursor(orderId, viewerUserId, viewerRole, latestMessage.id);
    }

    return {
      conversation_id: conversation.id,
      is_closed: conversation.closedAt !== null,
      messages: page.map((m) =>
        serializeMessage(m as unknown as Record<string, unknown>),
      ),
      next_cursor: nextCursor,
    };
  }

  async sendMessage(
    orderId: string,
    senderUserId: string,
    senderSurface: SenderSurface,
    messageBody: string,
    visibility: "BOTH" | "STAFF_ONLY" = "BOTH",
  ) {
    if (senderSurface === "CUSTOMER" && visibility === "STAFF_ONLY") {
      throw new ForbiddenException("Customers cannot send STAFF_ONLY messages");
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (TERMINAL_ORDER_STATUSES.has(order.status)) {
      throw new ConflictException(
        "This order has reached a terminal status. Please open a support ticket for further help.",
      );
    }

    const rateKey = `ratelimit:chat:${orderId}:${senderUserId}`;
    const rl = await this.rateLimiter.check(
      rateKey,
      CHAT_MESSAGE_RATE_LIMIT,
      CHAT_MESSAGE_RATE_WINDOW_MS,
    );
    if (!rl.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil((rl.resetAtMs - Date.now()) / 1000));
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: `Too many messages. Try again in ${retryAfterSec}s.`,
          retry_after_seconds: retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const conversation = await this.prisma.orderConversation.upsert({
      where: { orderId },
      update: {},
      create: { orderId },
    });

    if (conversation.closedAt) {
      throw new ConflictException("Conversation is closed");
    }

    const message = await this.prisma.orderMessage.create({
      data: {
        conversationId: conversation.id,
        orderId,
        senderUserId,
        senderSurface,
        messageBody,
        visibility,
      },
    });

    this.realtime.emitChatEvent(orderId, "chat.message", {
      order_id: orderId,
      message_id: message.id,
      sender_surface: senderSurface,
      visibility,
    });

    return serializeMessage(message as unknown as Record<string, unknown>);
  }

  /**
   * Batch unread-count lookup for the orders list badge. "Unread" for a
   * customer means messages from the other side (STAFF/system) visible to
   * BOTH sides whose createdAt > lastReadAt. Staff see CUSTOMER-authored
   * messages only. Orders without a conversation or without any matching
   * messages return 0.
   */
  async getUnreadCountsForOrders(
    orderIds: string[],
    role: "CUSTOMER" | "STAFF" | "ADMIN",
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (orderIds.length === 0) return result;
    const readerSide = this.deriveReaderSide(role);
    const isCustomer = readerSide === "CUSTOMER";

    const [conversations, readStates] = await Promise.all([
      this.prisma.orderConversation.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true, orderId: true },
      }),
      this.prisma.chatSideReadState.findMany({
        where: { orderId: { in: orderIds }, readerSide },
        select: { orderId: true, lastReadAt: true },
      }),
    ]);
    const readStateByOrder = new Map(readStates.map((r) => [r.orderId, r]));

    const counts = await Promise.all(
      conversations.map(async (conv) => {
        const rs = readStateByOrder.get(conv.orderId);
        const count = await this.prisma.orderMessage.count({
          where: {
            conversationId: conv.id,
            senderSurface: isCustomer ? { not: "CUSTOMER" } : "CUSTOMER",
            ...(isCustomer ? { visibility: "BOTH" } : {}),
            ...(rs?.lastReadAt ? { createdAt: { gt: rs.lastReadAt } } : {}),
          },
        });
        return [conv.orderId, count] as const;
      }),
    );
    for (const [orderId, count] of counts) {
      result.set(orderId, count);
    }
    return result;
  }

  async markRead(
    orderId: string,
    userId: string,
    role: "CUSTOMER" | "STAFF" | "ADMIN",
  ) {
    const conversation = await this.prisma.orderConversation.findUnique({
      where: { orderId },
    });
    if (!conversation) {
      throw new NotFoundException("No conversation found for this order");
    }

    const latestMessage = await this.prisma.orderMessage.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (!latestMessage) {
      return { order_id: orderId, side: this.deriveReaderSide(role), last_read_at: null };
    }

    return this.advanceReadCursor(orderId, userId, role, latestMessage.id);
  }

  /**
   * Close the order conversation. Called when an order transitions to a
   * terminal status. Idempotent — safe to call if already closed or if
   * no conversation exists.
   */
  async closeConversation(orderId: string): Promise<void> {
    const conversation = await this.prisma.orderConversation.findUnique({
      where: { orderId },
    });
    if (!conversation || conversation.closedAt) return;

    await this.prisma.orderConversation.update({
      where: { id: conversation.id },
      data: { closedAt: new Date() },
    });
  }

  private async advanceReadCursor(
    orderId: string,
    userId: string,
    role: "CUSTOMER" | "STAFF" | "ADMIN",
    messageId: string,
  ) {
    const readerSide = this.deriveReaderSide(role);
    const now = new Date();

    const existing = await this.prisma.chatSideReadState.findUnique({
      where: { orderId_readerSide: { orderId, readerSide } },
      select: { lastReadMessageId: true },
    });
    const cursorMoved = existing?.lastReadMessageId !== messageId;

    const sideState = await this.prisma.chatSideReadState.upsert({
      where: { orderId_readerSide: { orderId, readerSide } },
      update: { lastReadMessageId: messageId, lastReadAt: now },
      create: { orderId, readerSide, lastReadMessageId: messageId, lastReadAt: now },
    });

    await this.prisma.chatReadState.upsert({
      where: { orderId_userId: { orderId, userId } },
      update: { lastReadMessageId: messageId, lastReadAt: now },
      create: { orderId, userId, lastReadMessageId: messageId, lastReadAt: now },
    });

    if (cursorMoved) {
      this.realtime.emitChatEvent(orderId, "chat.read", {
        order_id: orderId,
        side: readerSide,
        last_read_message_id: messageId,
      });
    }

    return {
      order_id: sideState.orderId,
      side: sideState.readerSide,
      last_read_message_id: sideState.lastReadMessageId,
      last_read_at: sideState.lastReadAt,
    };
  }
}
