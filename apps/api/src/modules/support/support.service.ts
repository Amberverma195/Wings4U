import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import type { Prisma, TicketResolutionType, TicketStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

function serializeTicketSummary(t: Record<string, unknown>) {
  return {
    id: t.id,
    location_id: t.locationId,
    order_id: t.orderId ?? null,
    customer_user_id: t.customerUserId,
    assigned_admin_user_id: t.assignedAdminUserId ?? null,
    ticket_type: t.ticketType,
    status: t.status,
    priority: t.priority,
    created_source: t.createdSource,
    resolution_type: t.resolutionType ?? null,
    subject: t.subject,
    resolved_by_user_id: t.resolvedByUserId ?? null,
    resolved_at: t.resolvedAt ?? null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

function serializeMessage(m: Record<string, unknown>) {
  return {
    id: m.id,
    ticket_id: m.supportTicketId,
    author_user_id: m.authorUserId,
    message_body: m.messageBody,
    is_internal_note: m.isInternalNote ?? false,
    created_at: m.createdAt,
  };
}

function serializeEvent(e: Record<string, unknown>) {
  return {
    id: e.id,
    ticket_id: e.ticketId,
    performed_by_user_id: e.performedByUserId,
    event_type: e.eventType,
    from_value: e.fromValue ?? null,
    to_value: e.toValue ?? null,
    note: e.note ?? null,
    payload_json: e.payloadJson ?? {},
    created_at: e.createdAt,
  };
}

function serializeResolution(r: Record<string, unknown>) {
  return {
    id: r.id,
    ticket_id: r.ticketId,
    created_by_user_id: r.createdByUserId,
    resolution_type: r.resolutionType,
    refund_request_id: r.refundRequestId ?? null,
    replacement_order_id: r.replacementOrderId ?? null,
    credit_amount_cents: r.creditAmountCents ?? null,
    note: r.note ?? null,
    created_at: r.createdAt,
  };
}

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(params: {
    locationId: string;
    customerUserId: string;
    ticketType: string;
    subject: string;
    description: string;
    createdSource: string;
    orderId?: string;
    priority?: string;
  }) {
    const priority = params.priority ?? "NORMAL";

    if (params.orderId) {
      const linkedOrder = await this.prisma.order.findUnique({
        where: { id: params.orderId },
        select: { id: true, locationId: true, customerUserId: true },
      });

      if (!linkedOrder) {
        throw new NotFoundException("Linked order not found");
      }

      if (
        linkedOrder.locationId !== params.locationId ||
        linkedOrder.customerUserId !== params.customerUserId
      ) {
        throw new ForbiddenException("You do not have access to this order");
      }
    }

    const ticket = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          locationId: params.locationId,
          customerUserId: params.customerUserId,
          orderId: params.orderId ?? null,
          ticketType: params.ticketType,
          subject: params.subject,
          description: params.description,
          status: "OPEN",
          createdSource: params.createdSource,
          priority,
        },
      });

      await tx.supportTicketEvent.create({
        data: {
          ticketId: created.id,
          performedByUserId: params.customerUserId,
          eventType: "CREATED",
          toValue: "OPEN",
          payloadJson: { priority, created_source: params.createdSource },
        },
      });

      return created;
    });

    return serializeTicketSummary(ticket as unknown as Record<string, unknown>);
  }

  async getTicket(ticketId: string, viewerRole?: string, viewerUserId?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        events: { orderBy: { createdAt: "asc" } },
        resolutions: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }

    // Customer ownership check: customers can only view their own tickets
    if (
      viewerRole === "CUSTOMER" &&
      viewerUserId &&
      ticket.customerUserId !== viewerUserId
    ) {
      throw new ForbiddenException("You do not have access to this ticket");
    }

    const base = serializeTicketSummary(
      ticket as unknown as Record<string, unknown>,
    );

    const isStaffOrAdmin = viewerRole === "STAFF" || viewerRole === "ADMIN";
    const messages = ticket.messages
      .filter((m) => isStaffOrAdmin || !m.isInternalNote)
      .map((m) => serializeMessage(m as unknown as Record<string, unknown>));

    const events = ticket.events
      .filter((e) => {
        if (isStaffOrAdmin) return true;
        if (e.eventType === "MESSAGE_ADDED" && (e.payloadJson as Record<string, unknown>)?.is_internal_note === true) {
          return false;
        }
        return true;
      })
      .map((e) => serializeEvent(e as unknown as Record<string, unknown>));

    return {
      ...base,
      description: ticket.description,
      messages,
      events,
      resolutions: ticket.resolutions.map((r) =>
        serializeResolution(r as unknown as Record<string, unknown>),
      ),
    };
  }

  async listTickets(params: {
    locationId?: string;
    customerUserId?: string;
    status?: string;
    cursor?: string;
    limit?: number;
  }) {
    const take = Math.min(params.limit ?? 20, 50);
    const where: Prisma.SupportTicketWhereInput = {};

    if (params.locationId) where.locationId = params.locationId;
    if (params.customerUserId) where.customerUserId = params.customerUserId;
    if (params.status) where.status = params.status as TicketStatus;

    const tickets = await this.prisma.supportTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      include: {
        messages: {
          where: { isInternalNote: false },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    const hasMore = tickets.length > take;
    const page = hasMore ? tickets.slice(0, take) : tickets;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      tickets: page.map((t) => {
        const base = serializeTicketSummary(t as unknown as Record<string, unknown>);
        const latestMsg = t.messages[0];
        return {
          ...base,
          latest_public_message: latestMsg
            ? {
                message_body:
                  latestMsg.messageBody.length > 120
                    ? latestMsg.messageBody.slice(0, 120) + "…"
                    : latestMsg.messageBody,
                author_user_id: latestMsg.authorUserId,
                created_at: latestMsg.createdAt,
              }
            : null,
        };
      }),
      next_cursor: nextCursor,
    };
  }

  async addMessage(
    ticketId: string,
    senderUserId: string,
    body: string,
    isInternalNote = false,
    senderRole?: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }

    // Customer ownership check: customers can only message their own tickets
    if (
      senderRole === "CUSTOMER" &&
      ticket.customerUserId !== senderUserId
    ) {
      throw new ForbiddenException("You do not have access to this ticket");
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.supportTicketMessage.create({
        data: {
          supportTicketId: ticketId,
          authorUserId: senderUserId,
          messageBody: body,
          isInternalNote,
        },
      }),
      this.prisma.supportTicketEvent.create({
        data: {
          ticketId,
          performedByUserId: senderUserId,
          eventType: "MESSAGE_ADDED",
          payloadJson: { is_internal_note: isInternalNote },
        },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { updatedAt: new Date() },
      }),
    ]);

    return serializeMessage(message as unknown as Record<string, unknown>);
  }

  async updateStatus(
    ticketId: string,
    actorUserId: string,
    newStatus: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }

    const oldStatus = ticket.status;
    if (oldStatus === newStatus) {
      throw new ConflictException(`Ticket is already "${newStatus}"`);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: newStatus as TicketStatus,
          updatedAt: new Date(),
        },
      }),
      this.prisma.supportTicketEvent.create({
        data: {
          ticketId,
          performedByUserId: actorUserId,
          eventType: "STATUS_CHANGED",
          fromValue: oldStatus,
          toValue: newStatus,
        },
      }),
    ]);

    return serializeTicketSummary(updated as unknown as Record<string, unknown>);
  }

  async resolve(
    ticketId: string,
    resolvedByUserId: string,
    resolutionType: string,
    notes: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }

    if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
      throw new ConflictException(
        `Ticket is already "${ticket.status}"`,
      );
    }

    const now = new Date();
    const typedResolution = resolutionType as TicketResolutionType;

    const [updated] = await this.prisma.$transaction([
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: "RESOLVED",
          resolutionType: typedResolution,
          resolvedByUserId,
          resolvedAt: now,
          updatedAt: now,
        },
      }),
      this.prisma.supportTicketResolution.create({
        data: {
          ticketId,
          resolutionType: typedResolution,
          createdByUserId: resolvedByUserId,
          note: notes,
        },
      }),
      this.prisma.supportTicketEvent.create({
        data: {
          ticketId,
          performedByUserId: resolvedByUserId,
          eventType: "RESOLVED",
          toValue: resolutionType,
          payloadJson: { note: notes },
        },
      }),
    ]);

    return serializeTicketSummary(updated as unknown as Record<string, unknown>);
  }

  /**
   * Fetch linked order details for a support ticket.
   * Used by the admin "Order Details" modal.
   */
  async getTicketOrderDetails(ticketId: string, locationId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        orderId: true,
        customerUserId: true,
        locationId: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }

    if (ticket.locationId !== locationId) {
      throw new ForbiddenException("Ticket belongs to a different location");
    }

    if (!ticket.orderId) {
      throw new NotFoundException("This ticket has no linked order");
    }

    if (!ticket.customerUserId) {
      throw new ForbiddenException("Ticket is not linked to a customer");
    }

    const order = await this.prisma.order.findFirst({
      where: {
        id: ticket.orderId,
        locationId,
        customerUserId: ticket.customerUserId,
      },
      include: {
        orderItems: {
          orderBy: { lineNo: "asc" },
          include: {
            modifiers: { orderBy: { sortOrder: "asc" } },
            flavours: { orderBy: { sortOrder: "asc" } },
          },
        },
        payments: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!order) {
      throw new ForbiddenException("Linked order does not match this ticket");
    }

    return {
      ticket_id: ticket.id,
      customer: {
        user_id: order.customerUserId,
        name: order.customerNameSnapshot,
        phone: order.customerPhoneSnapshot,
        email: order.customerEmailSnapshot ?? null,
      },
      order: {
        id: order.id,
        order_number: order.orderNumber.toString(),
        status: order.status,
        fulfillment_type: order.fulfillmentType,
        placed_at: order.placedAt,
        accepted_at: order.acceptedAt,
        ready_at: order.readyAt,
        completed_at: order.completedAt,
        cancelled_at: order.cancelledAt,
        payment_status: order.paymentStatusSummary,
        item_subtotal_cents: order.itemSubtotalCents,
        discount_total_cents:
          order.itemDiscountTotalCents + order.orderDiscountTotalCents,
        tax_cents: order.taxCents,
        delivery_fee_cents: order.deliveryFeeCents,
        driver_tip_cents: order.driverTipCents,
        final_payable_cents: order.finalPayableCents,
        customer_order_notes: order.customerOrderNotes,
        address_snapshot: order.addressSnapshotJson,
      },
      payments: order.payments.map((p) => ({
        id: p.id,
        method: p.paymentMethod,
        status: p.transactionStatus,
        amount_cents: p.signedAmountCents,
        created_at: p.createdAt,
      })),
      items: order.orderItems.map((item) => ({
        id: item.id,
        product_name: item.productNameSnapshot,
        category_name: item.categoryNameSnapshot,
        quantity: item.quantity,
        unit_price_cents: item.unitPriceCents,
        line_total_cents: item.lineTotalCents,
        special_instructions: item.specialInstructions,
        modifiers: item.modifiers.map((mod) => ({
          name: mod.modifierNameSnapshot,
          group_name: mod.modifierGroupNameSnapshot,
          quantity: mod.quantity,
          price_delta_cents: mod.priceDeltaCents,
        })),
        flavours: item.flavours.map((f) => ({
          name: f.flavourNameSnapshot,
          heat_level: f.heatLevelSnapshot,
          placement: f.placement,
        })),
      })),
    };
  }
}
