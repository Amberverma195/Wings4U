import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { OrderStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { ChatService } from "../chat/chat.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { documentFuturePrepaymentPolicy } from "../customers/no-show-policy";
import { RefundService } from "../refunds/refund.service";
import { RewardsService } from "../rewards/rewards.service";
import {
  DeliveryPinService,
  PIN_MAX_FAILED_ATTEMPTS,
} from "./delivery-pin.service";

const DEFAULT_KDS_STATUSES: OrderStatus[] = [
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY",
];

const TERMINAL_STATUSES = new Set<OrderStatus>([
  "DELIVERED",
  "PICKED_UP",
  "CANCELLED",
  "NO_SHOW_PICKUP",
  "NO_SHOW_DELIVERY",
  // PRD §7.8.5 — forced completion after 3 failed PIN attempts. Treated
  // like DELIVERED for lifecycle purposes (chat closes, no further KDS
  // transitions), but surfaced distinctly to ops and the customer.
  "NO_PIN_DELIVERY",
]);

const ALLOWED_TRANSITIONS: Record<string, OrderStatus[]> = {
  ACCEPTED: ["PREPARING"],
  PREPARING: ["READY"],
  READY: ["PICKED_UP", "OUT_FOR_DELIVERY", "NO_SHOW_PICKUP"],
  // NO_PIN_DELIVERY is reachable from OUT_FOR_DELIVERY but only via the
  // dedicated /complete-delivery-without-pin endpoint after the PIN record
  // has been locked — it is deliberately not part of /status transitions
  // so generic PATCH calls can't sidestep the PIN challenge.
  OUT_FOR_DELIVERY: ["DELIVERED", "NO_SHOW_DELIVERY"],
};

const TIMESTAMP_FIELDS: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: "acceptedAt",
  READY: "readyAt",
  CANCELLED: "cancelledAt",
  OUT_FOR_DELIVERY: "deliveryStartedAt",
  DELIVERED: "deliveryCompletedAt",
  NO_PIN_DELIVERY: "deliveryCompletedAt",
};

function serializeKdsOrder(
  order: Record<string, unknown>,
  kdsAutoAcceptSeconds: number | null = null,
  customerStats: {
    orderCount: number;
    noShowPickupCount: number;
    noShowDeliveryCount: number;
  } | null = null,
) {
  const o = order as Record<string, unknown> & {
    orderNumber: bigint;
    orderItems?: Record<string, unknown>[];
    cancellationRequests?: Record<string, unknown>[];
  };

  const items = (o.orderItems ?? []).map((item: Record<string, unknown>) => ({
    id: item.id,
    order_id: item.orderId,
    menu_item_id: item.menuItemId,
    line_no: item.lineNo,
    product_name_snapshot: item.productNameSnapshot,
    category_name_snapshot: item.categoryNameSnapshot,
    builder_type: item.builderType,
    quantity: item.quantity,
    unit_price_cents: item.unitPriceCents,
    line_total_cents: item.lineTotalCents,
    special_instructions: item.specialInstructions,
    modifiers: ((item.modifiers as Record<string, unknown>[]) ?? []).map(
      (mod: Record<string, unknown>) => ({
        id: mod.id,
        modifier_group_name_snapshot: mod.modifierGroupNameSnapshot,
        modifier_name_snapshot: mod.modifierNameSnapshot,
        modifier_kind: mod.modifierKind,
        quantity: mod.quantity,
        price_delta_cents: mod.priceDeltaCents,
        sort_order: mod.sortOrder,
      }),
    ),
    flavours: ((item.flavours as Record<string, unknown>[]) ?? []).map(
      (fl: Record<string, unknown>) => ({
        id: fl.id,
        flavour_name_snapshot: fl.flavourNameSnapshot,
        heat_level_snapshot: fl.heatLevelSnapshot,
        slot_no: fl.slotNo,
        flavour_role: fl.flavourRole,
        placement: fl.placement,
        sort_order: fl.sortOrder,
      }),
    ),
  }));

  const pendingCancelRequest = (o.cancellationRequests ?? []).find(
    (cr: Record<string, unknown>) => cr.status === "PENDING",
  );

  // Finding 5: count PENDING add-item change requests for KDS badge.
  const pendingChangeRequestCount = ((o as Record<string, unknown>).changeRequests as unknown[] ?? []).length;

  return {
    id: o.id,
    location_id: o.locationId,
    customer_user_id: o.customerUserId,
    order_number: Number(o.orderNumber),
    order_source: o.orderSource,
    fulfillment_type: o.fulfillmentType,
    status: o.status,
    placed_at: o.placedAt,
    accepted_at: o.acceptedAt,
    ready_at: o.readyAt,
    completed_at: o.completedAt,
    cancelled_at: o.cancelledAt,
    assigned_driver_user_id: o.assignedDriverUserId,
    estimated_travel_minutes: o.estimatedTravelMinutes,
    estimated_arrival_at: o.estimatedArrivalAt,
    delivery_started_at: o.deliveryStartedAt,
    delivery_completed_at: o.deliveryCompletedAt,
    customer_name_snapshot: o.customerNameSnapshot,
    customer_phone_snapshot: o.customerPhoneSnapshot,
    customer_order_count: customerStats?.orderCount ?? null,
    customer_no_show_pickup_count: customerStats?.noShowPickupCount ?? null,
    customer_no_show_delivery_count: customerStats?.noShowDeliveryCount ?? null,
    customer_order_notes: o.customerOrderNotes,
    item_subtotal_cents: o.itemSubtotalCents,
    item_discount_total_cents: o.itemDiscountTotalCents,
    order_discount_total_cents: o.orderDiscountTotalCents,
    delivery_fee_cents: o.deliveryFeeCents,
    driver_tip_cents: o.driverTipCents,
    tax_cents: o.taxCents,
    wallet_applied_cents: o.walletAppliedCents,
    final_payable_cents: o.finalPayableCents,
    payment_status_summary: o.paymentStatusSummary,
    estimated_ready_at: o.estimatedReadyAt,
    estimated_window_min_minutes: o.estimatedWindowMinMinutes,
    estimated_window_max_minutes: o.estimatedWindowMaxMinutes,
    kds_auto_accept_seconds: kdsAutoAcceptSeconds,
    requires_manual_review: o.requiresManualReview ?? false,
    pending_change_request_count: pendingChangeRequestCount,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
    items,
    pending_cancel_request: pendingCancelRequest
      ? {
          id: (pendingCancelRequest as Record<string, unknown>).id,
          requested_by_user_id: (pendingCancelRequest as Record<string, unknown>).requestedByUserId,
          request_source: (pendingCancelRequest as Record<string, unknown>).requestSource,
          reason_text: (pendingCancelRequest as Record<string, unknown>).reasonText,
          created_at: (pendingCancelRequest as Record<string, unknown>).createdAt,
        }
      : null,
  };
}

