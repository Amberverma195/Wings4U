import {
  Injectable,
  NotFoundException,
  ConflictException,
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

  async getTicket(ticketId: string, viewerRole?: string) {
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

    const base = serializeTicketSummary(
      ticket as unknown as Record<string, unknown>,
    );

    const isStaffOrAdmin = viewerRole === "STAFF" || viewerRole === "ADMIN";
    const messages = ticket.messages
      .filter((m) => isStaffOrAdmin || !m.isInternalNote)
      .map((m) => serializeMessage(m as unknown as Record<string, unknown>));

    return {
      ...base,
      description: ticket.description,
      messages,
      events: ticket.events.map((e) =>
        serializeEvent(e as unknown as Record<string, unknown>),
      ),
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
    });

    const hasMore = tickets.length > take;
    const page = hasMore ? tickets.slice(0, take) : tickets;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      tickets: page.map((t) =>
        serializeTicketSummary(t as unknown as Record<string, unknown>),
      ),
      next_cursor: nextCursor,
    };
  }

  async addMessage(
    ticketId: string,
    senderUserId: string,
    body: string,
    isInternalNote = false,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
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
}
