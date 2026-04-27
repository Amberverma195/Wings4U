import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { ChatService } from "../chat/chat.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { WalletsService } from "../wallets/wallets.service";
import { RefundService } from "../refunds/refund.service";

const TERMINAL_ORDER_STATUSES = new Set([
  "CANCELLED",
  "DELIVERED",
  "PICKED_UP",
  "NO_SHOW_PICKUP",
  "NO_SHOW_DELIVERY",
  "NO_PIN_DELIVERY",
]);

/**
 * Prisma maps `Order.orderNumber` as BigInt. Express's `res.json()` calls
 * `JSON.stringify`, which throws `TypeError: Do not know how to serialize a
 * BigInt`. We coerce to Number here (order numbers fit comfortably in a JS
 * number range) so the envelope filter doesn't swallow it as INTERNAL_ERROR.
 */
function coerceOrderNumber(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return null;
}

function serializeCancellationRequest(c: Record<string, unknown>) {
  return {
    id: c.id,
    order_id: c.orderId,
    location_id: c.locationId,
    requested_by_user_id: c.requestedByUserId,
    request_source: c.requestSource,
    reason_text: c.reasonText,
    status: c.status,
    reviewed_by_admin_user_id: c.reviewedByAdminUserId ?? null,
    reviewed_at: c.reviewedAt ?? null,
    decision_note: c.decisionNote ?? null,
    chat_thread_id: c.chatThreadId ?? null,
    created_at: c.createdAt,
    order: c.order
      ? {
          id: (c.order as Record<string, unknown>).id,
          order_number: coerceOrderNumber(
            (c.order as Record<string, unknown>).orderNumber,
          ),
          status: (c.order as Record<string, unknown>).status,
          customer_name_snapshot:
            (c.order as Record<string, unknown>).customerNameSnapshot ?? null,
          final_payable_cents:
            (c.order as Record<string, unknown>).finalPayableCents ?? 0,
        }
      : null,
  };
}

function serializeRefundRequest(r: Record<string, unknown>) {
  return {
    id: r.id,
    order_id: r.orderId,
    location_id: r.locationId,
    requested_by_user_id: r.requestedByUserId,
    amount_cents: r.amountCents,
    refund_method: r.refundMethod,
    status: r.status,
    reason_text: r.reasonText,
    approved_by_user_id: r.approvedByUserId ?? null,
    approved_at: r.approvedAt ?? null,
    issued_at: r.issuedAt ?? null,
    rejected_at: r.rejectedAt ?? null,
    created_at: r.createdAt,
    order: r.order
      ? {
          id: (r.order as Record<string, unknown>).id,
          order_number: coerceOrderNumber(
            (r.order as Record<string, unknown>).orderNumber,
          ),
          status: (r.order as Record<string, unknown>).status,
          customer_name_snapshot:
            (r.order as Record<string, unknown>).customerNameSnapshot ?? null,
          final_payable_cents:
            (r.order as Record<string, unknown>).finalPayableCents ?? 0,
        }
      : null,
  };
}