type KdsCustomerOrderStats = {
  orderCount: number;
  noShowPickupCount: number;
  noShowDeliveryCount: number;
};

type KdsCustomerStatsTarget = {
  key: string;
  customerUserId: string | null;
  rawPhones: string[];
  phoneKeys: string[];
};

function createEmptyCustomerStats(): KdsCustomerOrderStats {
  return {
    orderCount: 0,
    noShowPickupCount: 0,
    noShowDeliveryCount: 0,
  };
}

function normalizeStatsPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits.length >= 7 ? digits : null;
}

function getKdsOrderRawPhones(order: Record<string, unknown>): string[] {
  return [order.customerPhoneSnapshot, order.deliveryPhoneSnapshot]
    .filter((phone): phone is string => typeof phone === "string" && phone.trim().length > 0)
    .map((phone) => phone.trim());
}

function getKdsOrderPhoneKeys(order: Record<string, unknown>): string[] {
  return Array.from(
    new Set(
      getKdsOrderRawPhones(order)
        .map(normalizeStatsPhone)
        .filter((phone): phone is string => Boolean(phone)),
    ),
  );
}

function makeKdsCustomerStatsTarget(order: {
  id: string;
  customerUserId: string | null;
  customerPhoneSnapshot?: string | null;
  deliveryPhoneSnapshot?: string | null;
}): KdsCustomerStatsTarget {
  const rawOrder = order as unknown as Record<string, unknown>;
  return {
    key: order.id,
    customerUserId: order.customerUserId ?? null,
    rawPhones: getKdsOrderRawPhones(rawOrder),
    phoneKeys: getKdsOrderPhoneKeys(rawOrder),
  };
}

function incrementCustomerStats(stats: KdsCustomerOrderStats, status: OrderStatus) {
  stats.orderCount += 1;
  if (status === "NO_SHOW_PICKUP") {
    stats.noShowPickupCount += 1;
  }
  if (status === "NO_SHOW_DELIVERY") {
    stats.noShowDeliveryCount += 1;
  }
}

