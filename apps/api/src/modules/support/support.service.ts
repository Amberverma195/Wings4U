import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import type { Prisma, TicketResolutionType, TicketStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RATE_LIMITS } from "../rate-limit/rate-limit.policies";
import { RateLimiterService, rateLimitKeyPart } from "../rate-limit/rate-limit.service";
import { adminContextSelect, type AdminTicketContext, actorSelect, eventSelect, messageSelect, resolutionSelect,
  ticketSelect, orderContextSelect, serializeActor, serializeAdminContext, serializeOrderContext, serializeCreator } from "./support.selects";

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

function assertTicketLocationScope(
  ticket: { locationId: string },
  locationId: string,
) {
  if (ticket.locationId !== locationId) {
    throw new ForbiddenException("You do not have access to this ticket");
  }
}

type SupportDb = PrismaService | Prisma.TransactionClient;

export const SUPPORT_TICKET_EXISTS = "SUPPORT_TICKET_EXISTS";
const MESSAGE_LIMIT_MESSAGE = "You're sending messages too quickly.";

/** Oldest first, so historical duplicates resolve to the original ticket. */
function findCustomerOrderTicket(db: SupportDb, orderId: string, customerUserId: string) {
  return db.supportTicket.findFirst({
    where: { orderId, customerUserId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, status: true, createdAt: true },
  });
}

/**
 * Serializes every writer that can attach a ticket to this order (customer
 * creation and admin linking) without a schema change: both take this row
 * lock before checking for an existing ticket, and hold it until commit.
 */
async function lockOrderForTicket(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id::text AS id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
}