function serializeAuditLog(a: Record<string, unknown>) {
  return {
    id: a.id,
    location_id: a.locationId,
    actor_user_id: a.actorUserId,
    actor_role_snapshot: a.actorRoleSnapshot,
    action_key: a.actionKey,
    entity_type: a.entityType,
    entity_id: a.entityId,
    reason_text: a.reasonText,
    payload_json: a.payloadJson,
    created_at: a.createdAt,
  };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly realtime: RealtimeGateway,
    private readonly walletsService: WalletsService,
    private readonly refundService: RefundService,
  ) {}

  async decideCancellation(
    cancellationRequestId: string,
    actorUserId: string,
    action: "APPROVE" | "DENY",
    adminNotes?: string,
    locationId?: string,
  ) {
    const request = await this.prisma.cancellationRequest.findUnique({
      where: { id: cancellationRequestId },
      include: { order: true },
    });
    if (!request) {
      throw new NotFoundException("Cancellation request not found");
    }
    if (request.status !== "PENDING") {
      throw new ConflictException(
        `Cancellation request is already "${request.status}"`,
      );
    }

    const now = new Date();
    const newStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";

    await this.prisma.cancellationRequest.update({
      where: { id: cancellationRequestId },
      data: {
        status: newStatus,
        reviewedByAdminUserId: actorUserId,
        reviewedAt: now,
        decisionNote: adminNotes,
      },
    });

    if (action === "APPROVE") {
      const order = request.order;
      const fromStatus = order.status;
      // PRD §12.3/§12.4: the order's cancellation_source is the *origin* of
      // the request (KDS_CANCEL_REQUEST or KDS_CHAT_REQUEST), not just "ADMIN".
      // ADMIN remains the label for admin-panel direct cancels (cancelOrder()).
      const orderCancellationSource =
        request.requestSource === "KDS_CHAT_REQUEST"
          ? "KDS_CHAT_REQUEST"
          : request.requestSource === "KDS_CANCEL_REQUEST"
            ? "KDS_CANCEL_REQUEST"
            : "ADMIN";

      await this.prisma.$transaction([
        this.prisma.order.update({
          where: { id: order.id },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancelledByUserId: actorUserId,
            cancellationSource: orderCancellationSource,
            cancellationReason: request.reasonText,
          },
        }),
        this.prisma.orderStatusEvent.create({
          data: {
            orderId: order.id,
            locationId: order.locationId,
            fromStatus: fromStatus as never,
            toStatus: "CANCELLED",
            eventType: "CANCELLATION_APPROVED",
            actorUserId,
            reasonText: request.reasonText,
          },
        }),
      ]);

      // PRD §12.6: auto-create PENDING refund request for the remaining paid balance.
      await this.refundService.createForCancelledOrder({
        orderId: order.id,
        locationId: order.locationId,
        initiatedByUserId: actorUserId,
        reasonText: `Auto: ${request.reasonText}`,
      });

      await this.chatService.closeConversation(order.id);
    }

    await this.createAuditLog({
      locationId: locationId ?? request.locationId,
      actorUserId,
      actionKey: `cancellation_request.${action.toLowerCase()}`,
      entityType: "CancellationRequest",
      entityId: cancellationRequestId,
      reasonText: adminNotes,
      payload: { order_id: request.orderId, decision: action },
    });

    const loc = locationId ?? request.locationId;
    this.realtime.emitAdminEvent(loc, "cancellation.decided", {
      order_id: request.orderId,
      request_id: cancellationRequestId,
      decision: action === "APPROVE" ? "APPROVED" : "REJECTED",
    });
    if (action === "APPROVE") {
      this.realtime.emitOrderEvent(loc, request.orderId, "order.cancelled", {
        order_id: request.orderId,
        from_status: request.order.status,
        to_status: "CANCELLED",
        changed_by_user_id: actorUserId,
      });
    }

    return {
      id: request.id,
      order_id: request.orderId,
      status: newStatus,
      reviewed_by_admin_user_id: actorUserId,
      reviewed_at: now,
      decision_note: adminNotes ?? null,
    };
  }

  async decideRefund(
    refundRequestId: string,
    actorUserId: string,
    action: "APPROVE" | "REJECT",
    refundMethod?: string,
    adminNotes?: string,
  ) {
    const refund = await this.prisma.refundRequest.findUnique({
      where: { id: refundRequestId },
      include: { order: true },
    });
    if (!refund) {
      throw new NotFoundException("Refund request not found");
    }
    if (refund.status !== "PENDING") {
      throw new ConflictException(
        `Refund request is already "${refund.status}"`,
      );
    }

    let result: Record<string, unknown>;

    if (action === "APPROVE") {
      const method = (refundMethod ?? "STORE_CREDIT") as never;
      const issued = await this.refundService.approveAndIssue({
        refundRequestId,
        approvedByUserId: actorUserId,
        refundMethod: method,
      });
      result = issued as unknown as Record<string, unknown>;
    } else {
      const rejected = await this.refundService.rejectRefund({
        refundRequestId,
        rejectedByUserId: actorUserId,
        adminNotes: adminNotes ?? "Rejected by admin",
      });
      result = rejected as unknown as Record<string, unknown>;
    }

    await this.createAuditLog({
      locationId: refund.locationId,
      actorUserId,
      actionKey: `refund_request.${action.toLowerCase()}`,
      entityType: "RefundRequest",
      entityId: refundRequestId,
      reasonText: adminNotes,
      payload: {
        order_id: refund.orderId,
        amount_cents: refund.amountCents,
        decision: action,
        refund_method: refundMethod,
      },
    });

    return {
      id: result.id,
      order_id: result.orderId,
      status: result.status,
      amount_cents: result.amountCents,
      refund_method: result.refundMethod,
    };
  }

  async cancelOrder(
    orderId: string,
    actorUserId: string,
    reason: string,
    locationId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException("Order not found");
    }
    if (TERMINAL_ORDER_STATUSES.has(order.status)) {
      throw new UnprocessableEntityException({
        message: `Order is already in terminal status "${order.status}"`,
        field: "status",
      });
    }

    const now = new Date();
    const fromStatus = order.status;

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          cancelledByUserId: actorUserId,
          cancellationSource: "ADMIN",
          cancellationReason: reason,
        },
      }),
      this.prisma.orderStatusEvent.create({
        data: {
          orderId,
          locationId: order.locationId,
          fromStatus: fromStatus as never,
          toStatus: "CANCELLED",
          eventType: "ADMIN_FORCE_CANCEL",
          actorUserId,
          reasonText: reason,
        },
      }),
    ]);

    await this.createAuditLog({
      locationId,
      actorUserId,
      actionKey: "order.admin_cancel",
      entityType: "Order",
      entityId: orderId,
      reasonText: reason,
      payload: { from_status: fromStatus },
    });

    // PRD §12.6: auto-create PENDING refund request for the remaining paid balance.
    await this.refundService.createForCancelledOrder({
      orderId,
      locationId,
      initiatedByUserId: actorUserId,
      reasonText: `Auto: ${reason}`,
    });

    await this.chatService.closeConversation(orderId);

    this.realtime.emitOrderEvent(locationId, orderId, "order.cancelled", {
      order_id: orderId,
      from_status: fromStatus,
      to_status: "CANCELLED",
      changed_by_user_id: actorUserId,
    });

    return {
      id: orderId,
      status: "CANCELLED",
      cancelled_at: now,
      cancellation_reason: reason,
    };
  }

  async creditCustomer(
    customerUserId: string,
    actorUserId: string,
    amountCents: number,
    reason: string,
  ) {
    const wallet = await this.walletsService.credit({
      userId: customerUserId,
      amountCents,
      reason,
      entryType: "ADMIN_CREDIT",
      createdByUserId: actorUserId,
    });

    await this.createAuditLog({
      actorUserId,
      actionKey: "customer.credit",
      entityType: "CustomerWallet",
      entityId: customerUserId,
      reasonText: reason,
      payload: { amount_cents: amountCents },
    });

    return {
      customer_user_id: customerUserId,
      balance_cents: wallet.balanceCents,
      credited_amount_cents: amountCents,
    };
  }

  async getDailyTaxReport(locationId: string, date: string) {
    const businessDate = new Date(date + "T00:00:00.000Z");

    const existing = await this.prisma.dailyTaxSummary.findUnique({
      where: {
        businessDate_locationId: { businessDate, locationId },
      },
    });

    if (existing) {
      return {
        business_date: existing.businessDate,
        location_id: existing.locationId,
        orders_count: existing.ordersCount,
        taxable_sales_cents: existing.taxableSalesCents,
        tax_collected_cents: existing.taxCollectedCents,
        refund_tax_reversed_cents: existing.refundTaxReversedCents,
        net_tax_cents: existing.netTaxCents,
        created_at: existing.createdAt,
        updated_at: existing.updatedAt,
      };
    }

    const dayStart = businessDate;
    const dayEnd = new Date(date + "T23:59:59.999Z");

    const orders = await this.prisma.order.findMany({
      where: {
        locationId,
        placedAt: { gte: dayStart, lte: dayEnd },
        status: { notIn: ["CANCELLED"] },
      },
      select: {
        taxCents: true,
        taxableSubtotalCents: true,
        finalPayableCents: true,
      },
    });

    const ordersCount = orders.length;
    const taxableSalesCents = orders.reduce(
      (sum, o) => sum + (o.taxableSubtotalCents ?? 0),
      0,
    );
    const taxCollectedCents = orders.reduce(
      (sum, o) => sum + (o.taxCents ?? 0),
      0,
    );

    const refunds = await this.prisma.refundRequest.findMany({
      where: {
        locationId,
        status: "ISSUED",
        issuedAt: { gte: dayStart, lte: dayEnd },
      },
      include: { order: { select: { taxCents: true, finalPayableCents: true } } },
    });

    let refundTaxReversedCents = 0;
    for (const r of refunds) {
      if (r.order.finalPayableCents > 0 && r.order.taxCents) {
        const taxPortion = Math.round(
          (r.amountCents / r.order.finalPayableCents) * r.order.taxCents,
        );
        refundTaxReversedCents += taxPortion;
      }
    }

    const netTaxCents = taxCollectedCents - refundTaxReversedCents;

    const summary = await this.prisma.dailyTaxSummary.upsert({
      where: {
        businessDate_locationId: { businessDate, locationId },
      },
      update: {
        ordersCount,
        taxableSalesCents,
        taxCollectedCents,
        refundTaxReversedCents,
        netTaxCents,
      },
      create: {
        businessDate,
        locationId,
        ordersCount,
        taxableSalesCents,
        taxCollectedCents,
        refundTaxReversedCents,
        netTaxCents,
      },
    });

    return {
      business_date: summary.businessDate,
      location_id: summary.locationId,
      orders_count: summary.ordersCount,
      taxable_sales_cents: summary.taxableSalesCents,
      tax_collected_cents: summary.taxCollectedCents,
      refund_tax_reversed_cents: summary.refundTaxReversedCents,
      net_tax_cents: summary.netTaxCents,
      created_at: summary.createdAt,
      updated_at: summary.updatedAt,
    };
  }

  async listCancellationRequests(
    locationId: string,
    params: { status?: string; cursor?: string; limit?: number },
  ) {
    const take = Math.min(params.limit ?? 20, 100);
    const status = params.status ?? "PENDING";

    const rows = await this.prisma.cancellationRequest.findMany({
      where: { locationId, status },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            customerNameSnapshot: true,
            finalPayableCents: true,
          },
        },
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      items: page.map((r) =>
        serializeCancellationRequest(r as unknown as Record<string, unknown>),
      ),
      next_cursor: nextCursor,
    };
  }

  async listRefundRequests(
    locationId: string,
    params: { status?: string; cursor?: string; limit?: number },
  ) {
    const take = Math.min(params.limit ?? 20, 100);
    const status = params.status ?? "PENDING";

    const rows = await this.prisma.refundRequest.findMany({
      where: { locationId, status: status as never },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            customerNameSnapshot: true,
            finalPayableCents: true,
          },
        },
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      items: page.map((r) =>
        serializeRefundRequest(r as unknown as Record<string, unknown>),
      ),
      next_cursor: nextCursor,
    };
  }

  async getAuditLog(locationId: string, cursor?: string, limit = 20) {
    const take = Math.min(limit, 100);

    const logs = await this.prisma.adminAuditLog.findMany({
      where: { locationId },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = logs.length > take;
    const page = hasMore ? logs.slice(0, take) : logs;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      logs: page.map((a) =>
        serializeAuditLog(a as unknown as Record<string, unknown>),
      ),
      next_cursor: nextCursor,
    };
  }

  private async createAuditLog(params: {
    locationId?: string;
    actorUserId: string;
    actionKey: string;
    entityType: string;
    entityId?: string;
    reasonText?: string;
    payload?: Record<string, unknown>;
  }) {
    return this.prisma.adminAuditLog.create({
      data: {
        locationId: params.locationId,
        actorUserId: params.actorUserId,
        actorRoleSnapshot: "ADMIN",
        actionKey: params.actionKey,
        entityType: params.entityType,
        entityId: params.entityId,
        reasonText: params.reasonText,
        payloadJson: (params.payload as object) ?? {},
      },
    });
  }

  async globalSearch(locationId: string, query: string) {
    const qStr = `%${query}%`;
    const qNum = parseInt(query, 10);
    
    const [orders, tickets, customers] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          locationId,
          OR: [
            ...(isNaN(qNum) ? [] : [{ orderNumber: qNum }]),
            { customerNameSnapshot: { contains: query, mode: "insensitive" } },
            { customerPhoneSnapshot: { contains: query, mode: "insensitive" } },
            { customerEmailSnapshot: { contains: query, mode: "insensitive" } },
          ],
        },
        take: 10,
        orderBy: { placedAt: "desc" },
        select: { id: true, orderNumber: true, status: true, customerNameSnapshot: true, finalPayableCents: true, placedAt: true }
      }),
      this.prisma.supportTicket.findMany({
        where: {
          locationId,
          OR: [
            { subject: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } }
          ],
        },
        take: 10,
        orderBy: { createdAt: "desc" },
        select: { id: true, subject: true, status: true, ticketType: true }
      }),
      this.prisma.user.findMany({
        where: {
          identities: {
            some: {
              OR: [
                { emailNormalized: { contains: query, mode: "insensitive" } },
                { phoneE164: { contains: query, mode: "insensitive" } } // This is simple, doesn't handle all +1 formats without normalization, but okay for global search
              ]
            }
          }
        },
        take: 10,
        select: { id: true, displayName: true, firstName: true, lastName: true }
      })
    ]);

    return {
      query,
      orders: orders.map((o) => ({
        id: o.id,
        order_number: coerceOrderNumber(o.orderNumber),
        status: o.status,
        customer_name_snapshot: o.customerNameSnapshot ?? null,
        final_payable_cents: o.finalPayableCents ?? 0,
        placed_at: o.placedAt,
      })),
      tickets: tickets.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        ticket_type: t.ticketType,
      })),
      customers: customers.map((c) => ({
        id: c.id,
        display_name: c.displayName ?? null,
        first_name: c.firstName ?? null,
        last_name: c.lastName ?? null,
      })),
    };
  }
}