@Injectable()
export class KdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly realtime: RealtimeGateway,
    private readonly deliveryPin: DeliveryPinService,
    private readonly refundService: RefundService,
    private readonly rewardsService: RewardsService,
  ) {}

  async getKdsOrders(locationId: string, statuses?: string[]) {
    const filterStatuses =
      statuses && statuses.length > 0
        ? (statuses as OrderStatus[])
        : DEFAULT_KDS_STATUSES;
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: { kdsAutoAcceptSeconds: true },
    });

    const orders = await this.prisma.order.findMany({
      where: {
        locationId,
        status: { in: filterStatuses },
      },
      include: {
        orderItems: {
          include: { modifiers: true, flavours: true },
          orderBy: { lineNo: "asc" },
        },
        cancellationRequests: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        // Finding 5: pending add-item change requests for KDS badge
        changeRequests: {
          where: { status: "PENDING" },
          select: { id: true },
        },
      },
      orderBy: { placedAt: "asc" },
    });

    const orderIds = orders.map((o) => o.id);
    const unreadCounts = await this.chatService.getUnreadCountsForOrders(
      orderIds,
      "STAFF",
    );
    const customerStats = await this.getCustomerOrderStats(
      locationId,
      orders.map((order) => makeKdsCustomerStatsTarget(order)),
    );

    return orders.map((o) => {
      const serialized = serializeKdsOrder(
        o as unknown as Record<string, unknown>,
        settings?.kdsAutoAcceptSeconds ?? null,
        customerStats.get(o.id) ?? null,
      );
      return {
        ...serialized,
        unread_customer_chat_count: unreadCounts.get(o.id) ?? 0,
      };
    });
  }

  async getKdsOrder(locationId: string, orderId: string) {
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: { kdsAutoAcceptSeconds: true },
    });

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, locationId },
      include: {
        orderItems: {
          include: { modifiers: true, flavours: true },
          orderBy: { lineNo: "asc" },
        },
        cancellationRequests: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        changeRequests: {
          where: { status: "PENDING" },
          select: { id: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    const unreadCounts = await this.chatService.getUnreadCountsForOrders(
      [order.id],
      "STAFF",
    );
    const customerStats = await this.getCustomerOrderStats(locationId, [
      makeKdsCustomerStatsTarget(order),
    ]);

    return {
      ...serializeKdsOrder(
        order as unknown as Record<string, unknown>,
        settings?.kdsAutoAcceptSeconds ?? null,
        customerStats.get(order.id) ?? null,
      ),
      unread_customer_chat_count: unreadCounts.get(order.id) ?? 0,
    };
  }

  private async getCustomerOrderStats(
    locationId: string,
    targets: KdsCustomerStatsTarget[],
  ): Promise<Map<string, KdsCustomerOrderStats>> {
    const stats = new Map<string, KdsCustomerOrderStats>();
    for (const target of targets) {
      stats.set(target.key, createEmptyCustomerStats());
    }

    const uniqueCustomerIds = Array.from(
      new Set(
        targets
          .map((target) => target.customerUserId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const hasPhoneTargets = targets.some((target) => target.phoneKeys.length > 0);

    const orFilters: Array<Record<string, unknown>> = [];
    if (uniqueCustomerIds.length > 0) {
      orFilters.push({ customerUserId: { in: uniqueCustomerIds } });
    }
    if (hasPhoneTargets) {
      // Phone snapshots are not normalized consistently across old/new orders
      // (`+1519...`, `+1 (519)...`, `(519)...`). Fetch phone-bearing rows and
      // do normalized digit matching below so the customer counter survives
      // formatting differences.
      orFilters.push({ customerPhoneSnapshot: { not: "" } });
      orFilters.push({ deliveryPhoneSnapshot: { not: null } });
    }

    if (orFilters.length === 0) return stats;

    const matchingOrders = await this.prisma.order.findMany({
      where: {
        locationId,
        OR: orFilters,
      },
      select: {
        id: true,
        customerUserId: true,
        customerPhoneSnapshot: true,
        deliveryPhoneSnapshot: true,
        status: true,
      },
    });

    for (const target of targets) {
      const current = stats.get(target.key) ?? createEmptyCustomerStats();
      const seenOrderIds = new Set<string>();

      for (const order of matchingOrders) {
        if (seenOrderIds.has(order.id)) continue;

        const idMatches =
          Boolean(target.customerUserId) &&
          order.customerUserId === target.customerUserId;
        const orderPhoneKeys = getKdsOrderPhoneKeys(
          order as unknown as Record<string, unknown>,
        );
        const phoneMatches =
          target.phoneKeys.length > 0 &&
          orderPhoneKeys.some((phone) => target.phoneKeys.includes(phone));

        if (!idMatches && !phoneMatches) continue;
        seenOrderIds.add(order.id);
        incrementCustomerStats(current, order.status);
      }

      stats.set(target.key, current);
    }

    return stats;
  }

  async getOrderHistory(
    locationId: string,
    startDate?: string,
    endDate?: string,
    status?: string,
    limit = 50,
    cursor?: string,
  ) {
    const take = Number.isFinite(limit)
      ? Math.min(Math.max(Math.trunc(limit), 1), 100)
      : 50;
    const where: any = { locationId };

    if (startDate || endDate) {
      where.placedAt = {};
      if (startDate) {
        where.placedAt.gte = new Date(startDate);
      }
      if (endDate) {
        // Assume endDate is inclusive of that day by extending to end of day if it's just a date string,
        // but since we will pass ISO strings from client, we can just use lte.
        where.placedAt.lte = new Date(endDate);
      }
    }

    if (status) {
      where.status = status as OrderStatus;
    }

    const orders = await this.prisma.order.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ placedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        orderNumber: true,
        status: true,
        fulfillmentType: true,
        customerNameSnapshot: true,
        customerPhoneSnapshot: true,
        deliveryPhoneSnapshot: true,
        placedAt: true,
        finalPayableCents: true,
        customer: {
          select: {
            identities: {
              where: { phoneE164: { not: null } },
              orderBy: { isPrimary: "desc" },
              select: { phoneE164: true },
            },
          },
        },
      },
    });

    let nextCursor: string | undefined;
    if (orders.length > take) {
      orders.pop();
      nextCursor = orders[orders.length - 1]?.id;
    }

    return {
      items: orders.map((o) => {
        const identityPhone = o.customer.identities.find(
          (identity) => identity.phoneE164,
        )?.phoneE164;

        return {
          id: o.id,
          order_number: Number(o.orderNumber),
          status: o.status,
          fulfillment_type: o.fulfillmentType,
          customer_name_snapshot: o.customerNameSnapshot,
          customer_phone_snapshot: o.customerPhoneSnapshot,
          delivery_phone_snapshot: o.deliveryPhoneSnapshot,
          phone_fallback:
            o.customerPhoneSnapshot || o.deliveryPhoneSnapshot || identityPhone || "",
          placed_at: o.placedAt,
          final_payable_cents: o.finalPayableCents,
        };
      }),
      next_cursor: nextCursor,
    };
  }

  async acceptOrder(
    orderId: string,
    actorUserId: string | null,
    locationId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }
    if (order.status !== "PLACED") {
      throw new UnprocessableEntityException({
        message: `Order cannot be accepted in status "${order.status}". Must be PLACED.`,
        field: "status",
      });
    }

    const now = new Date();
    // PRD §7.2: accept lands on PREPARING automatically.
    // Two status events are recorded (PLACED→ACCEPTED, ACCEPTED→PREPARING)
    // so the audit trail shows both hops, but the order's persisted status
    // is PREPARING — the ticket is "in kitchen" immediately.
    const [updated] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        // PRD §11.1B: a human accept clears the manual-review flag regardless
        // of how it was raised (heartbeat lapse).
        data: {
          status: "PREPARING",
          acceptedAt: now,
          requiresManualReview: false,
        },
        include: {
          orderItems: {
            include: { modifiers: true, flavours: true },
            orderBy: { lineNo: "asc" },
          },
          cancellationRequests: {
            where: { status: "PENDING" },
            take: 1,
          },
        },
      }),
      this.prisma.orderStatusEvent.create({
        data: {
          orderId,
          locationId,
          fromStatus: "PLACED",
          toStatus: "ACCEPTED",
          eventType: "KDS_ACCEPT",
          actorUserId,
        },
      }),
      this.prisma.orderStatusEvent.create({
        data: {
          orderId,
          locationId,
          fromStatus: "ACCEPTED",
          toStatus: "PREPARING",
          eventType: "KDS_AUTO_PREPARING",
          actorUserId,
        },
      }),
    ]);

    // Emit accepted first (customer detail page listens), then status_changed
    // for the ACCEPTED→PREPARING hop.
    this.realtime.emitOrderEvent(locationId, orderId, "order.accepted", {
      order_id: orderId,
      from_status: "PLACED",
      to_status: "ACCEPTED",
      changed_by_user_id: actorUserId,
    });
    this.realtime.emitOrderEvent(locationId, orderId, "order.status_changed", {
      order_id: orderId,
      from_status: "ACCEPTED",
      to_status: "PREPARING",
      changed_by_user_id: actorUserId,
    });

    return serializeKdsOrder(updated as unknown as Record<string, unknown>);
  }

  async updateOrderStatus(
    orderId: string,
    actorUserId: string | null,
    locationId: string,
    newStatus: string,
    reason?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }

    const currentStatus = order.status;

    if (TERMINAL_STATUSES.has(currentStatus)) {
      throw new UnprocessableEntityException({
        message: `Order is in terminal status "${currentStatus}" and cannot be transitioned`,
        field: "status",
      });
    }

    if (newStatus === "CANCELLED") {
      if (!reason) {
        throw new BadRequestException(
          "Reason is required when cancelling an order",
        );
      }
    } else {
      const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
      if (!allowed.includes(newStatus as OrderStatus)) {
        throw new UnprocessableEntityException({
          message: `Transition from "${currentStatus}" to "${newStatus}" is not allowed`,
          field: "status",
        });
      }

      if (
        newStatus === "PICKED_UP" &&
        order.fulfillmentType !== "PICKUP"
      ) {
        throw new UnprocessableEntityException({
          message: "PICKED_UP is only valid for PICKUP orders",
          field: "status",
        });
      }
      if (
        newStatus === "OUT_FOR_DELIVERY" &&
        order.fulfillmentType !== "DELIVERY"
      ) {
        throw new UnprocessableEntityException({
          message: "OUT_FOR_DELIVERY is only valid for DELIVERY orders",
          field: "status",
        });
      }
      if (
        newStatus === "NO_SHOW_PICKUP" &&
        order.fulfillmentType !== "PICKUP"
      ) {
        throw new UnprocessableEntityException({
          message: "NO_SHOW_PICKUP is only valid for PICKUP orders",
          field: "status",
        });
      }
      if (
        newStatus === "NO_SHOW_DELIVERY" &&
        order.fulfillmentType !== "DELIVERY"
      ) {
        throw new UnprocessableEntityException({
          message: "NO_SHOW_DELIVERY is only valid for DELIVERY orders",
          field: "status",
        });
      }
    }

    const now = new Date();
    const updateData: Record<string, unknown> = {
      status: newStatus as OrderStatus,
    };

    const tsField = TIMESTAMP_FIELDS[newStatus as OrderStatus];
    if (tsField) {
      updateData[tsField] = now;
    }

    if (newStatus === "CANCELLED") {
      updateData.cancelledAt = now;
      updateData.cancelledByUserId = actorUserId;
      updateData.cancellationSource = "STAFF";
      updateData.cancellationReason = reason;
      // PRD §11.1B: reject/cancel by a human also resolves the manual-review flag.
      updateData.requiresManualReview = false;
    }

    if (newStatus === "DELIVERED") {
      updateData.deliveryCompletedByUserId = actorUserId;
    }

    const isNoShowTransition =
      newStatus === "NO_SHOW_PICKUP" || newStatus === "NO_SHOW_DELIVERY";
    const updated = await this.prisma.$transaction(async (tx) => {
      const nextOrder = await tx.order.update({
        where: { id: orderId },
        data: updateData,
        include: {
          orderItems: {
            include: { modifiers: true, flavours: true },
            orderBy: { lineNo: "asc" },
          },
          cancellationRequests: {
            where: { status: "PENDING" },
            take: 1,
          },
        },
      });

      await tx.orderStatusEvent.create({
        data: {
          orderId,
          locationId,
          fromStatus: currentStatus,
          toStatus: newStatus as OrderStatus,
          eventType: "KDS_STATUS_CHANGE",
          actorUserId,
          reasonText: reason,
        },
      });

      if (isNoShowTransition && order.customerUserId) {
        // Cash-only phase: track no-shows now; future card-prepay behavior stays documented only.
        documentFuturePrepaymentPolicy();
        await tx.customerProfile.upsert({
          where: { userId: order.customerUserId },
          update: { totalNoShows: { increment: 1 } },
          create: {
            userId: order.customerUserId,
            totalNoShows: 1,
          },
        });
      }

      // Wings-rewards: accrue stamps when the order completes successfully
      // (PICKED_UP for pickup, DELIVERED for delivery). Idempotent by
      // `orderId` in the ledger so replay is safe. This runs inside the
      // same transaction as the status write so status + stamps are atomic.
      if (newStatus === "PICKED_UP" || newStatus === "DELIVERED") {
        await this.rewardsService.accrueForOrderInTransaction(tx, orderId);
      }

      return nextOrder;
    });

    if (TERMINAL_STATUSES.has(newStatus as OrderStatus)) {
      await this.chatService.closeConversation(orderId);
    }

    const statusPayload = {
      order_id: orderId,
      from_status: currentStatus,
      to_status: newStatus,
      changed_by_user_id: actorUserId,
    };
    this.realtime.emitOrderEvent(
      locationId,
      orderId,
      newStatus === "CANCELLED" ? "order.cancelled" : "order.status_changed",
      statusPayload,
    );

    return serializeKdsOrder(updated as unknown as Record<string, unknown>);
  }

  // PRD §7.5: "KDS cancellation and refund initiation do not execute directly
  // — they create requests that Admin must approve." This covers post-accept
  // cancellations; pre-accept rejection remains a direct transition on PLACED.
  async requestCancellation(
    orderId: string,
    actorUserId: string | null,
    locationId: string,
    reason: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, locationId: true, status: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }
    if (TERMINAL_STATUSES.has(order.status as OrderStatus)) {
      throw new UnprocessableEntityException({
        message: `Order is in terminal status "${order.status}" and cannot be cancelled`,
        field: "status",
      });
    }
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException("Reason must be at least 5 characters");
    }

    const existing = await this.prisma.cancellationRequest.findFirst({
      where: { orderId, status: "PENDING" },
      select: { id: true },
    });
    if (existing) {
      throw new UnprocessableEntityException({
        message: "A pending cancellation request already exists for this order",
        field: "order_id",
      });
    }

    const created = await this.prisma.cancellationRequest.create({
      data: {
        orderId,
        locationId,
        requestedByUserId: actorUserId,
        requestSource: "KDS_CANCEL_REQUEST",
        reasonText: reason.trim(),
        status: "PENDING",
      },
    });

    this.realtime.emitOrderEvent(locationId, orderId, "cancellation.requested", {
      order_id: orderId,
      request_id: created.id,
      requested_by_user_id: actorUserId,
      reason_text: created.reasonText,
    });

    return {
      id: created.id,
      order_id: created.orderId,
      status: created.status,
      requested_by_user_id: created.requestedByUserId,
      reason_text: created.reasonText,
      created_at: created.createdAt,
    };
  }

  // PRD §12.3: chat-initiated cancellation. Same validation as
  // requestCancellation, but tagged with request_source = KDS_CHAT_REQUEST and
  // linked to the order_conversation so admin/analytics can trace the origin.
  async requestChatCancellation(
    orderId: string,
    actorUserId: string | null,
    locationId: string,
    reason: string,
    conversationId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, locationId: true, status: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }
    if (TERMINAL_STATUSES.has(order.status as OrderStatus)) {
      throw new UnprocessableEntityException({
        message: `Order is in terminal status "${order.status}" and cannot be cancelled`,
        field: "status",
      });
    }
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException("Reason must be at least 5 characters");
    }

    const conversation = await this.prisma.orderConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, orderId: true },
    });
    if (!conversation || conversation.orderId !== orderId) {
      throw new UnprocessableEntityException({
        message: "Conversation does not belong to this order",
        field: "conversation_id",
      });
    }

    const existing = await this.prisma.cancellationRequest.findFirst({
      where: { orderId, status: "PENDING" },
      select: { id: true },
    });
    if (existing) {
      throw new UnprocessableEntityException({
        message: "A pending cancellation request already exists for this order",
        field: "order_id",
      });
    }

    const created = await this.prisma.cancellationRequest.create({
      data: {
        orderId,
        locationId,
        requestedByUserId: actorUserId,
        requestSource: "KDS_CHAT_REQUEST",
        reasonText: reason.trim(),
        status: "PENDING",
        chatThreadId: conversation.id,
      },
    });

    this.realtime.emitOrderEvent(locationId, orderId, "cancellation.requested", {
      order_id: orderId,
      request_id: created.id,
      requested_by_user_id: actorUserId,
      reason_text: created.reasonText,
      chat_thread_id: conversation.id,
      source: "KDS_CHAT_REQUEST",
    });

    return {
      id: created.id,
      order_id: created.orderId,
      status: created.status,
      requested_by_user_id: created.requestedByUserId,
      reason_text: created.reasonText,
      chat_thread_id: created.chatThreadId,
      request_source: created.requestSource,
      created_at: created.createdAt,
    };
  }

  async handleCancelRequest(
    orderId: string,
    actorUserId: string | null,
    locationId: string,
    action: "APPROVE" | "DENY",
    adminNotes?: string,
  ) {
    const cancelRequest = await this.prisma.cancellationRequest.findFirst({
      where: { orderId, status: "PENDING" },
    });
    if (!cancelRequest) {
      throw new NotFoundException(
        "No pending cancellation request found for this order",
      );
    }
    if (cancelRequest.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Cancellation request does not belong to this location",
        field: "location_id",
      });
    }

    const now = new Date();
    let fromStatus: string | undefined;

    if (action === "APPROVE") {
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true },
      });
      fromStatus = order.status;

      await this.prisma.$transaction([
        this.prisma.cancellationRequest.update({
          where: { id: cancelRequest.id },
          data: {
            status: "APPROVED",
            reviewedByAdminUserId: actorUserId,
            reviewedAt: now,
            decisionNote: adminNotes,
          },
        }),
        this.prisma.order.update({
          where: { id: orderId },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancelledByUserId: actorUserId,
            cancellationSource:
              cancelRequest.requestSource === "KDS_CHAT_REQUEST"
                ? "KDS_CHAT_REQUEST"
                : "KDS_CANCEL_REQUEST",
            cancellationReason: cancelRequest.reasonText,
          },
        }),
        this.prisma.orderStatusEvent.create({
          data: {
            orderId,
            locationId,
            fromStatus: order.status,
            toStatus: "CANCELLED",
            eventType: "CANCEL_REQUEST_APPROVED",
            actorUserId,
            reasonText: cancelRequest.reasonText,
          },
        }),
      ]);

      // PRD §12.6: auto-create PENDING refund request if there's a paid balance.
      await this.refundService.createForCancelledOrder({
        orderId,
        locationId,
        initiatedByUserId: actorUserId,
        reasonText: `Auto: ${cancelRequest.reasonText}`,
      });

      await this.chatService.closeConversation(orderId);
    } else {
      await this.prisma.cancellationRequest.update({
        where: { id: cancelRequest.id },
        data: {
          status: "DENIED",
          reviewedByAdminUserId: actorUserId,
          reviewedAt: now,
          decisionNote: adminNotes,
        },
      });
    }

    this.realtime.emitOrderEvent(locationId, orderId, "cancellation.decided", {
      order_id: orderId,
      request_id: cancelRequest.id,
      decision: action === "APPROVE" ? "APPROVED" : "REJECTED",
    });
    if (action === "APPROVE") {
      this.realtime.emitOrderEvent(locationId, orderId, "order.cancelled", {
        order_id: orderId,
        from_status: fromStatus,
        to_status: "CANCELLED",
        changed_by_user_id: actorUserId,
      });
    }

    return {
      id: cancelRequest.id,
      order_id: cancelRequest.orderId,
      status: action === "APPROVE" ? "APPROVED" : "DENIED",
      reviewed_by_user_id: actorUserId,
      reviewed_at: now,
      decision_note: adminNotes ?? null,
    };
  }

  async assignDriver(
    orderId: string,
    driverUserId: string,
    actorUserId: string | null,
    locationId: string,
    busyOverride = false,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }

    const assignableStatuses: OrderStatus[] = [
      "ACCEPTED",
      "PREPARING",
      "READY",
    ];
    if (!assignableStatuses.includes(order.status)) {
      throw new UnprocessableEntityException({
        message: `Cannot assign driver when order is "${order.status}". Must be ACCEPTED, PREPARING, or READY.`,
        field: "status",
      });
    }

    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId: driverUserId },
    });
    if (!driver) throw new NotFoundException("Driver not found");
    if (!driver.isActive) {
      throw new UnprocessableEntityException({
        message: "Driver is not active",
        field: "driver_user_id",
      });
    }
    if (driver.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Driver does not belong to this location",
        field: "driver_user_id",
      });
    }
    if (
      driver.availabilityStatus !== "AVAILABLE" &&
      driver.availabilityStatus !== "ON_DELIVERY"
    ) {
      throw new UnprocessableEntityException({
        message: `Driver is currently "${driver.availabilityStatus}". Must be AVAILABLE or ON_DELIVERY.`,
        field: "driver_user_id",
      });
    }
    if (
      (driver.availabilityStatus === "ON_DELIVERY" || driver.isOnDelivery) &&
      !busyOverride
    ) {
      throw new ConflictException({
        message: "Driver is already on delivery. Confirm to assign anyway.",
        field: "driver_user_id",
        code: "DRIVER_ALREADY_ON_DELIVERY",
      });
    }

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { assignedDriverUserId: driverUserId },
        include: {
          orderItems: {
            include: { modifiers: true, flavours: true },
            orderBy: { lineNo: "asc" },
          },
          cancellationRequests: {
            where: { status: "PENDING" },
            take: 1,
          },
        },
      }),
      this.prisma.orderDriverEvent.create({
        data: {
          orderId,
          locationId,
          driverUserId,
          eventType: "ASSIGNED",
          actorUserId,
        },
      }),
      this.prisma.driverProfile.update({
        where: { userId: driverUserId },
        data: {
          isOnDelivery: true,
          availabilityStatus: "ON_DELIVERY",
          lastAssignedAt: now,
        },
      }),
    ]);

    this.realtime.emitOrderEvent(locationId, orderId, "order.driver_assigned", {
      order_id: orderId,
      driver_user_id: driverUserId,
    });
    this.realtime.emitDriverEvent(locationId, "driver.availability_changed", {
      driver_user_id: driverUserId,
      location_id: locationId,
      availability_status: "ON_DELIVERY",
    });

    return serializeKdsOrder(updated as unknown as Record<string, unknown>);
  }

  async startDelivery(
    orderId: string,
    actorUserId: string | null,
    locationId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }
    if (order.status !== "READY") {
      throw new UnprocessableEntityException({
        message: `Order must be READY to start delivery. Current status: "${order.status}"`,
        field: "status",
      });
    }
    if (!order.assignedDriverUserId) {
      throw new UnprocessableEntityException({
        message: "Order has no assigned driver",
        field: "assigned_driver_user_id",
      });
    }

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: "OUT_FOR_DELIVERY", deliveryStartedAt: now },
        include: {
          orderItems: {
            include: { modifiers: true, flavours: true },
            orderBy: { lineNo: "asc" },
          },
          cancellationRequests: {
            where: { status: "PENDING" },
            take: 1,
          },
        },
      }),
      this.prisma.orderStatusEvent.create({
        data: {
          orderId,
          locationId,
          fromStatus: "READY",
          toStatus: "OUT_FOR_DELIVERY",
          eventType: "DELIVERY_STARTED",
          actorUserId,
        },
      }),
      this.prisma.orderDriverEvent.create({
        data: {
          orderId,
          locationId,
          driverUserId: order.assignedDriverUserId,
          eventType: "DELIVERY_STARTED",
          actorUserId,
        },
      }),
    ]);

    // PRD §7.8.5: on OUT_FOR_DELIVERY, generate the customer's stable
    // 4-digit PIN from the last four digits of their phone snapshot.
    await this.deliveryPin.generateForOrder({
      orderId,
      locationId,
    });

    this.realtime.emitOrderEvent(locationId, orderId, "order.delivery_started", {
      order_id: orderId,
      driver_user_id: order.assignedDriverUserId,
    });

    return serializeKdsOrder(updated as unknown as Record<string, unknown>);
  }

  async completeDelivery(
    orderId: string,
    actorUserId: string | null,
    locationId: string,
    pin?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }
    if (order.status !== "OUT_FOR_DELIVERY") {
      throw new UnprocessableEntityException({
        message: `Order must be OUT_FOR_DELIVERY to complete delivery. Current status: "${order.status}"`,
        field: "status",
      });
    }
    if (!order.assignedDriverUserId) {
      throw new UnprocessableEntityException({
        message: "Order has no assigned driver",
        field: "assigned_driver_user_id",
      });
    }

    // PRD §7.8.5: PIN must be verified before delivery can be completed.
    // A prior BYPASSED / VERIFIED result counts; otherwise the driver must
    // submit the PIN the customer shows them. Admin bypass path is separate
    // (see DeliveryPinService.bypass + completeDeliveryWithBypass).
    const pinRecord = await this.prisma.deliveryPinVerification.findUnique({
      where: { orderId },
    });
    const alreadyCleared =
      pinRecord?.verificationResult === "VERIFIED" ||
      pinRecord?.verificationResult === "BYPASSED";
    if (!alreadyCleared) {
      if (!pin) {
        throw new UnprocessableEntityException({
          message: "Delivery PIN is required",
          field: "pin",
        });
      }
      const result = await this.deliveryPin.verify({
        orderId,
        locationId,
        actorUserId,
        driverUserId: order.assignedDriverUserId,
        pin,
      });
      if (!result.ok) {
        throw new UnprocessableEntityException({
          message: `PIN verification failed (${result.reason})`,
          field: "pin",
          reason: result.reason,
          remaining_attempts: result.remaining_attempts,
        });
      }
    }

    const now = new Date();
    const driverUserId = order.assignedDriverUserId;
    const remainingAssignments = await this.prisma.order.count({
      where: {
        assignedDriverUserId: driverUserId,
        id: { not: orderId },
        status: { in: ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] },
      },
    });
    const driverHasOtherActiveAssignments = remainingAssignments > 0;

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: "DELIVERED",
          deliveryCompletedAt: now,
          deliveryCompletedByUserId: actorUserId,
        },
        include: {
          orderItems: {
            include: { modifiers: true, flavours: true },
            orderBy: { lineNo: "asc" },
          },
          cancellationRequests: {
            where: { status: "PENDING" },
            take: 1,
          },
        },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId,
          locationId,
          fromStatus: "OUT_FOR_DELIVERY",
          toStatus: "DELIVERED",
          eventType: "DELIVERY_COMPLETED",
          actorUserId,
        },
      });
      await tx.orderDriverEvent.create({
        data: {
          orderId,
          locationId,
          driverUserId,
          eventType: "DELIVERY_COMPLETED",
          actorUserId,
        },
      });
      await tx.driverProfile.update({
        where: { userId: driverUserId },
        data: {
          isOnDelivery: driverHasOtherActiveAssignments,
          availabilityStatus: driverHasOtherActiveAssignments
            ? "ON_DELIVERY"
            : "AVAILABLE",
          lastDeliveryCompletedAt: now,
          totalDeliveriesCompleted: { increment: 1 },
        },
      });

      // Wings-rewards: accrue stamps atomically with the DELIVERED status
      // write. Idempotent by `orderId` in the ledger, so replay is safe
      // (e.g. if the transaction retries).
      await this.rewardsService.accrueForOrderInTransaction(tx, orderId);

      return nextOrder;
    });

    await this.chatService.closeConversation(orderId);

    this.realtime.emitOrderEvent(locationId, orderId, "order.status_changed", {
      order_id: orderId,
      from_status: "OUT_FOR_DELIVERY",
      to_status: "DELIVERED",
      changed_by_user_id: actorUserId,
    });
    this.realtime.emitDriverEvent(locationId, "driver.delivery_completed", {
      driver_user_id: driverUserId,
      order_id: orderId,
      location_id: locationId,
    });
    this.realtime.emitDriverEvent(locationId, "driver.availability_changed", {
      driver_user_id: driverUserId,
      location_id: locationId,
      availability_status: driverHasOtherActiveAssignments
        ? "ON_DELIVERY"
        : "AVAILABLE",
    });

    return serializeKdsOrder(updated as unknown as Record<string, unknown>);
  }

  /**
   * PRD §7.8.5 — forced "no PIN" delivery completion.
   *
   * After `PIN_MAX_FAILED_ATTEMPTS` wrong PIN submissions the PIN record is
   * LOCKED. At that point the driver can still hand the food over (e.g. the
   * customer lost their PIN email / is a known regular), but we need to
   * record that the delivery was closed *without* PIN verification so ops
   * can audit it later and the customer can see in their order timeline
   * that handoff was manual.
   *
   * Separate from `completeDelivery` so the state machine still refuses
   * generic NO_PIN_DELIVERY transitions via /status.
   */
  async completeDeliveryWithoutPin(
    orderId: string,
    actorUserId: string | null,
    locationId: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }
    if (order.status !== "OUT_FOR_DELIVERY") {
      throw new UnprocessableEntityException({
        message: `Order must be OUT_FOR_DELIVERY to force-complete delivery. Current status: "${order.status}"`,
        field: "status",
      });
    }
    if (!order.assignedDriverUserId) {
      throw new UnprocessableEntityException({
        message: "Order has no assigned driver",
        field: "assigned_driver_user_id",
      });
    }

    // Only allowed once the PIN challenge itself has been exhausted.
    const pinRecord = await this.prisma.deliveryPinVerification.findUnique({
      where: { orderId },
    });
    const alreadyCleared =
      pinRecord?.verificationResult === "VERIFIED" ||
      pinRecord?.verificationResult === "BYPASSED";
    if (alreadyCleared) {
      // If the PIN has already been verified/bypassed there's no reason to
      // take the NO_PIN_DELIVERY branch — fall through to DELIVERED so the
      // UI never gets a stuck state when a late click races a successful
      // PIN entry.
      return this.completeDelivery(orderId, actorUserId, locationId);
    }
    const locked =
      pinRecord?.verificationResult === "LOCKED" ||
      (pinRecord?.failedAttempts ?? 0) >= PIN_MAX_FAILED_ATTEMPTS;
    if (!locked) {
      throw new UnprocessableEntityException({
        message:
          "PIN challenge has not been exhausted yet — enter the PIN or keep trying before completing without PIN.",
        field: "pin",
      });
    }

    const now = new Date();
    const driverUserId = order.assignedDriverUserId;
    const remainingAssignments = await this.prisma.order.count({
      where: {
        assignedDriverUserId: driverUserId,
        id: { not: orderId },
        status: { in: ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] },
      },
    });
    const driverHasOtherActiveAssignments = remainingAssignments > 0;

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: "NO_PIN_DELIVERY",
          deliveryCompletedAt: now,
          deliveryCompletedByUserId: actorUserId,
        },
        include: {
          orderItems: {
            include: { modifiers: true, flavours: true },
            orderBy: { lineNo: "asc" },
          },
          cancellationRequests: { where: { status: "PENDING" }, take: 1 },
        },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId,
          locationId,
          fromStatus: "OUT_FOR_DELIVERY",
          toStatus: "NO_PIN_DELIVERY",
          eventType: "DELIVERY_COMPLETED_WITHOUT_PIN",
          actorUserId,
        },
      });
      await tx.orderDriverEvent.create({
        data: {
          orderId,
          locationId,
          driverUserId,
          eventType: "DELIVERY_COMPLETED_WITHOUT_PIN",
          actorUserId,
        },
      });
      await tx.driverProfile.update({
        where: { userId: driverUserId },
        data: {
          isOnDelivery: driverHasOtherActiveAssignments,
          availabilityStatus: driverHasOtherActiveAssignments
            ? "ON_DELIVERY"
            : "AVAILABLE",
          lastDeliveryCompletedAt: now,
          totalDeliveriesCompleted: { increment: 1 },
        },
      });
      // Audit trail — the locked PIN already logged PIN_FAIL_LOCK, but this
      // is the moment staff chose to complete anyway, which ops should see.
      await tx.adminAuditLog.create({
        data: {
          locationId,
          actorUserId,
          actorRoleSnapshot: "STAFF",
          actionKey: "delivery.complete_without_pin",
          entityType: "Order",
          entityId: orderId,
          payloadJson: {
            driver_user_id: driverUserId,
            failed_attempts: pinRecord?.failedAttempts ?? 0,
          },
        },
      });

      // Stamps still accrue — the customer paid for these wings, the PIN
      // failure is purely a handoff-authentication miss.
      await this.rewardsService.accrueForOrderInTransaction(tx, orderId);

      return nextOrder;
    });

    await this.chatService.closeConversation(orderId);

    this.realtime.emitOrderEvent(locationId, orderId, "order.status_changed", {
      order_id: orderId,
      from_status: "OUT_FOR_DELIVERY",
      to_status: "NO_PIN_DELIVERY",
      changed_by_user_id: actorUserId,
    });
    this.realtime.emitDriverEvent(locationId, "driver.delivery_completed", {
      driver_user_id: driverUserId,
      order_id: orderId,
      location_id: locationId,
      without_pin: true,
    });
    this.realtime.emitDriverEvent(locationId, "driver.availability_changed", {
      driver_user_id: driverUserId,
      location_id: locationId,
      availability_status: driverHasOtherActiveAssignments
        ? "ON_DELIVERY"
        : "AVAILABLE",
    });

    return serializeKdsOrder(updated as unknown as Record<string, unknown>);
  }

  async updateEta(
    orderId: string,
    actorUserId: string | null,
    estimatedMinutes: number,
    source: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException("Order not found");

    const now = new Date();
    const newEstimatedReadyAt = new Date(
      now.getTime() + estimatedMinutes * 60 * 1000,
    );

    const [, updated] = await this.prisma.$transaction([
      this.prisma.orderEtaEvent.create({
        data: {
          orderId,
          oldEstimatedReadyAt: order.estimatedReadyAt,
          newEstimatedReadyAt,
          changedByUserId: actorUserId,
          reason: source,
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          estimatedTravelMinutes: estimatedMinutes,
          estimatedArrivalAt: newEstimatedReadyAt,
        },
      }),
    ]);

    this.realtime.emitOrderEvent(
      order.locationId,
      orderId,
      "order.eta_updated",
      {
        order_id: orderId,
        estimated_travel_minutes: updated.estimatedTravelMinutes,
        estimated_arrival_at: updated.estimatedArrivalAt,
      },
    );

    return {
      id: updated.id,
      estimated_travel_minutes: updated.estimatedTravelMinutes,
      estimated_arrival_at: updated.estimatedArrivalAt,
    };
  }

  // PRD §11.1B: invoked by KdsAutoAcceptWorker after the configured
  // kds_auto_accept_seconds have elapsed and the KDS heartbeat is healthy.
  // Mirrors acceptOrder() but records SYSTEM actor-less audit events.
  async systemAutoAccept(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return false;
    if (order.status !== "PLACED") return false;

    const now = new Date();
    const systemPayload = {
      source: "SYSTEM",
      action_source: "SYSTEM_AUTO_ACCEPT",
    } as const;

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: "PREPARING",
          acceptedAt: now,
          requiresManualReview: false,
        },
      }),
      this.prisma.orderStatusEvent.create({
        data: {
          orderId,
          locationId: order.locationId,
          fromStatus: "PLACED",
          toStatus: "ACCEPTED",
          eventType: "SYSTEM_AUTO_ACCEPT",
          actorUserId: null,
          payloadJson: systemPayload,
        },
      }),
      this.prisma.orderStatusEvent.create({
        data: {
          orderId,
          locationId: order.locationId,
          fromStatus: "ACCEPTED",
          toStatus: "PREPARING",
          eventType: "SYSTEM_AUTO_PREPARING",
          actorUserId: null,
          payloadJson: systemPayload,
        },
      }),
    ]);

    this.realtime.emitOrderEvent(order.locationId, orderId, "order.accepted", {
      order_id: orderId,
      from_status: "PLACED",
      to_status: "ACCEPTED",
      changed_by_user_id: null,
      source: "SYSTEM_AUTO_ACCEPT",
    });
    this.realtime.emitOrderEvent(order.locationId, orderId, "order.status_changed", {
      order_id: orderId,
      from_status: "ACCEPTED",
      to_status: "PREPARING",
      changed_by_user_id: null,
      source: "SYSTEM_AUTO_ACCEPT",
    });

    return true;
  }

  // PRD §11.1B: at timeout, if KDS heartbeat is not healthy, flag the order
  // for manual review rather than auto-accepting. Idempotent — no-ops if the
  // order is no longer PLACED or already flagged.
  async flagForManualReview(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        locationId: true,
        requiresManualReview: true,
      },
    });
    if (!order || order.status !== "PLACED" || order.requiresManualReview) {
      return false;
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { requiresManualReview: true },
    });

    this.realtime.emitOrderEvent(
      order.locationId,
      orderId,
      "order.manual_review_required",
      { order_id: orderId, reason: "kds_offline_at_auto_accept" },
    );

    return true;
  }

  // PRD §11.3: KDS ±5 / ±10 / ±15 / −5 delta buttons adjust the ready ETA for
  // a live order. Every change is logged in order_eta_events (who, when, old →
  // new). Status is not modified. Customer detail receives order.eta_updated.
  async adjustEtaDelta(
    orderId: string,
    actorUserId: string | null,
    locationId: string,
    deltaMinutes: number,
  ): Promise<{
    id: string;
    estimated_ready_at: Date | null;
    estimated_window_min_minutes: number | null;
    estimated_window_max_minutes: number | null;
    delta_minutes: number;
  }> {
    if (!Number.isInteger(deltaMinutes) || deltaMinutes === 0) {
      throw new BadRequestException("delta_minutes must be a non-zero integer");
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }
    // Cannot re-ETA terminal orders.
    if (TERMINAL_STATUSES.has(order.status)) {
      throw new UnprocessableEntityException({
        message: `Order is in terminal status "${order.status}" and cannot have ETA adjusted`,
        field: "status",
      });
    }
    if (order.status === "PLACED") {
      const settings = await this.prisma.locationSettings.findUnique({
        where: { locationId },
        select: { kdsAutoAcceptSeconds: true },
      });
      const windowSeconds = settings?.kdsAutoAcceptSeconds ?? 10;
      const elapsedMs = Date.now() - order.placedAt.getTime();
      if (elapsedMs > windowSeconds * 1000) {
        throw new UnprocessableEntityException({
          code: "ETA_ADJUST_WINDOW_EXPIRED",
          error: "ETA_ADJUST_WINDOW_EXPIRED",
          field: "status",
          message: `ETA can only be adjusted within ${windowSeconds} seconds while the order is still PLACED.`,
        });
      }
    }

    // Baseline: if estimatedReadyAt exists, use it; otherwise fall back to
    // placedAt + default window midpoint. Keeps UI useful on orders that were
    // created before ETA snapshots were populated.
    const baseline = order.estimatedReadyAt ?? order.placedAt;
    const newReadyAt = new Date(baseline.getTime() + deltaMinutes * 60_000);

    const newWindowMin =
      order.estimatedWindowMinMinutes != null
        ? Math.max(0, order.estimatedWindowMinMinutes + deltaMinutes)
        : null;
    const newWindowMax =
      order.estimatedWindowMaxMinutes != null
        ? Math.max(0, order.estimatedWindowMaxMinutes + deltaMinutes)
        : null;

    const [, updated] = await this.prisma.$transaction([
      this.prisma.orderEtaEvent.create({
        data: {
          orderId,
          oldEstimatedReadyAt: order.estimatedReadyAt,
          newEstimatedReadyAt: newReadyAt,
          changedByUserId: actorUserId,
          reason: `KDS_ETA_DELTA:${deltaMinutes > 0 ? "+" : ""}${deltaMinutes}`,
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          estimatedReadyAt: newReadyAt,
          estimatedWindowMinMinutes: newWindowMin,
          estimatedWindowMaxMinutes: newWindowMax,
        },
      }),
    ]);

    this.realtime.emitOrderEvent(
      order.locationId,
      orderId,
      "order.eta_updated",
      {
        order_id: orderId,
        estimated_ready_at: updated.estimatedReadyAt,
        estimated_window_min_minutes: updated.estimatedWindowMinMinutes,
        estimated_window_max_minutes: updated.estimatedWindowMaxMinutes,
        delta_minutes: deltaMinutes,
        changed_by_user_id: actorUserId,
      },
    );

    return {
      id: updated.id,
      estimated_ready_at: updated.estimatedReadyAt,
      estimated_window_min_minutes: updated.estimatedWindowMinMinutes,
      estimated_window_max_minutes: updated.estimatedWindowMaxMinutes,
      delta_minutes: deltaMinutes,
    };
  }

  // Small helpers shared with controller / workers.
  async requireOrderForLocation(orderId: string, locationId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }
    return order;
  }

  async requestRefund(
    orderId: string,
    actorUserId: string | null,
    locationId: string,
    amountCents: number,
    reason: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }

    if (amountCents <= 0) {
      throw new BadRequestException("Refund amount must be positive");
    }

    const refund = await this.prisma.refundRequest.create({
      data: {
        orderId,
        locationId,
        requestedByUserId: actorUserId,
        amountCents,
        reasonText: reason,
        status: "PENDING",
      },
    });

    this.realtime.emitAdminEvent(locationId, "refund.requested", {
      order_id: refund.orderId,
      refund_request_id: refund.id,
      amount_cents: refund.amountCents,
    });

    return {
      id: refund.id,
      order_id: refund.orderId,
      location_id: refund.locationId,
      requested_by_user_id: refund.requestedByUserId,
      amount_cents: refund.amountCents,
      reason_text: refund.reasonText,
      status: refund.status,
      created_at: refund.createdAt,
    };
  }
}