function existingCustomerTicketError(existing: { id: string; status: string; createdAt: Date }) {
  return new ConflictException({
    code: SUPPORT_TICKET_EXISTS,
    message:
      "You already have a support ticket for this order. Please add any new details to your existing ticket.",
    detail: { ticket_id: existing.id, status: existing.status, created_at: existing.createdAt },
  });
}

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async createTicket(params: {
    locationId: string;
    customerUserId: string | null;
    ticketType: string;
    subject: string;
    description: string;
    createdSource: string;
    orderId?: string;
    priority?: string;
    createdByUserId?: string | null;
    /**
     * Only the automated overdue-delivery alert sets this: it is a staff
     * signal with its own per-order dedupe, not a customer conversation.
     */
    allowAdditionalOrderTicket?: boolean;
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

    const singleTicketOrder =
      params.orderId && params.customerUserId && !params.allowAdditionalOrderTicket
        ? { orderId: params.orderId, customerUserId: params.customerUserId }
        : null;
    // Cheap pre-check so a duplicate attempt is answered without spending the
    // customer's creation budget; the locked re-check below is authoritative.
    if (singleTicketOrder) {
      const existing = await findCustomerOrderTicket(
        this.prisma, singleTicketOrder.orderId, singleTicketOrder.customerUserId);
      if (existing) throw existingCustomerTicketError(existing);
    }
    if (params.createdSource === "CUSTOMER_APP" && params.customerUserId) {
      await this.enforceCustomerTicketLimit(params.customerUserId, Boolean(params.orderId));
    }

    const ticket = await this.prisma.$transaction(async (tx) => {
      if (singleTicketOrder) {
        await lockOrderForTicket(tx, singleTicketOrder.orderId);
        const existing = await findCustomerOrderTicket(
          tx, singleTicketOrder.orderId, singleTicketOrder.customerUserId);
        if (existing) throw existingCustomerTicketError(existing);
      }
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
          performedByUserId: params.createdByUserId !== undefined ? params.createdByUserId
            : params.createdSource === "CUSTOMER_APP" ? params.customerUserId : null,
          eventType: "CREATED",
          toValue: "OPEN",
          payloadJson: { priority, created_source: params.createdSource },
        },
      });

      return created;
    });

    return serializeTicketSummary(ticket as unknown as Record<string, unknown>);
  }

  private async enforceCustomerTicketLimit(customerUserId: string, orderLinked: boolean): Promise<void> {
    const user = rateLimitKeyPart(`user:${customerUserId}`);
    if (orderLinked) {
      await this.rateLimiter.enforce(
        `rl:support:ticket:order:${user}`,
        RATE_LIMITS.supportOrderTicketCustomer,
        "You've opened several order support tickets recently.",
      );
      return;
    }
    await this.rateLimiter.enforce(
      `rl:support:ticket:general:${user}`,
      RATE_LIMITS.supportGeneralTicketCustomer,
      "You've reached the daily limit for new general support tickets. You can still reply in your existing tickets.",
    );
  }

  async getTicket(
    ticketId: string,
    viewerRole?: string,
    viewerUserId?: string,
    locationId?: string,
  ) {
    const expanded = viewerRole === "ADMIN" && Boolean(locationId);
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: {
        ...ticketSelect,
        ...(expanded ? adminContextSelect : {}),
        messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: {
          ...messageSelect, ...(expanded ? { author: { select: actorSelect } } : {}),
        } },
        events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: {
          ...eventSelect, ...(expanded ? { performedBy: { select: actorSelect } } : {}),
        } },
        resolutions: { orderBy: { createdAt: "asc" }, select: resolutionSelect },
      },
    });

    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }

    if (locationId) {
      assertTicketLocationScope(ticket, locationId);
    }

    // Customer ownership check: customers can only view their own tickets
    if (
      viewerRole === "CUSTOMER" &&
      (!viewerUserId || ticket.customerUserId !== viewerUserId)
    ) {
      throw new ForbiddenException("You do not have access to this ticket");
    }

    const base = serializeTicketSummary(
      ticket as unknown as Record<string, unknown>,
    );

    const isStaffOrAdmin = viewerRole === "STAFF" || viewerRole === "ADMIN";
    const messages = ticket.messages
      .filter((m) => isStaffOrAdmin || !m.isInternalNote)
      .map((m) => ({ ...serializeMessage(m as unknown as Record<string, unknown>),
        ...(expanded ? { author: serializeActor(m.author, m.authorUserId) } : {}),
      }));

    const events = ticket.events
      .filter((e) => {
        if (isStaffOrAdmin) return true;
        if (e.eventType === "ORDER_LINKED") return false;
        if (e.eventType === "MESSAGE_ADDED" && (e.payloadJson as Record<string, unknown>)?.is_internal_note === true) {
          return false;
        }
        return true;
      })
      .map((e) => ({ ...serializeEvent(e as unknown as Record<string, unknown>),
        ...(expanded ? { performed_by: serializeActor(e.performedBy, e.performedByUserId) } : {}),
      }));

    const created = ticket.events.find(e => e.eventType === "CREATED");

    return {
      ...base,
      ...(expanded ? {
        // Prisma cannot infer nested payloads from a conditional relation select.
        ...serializeAdminContext(ticket as unknown as AdminTicketContext),
        created_by: serializeCreator(created, ticket.createdSource),
      } : {}),
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
    adminContext?: boolean;
  }) {
    if (params.adminContext && !params.locationId) throw new ForbiddenException("An authorized restaurant location is required");
    const take = Math.max(1, Math.min(params.limit ?? 20, 50));
    const where: Prisma.SupportTicketWhereInput = {};

    if (params.locationId) where.locationId = params.locationId;
    if (params.customerUserId) where.customerUserId = params.customerUserId;
    if (params.status) where.status = params.status as TicketStatus;

    if (params.cursor) {
      const anchor = await this.prisma.supportTicket.findFirst({ where: { ...where, id: params.cursor }, select: { id: true } });
      if (!anchor) throw new BadRequestException("Invalid ticket cursor for this customer and restaurant");
    }

    const tickets = await this.prisma.supportTicket.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        ...ticketSelect,
        ...(params.adminContext ? adminContextSelect : {}),
        ...(params.adminContext ? { events: { where: { eventType: "CREATED" },
          orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], take: 1,
          select: { performedByUserId: true, performedBy: { select: actorSelect } },
        } } : {}),
        messages: {
          where: { isInternalNote: false },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: messageSelect,
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
          ...(params.adminContext ? { ...serializeAdminContext(t as unknown as AdminTicketContext),
            created_by: serializeCreator(t.events[0], t.createdSource),
          } : {}),
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
    locationId?: string,
  ) {
    if (isInternalNote && senderRole !== "ADMIN" && senderRole !== "STAFF") {
      throw new ForbiddenException("Only staff can add internal notes");
    }
    const isCustomer = senderRole === "CUSTOMER";
    const sender = rateLimitKeyPart(`user:${senderUserId}`);
    await this.rateLimiter.enforce(
      `rl:support:message:${isCustomer ? "customer" : "staff"}:hourly:${sender}`,
      isCustomer ? RATE_LIMITS.supportMessageCustomerHourly : RATE_LIMITS.supportMessageStaffHourly,
      MESSAGE_LIMIT_MESSAGE,
    );
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }

    if (locationId) {
      assertTicketLocationScope(ticket, locationId);
    }

    // Customer ownership check: customers can only message their own tickets
    if (
      senderRole === "CUSTOMER" &&
      ticket.customerUserId !== senderUserId
    ) {
      throw new ForbiddenException("You do not have access to this ticket");
    }

    await this.rateLimiter.enforce(
      `rl:support:message:${isCustomer ? "customer" : "staff"}:ticket:${rateLimitKeyPart(`${senderUserId}:${ticketId}`)}`,
      isCustomer ? RATE_LIMITS.supportMessageCustomerTicket : RATE_LIMITS.supportMessageStaffTicket,
      MESSAGE_LIMIT_MESSAGE,
    );

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
    locationId?: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }

    if (locationId) {
      assertTicketLocationScope(ticket, locationId);
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
    locationId?: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }

    if (locationId) {
      assertTicketLocationScope(ticket, locationId);
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

  private async ticketForOrderLink(ticketId: string, locationId: string) {
    if (!locationId) throw new ForbiddenException("An authorized restaurant location is required");
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId }, select: ticketSelect });
    if (!ticket) throw new NotFoundException("Support ticket not found");
    assertTicketLocationScope(ticket, locationId);
    if (ticket.orderId) throw new ConflictException("This ticket already has a linked order");
    if (!ticket.customerUserId) throw new ConflictException("A customer account is required to link an order");
    return ticket;
  }

  async getEligibleOrders(ticketId: string, locationId: string, cursor?: string) {
    const ticket = await this.ticketForOrderLink(ticketId, locationId);
    const where = { locationId, customerUserId: ticket.customerUserId };
    if (cursor && !await this.prisma.order.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) {
      throw new BadRequestException("Invalid eligible-order cursor");
    }
    const rows = await this.prisma.order.findMany({ where, select: orderContextSelect,
      orderBy: [{ placedAt: "desc" }, { id: "desc" }], take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return { orders: rows.slice(0, 20).map(serializeOrderContext), next_cursor: rows.length > 20 ? rows[19].id : null };
  }

  async linkOrder(ticketId: string, orderId: string, actorUserId: string, locationId: string) {
    const ticket = await this.ticketForOrderLink(ticketId, locationId);
    return this.prisma.$transaction(async tx => {
      await lockOrderForTicket(tx, orderId);
      const order = await tx.order.findFirst({ where: { id: orderId, locationId, customerUserId: ticket.customerUserId },
        select: orderContextSelect });
      if (!order) throw new ForbiddenException("Choose an order belonging to this customer and restaurant");
      const existing = await findCustomerOrderTicket(tx, orderId, ticket.customerUserId!);
      if (existing) {
        throw new ConflictException({
          code: SUPPORT_TICKET_EXISTS,
          message: "This customer already has a support ticket for this order. Continue in that ticket instead.",
          detail: { ticket_id: existing.id, status: existing.status },
        });
      }
      // Conditional write prevents two admins from overwriting an association concurrently.
      const updated = await tx.supportTicket.updateMany({
        where: { id: ticketId, locationId, customerUserId: ticket.customerUserId, orderId: null },
        data: { orderId, updatedAt: new Date() },
      });
      if (updated.count !== 1) throw new ConflictException("Ticket changed; reload before linking an order");
      await tx.supportTicketEvent.create({ data: { ticketId, performedByUserId: actorUserId,
        eventType: "ORDER_LINKED", toValue: orderId, note: `Linked order #${order.orderNumber}`,
        payloadJson: { order_id: orderId, order_number: order.orderNumber.toString() },
      } });
      return { order: serializeOrderContext(order) };
    });
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

    const order = await this.prisma.order.findFirst({
      where: {
        id: ticket.orderId,
        locationId,
        customerUserId: ticket.customerUserId,
      },
      select: {
        ...orderContextSelect,
        acceptedAt: true, readyAt: true, completedAt: true, cancelledAt: true, paymentStatusSummary: true,
        itemSubtotalCents: true, itemDiscountTotalCents: true, orderDiscountTotalCents: true,
        taxCents: true, deliveryFeeCents: true, driverTipCents: true, customerOrderNotes: true, addressSnapshotJson: true,
        orderItems: {
          orderBy: { lineNo: "asc" },
          select: {
            id: true, productNameSnapshot: true, categoryNameSnapshot: true, quantity: true,
            unitPriceCents: true, lineTotalCents: true, specialInstructions: true,
            modifiers: { orderBy: { sortOrder: "asc" }, select: {
              modifierNameSnapshot: true, modifierGroupNameSnapshot: true, quantity: true, priceDeltaCents: true,
            } },
            flavours: { orderBy: { sortOrder: "asc" }, select: {
              flavourNameSnapshot: true, heatLevelSnapshot: true, placement: true,
            } },
          },
        },
        payments: { orderBy: { createdAt: "asc" }, select: {
          id: true, paymentMethod: true, transactionStatus: true, signedAmountCents: true, createdAt: true,
        } },
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
