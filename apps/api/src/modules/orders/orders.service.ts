import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { CartService } from "../cart/cart.service";
import { previewReorder, type ReorderContext } from "./reorder-preview";
import { TZDate } from "@date-fns/tz";
import { isUUID } from "class-validator";
import { addDays, startOfDay } from "date-fns";
import { PrismaService } from "../../database/prisma.service";
import { ChatService } from "../chat/chat.service";
import { RefundService } from "../refunds/refund.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { OrderStatusEmailService } from "../notifications/order-status-email.service";
import {
  serializeCustomerPaymentRow,
  serializePaymentSummary,
  serializeStaffPaymentRow,
} from "../payments/payment-collection-view";

// PRD §12.1: fixed default reason string for customer self-cancellations.
const SELF_CANCEL_DEFAULT_REASON = "Customer cancelled within window";

const TERMINAL_STATUSES = [
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
  "REFUNDED",
] as const;

const PLACED_ON_RE = /^\d{4}-\d{2}-\d{2}$/;

function serializeOrderSummary(order: Record<string, unknown>) {
  const o = order as Record<string, unknown> & { orderNumber: bigint };
  return {
    id: o.id,
    location_id: o.locationId,
    order_number: Number(o.orderNumber),
    order_source: o.orderSource,
    fulfillment_type: o.fulfillmentType,
    status: o.status,
    scheduled_for: o.scheduledFor,
    placed_at: o.placedAt,
    item_subtotal_cents: o.itemSubtotalCents,
    final_payable_cents: o.finalPayableCents,
    payment_status_summary: o.paymentStatusSummary,
    customer_order_notes: o.customerOrderNotes,
    estimated_ready_at: o.estimatedReadyAt,
    estimated_window_min_minutes: o.estimatedWindowMinMinutes,
    estimated_window_max_minutes: o.estimatedWindowMaxMinutes,
    cancel_allowed_until: o.cancelAllowedUntil ?? null,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

function serializeOrderDetail(
  order: Record<string, unknown>,
  audience: "CUSTOMER" | "STAFF",
) {
  const o = order as Record<string, unknown> & {
    orderNumber: bigint;
    finalPayableCents: number;
    orderItems?: Record<string, unknown>[];
    statusEvents?: Record<string, unknown>[];
    cancellationRequests?: Record<string, unknown>[];
    payments?: (Parameters<typeof serializeStaffPaymentRow>[0] & {
      transactionStatus: string;
    })[];
    location?: { phoneNumber?: string | null; name?: string | null } | null;
    assignedDriver?: {
      userId?: string;
      phoneNumberMirror?: string | null;
      vehicleType?: string | null;
      vehicleIdentifier?: string | null;
      employeeProfile?: {
        user?: { displayName?: string | null } | null;
      } | null;
    } | null;
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
    line_discount_cents: item.lineDiscountCents,
    line_total_cents: item.lineTotalCents,
    special_instructions: item.specialInstructions,
    builder_payload_json: item.builderPayloadJson,
    modifiers: ((item.modifiers as Record<string, unknown>[]) ?? []).map(
      (mod: Record<string, unknown>) => ({
        id: mod.id,
        modifier_group_id: mod.modifierGroupId,
        modifier_option_id: mod.modifierOptionId,
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
        wing_flavour_id: fl.wingFlavourId,
        flavour_name_snapshot: fl.flavourNameSnapshot,
        heat_level_snapshot: fl.heatLevelSnapshot,
        slot_no: fl.slotNo,
        flavour_role: fl.flavourRole,
        placement: fl.placement,
        sort_order: fl.sortOrder,
      }),
    ),
  }));

  const statusEvents = (o.statusEvents ?? []).map((ev: Record<string, unknown>) => ({
    id: ev.id,
    from_status: ev.fromStatus,
    to_status: ev.toStatus,
    event_type: ev.eventType,
    actor_user_id: ev.actorUserId,
    reason_text: ev.reasonText,
    created_at: ev.createdAt,
  }));

  const allPayments = o.payments ?? [];
  const successfulPayments = allPayments.filter(
    (payment) => payment.transactionStatus === "SUCCESS",
  );
  const payments =
    audience === "STAFF"
      ? allPayments.map(serializeStaffPaymentRow)
      : successfulPayments.map(serializeCustomerPaymentRow);

  return {
    id: o.id,
    location_id: o.locationId,
    customer_user_id: o.customerUserId,
    order_number: Number(o.orderNumber),
    order_source: o.orderSource,
    fulfillment_type: o.fulfillmentType,
    status: o.status,
    contactless_pref: o.contactlessPref,
    scheduled_for: o.scheduledFor,
    placed_at: o.placedAt,
    accepted_at: o.acceptedAt,
    ready_at: o.readyAt,
    completed_at: o.completedAt,
    cancelled_at: o.cancelledAt,
    assigned_driver_user_id: o.assignedDriverUserId,
    estimated_arrival_at: o.estimatedArrivalAt,
    delivery_started_at: o.deliveryStartedAt,
    cancellation_reason: o.cancellationReason,
    customer_name_snapshot: o.customerNameSnapshot,
    customer_phone_snapshot: o.customerPhoneSnapshot,
    customer_email_snapshot: o.customerEmailSnapshot,
    address_snapshot_json: o.addressSnapshotJson,
    item_subtotal_cents: o.itemSubtotalCents,
    item_discount_total_cents: o.itemDiscountTotalCents,
    order_discount_total_cents: o.orderDiscountTotalCents,
    discounted_subtotal_cents: o.discountedSubtotalCents,
    taxable_subtotal_cents: o.taxableSubtotalCents,
    tax_cents: o.taxCents,
    tax_rate_bps: o.taxRateBps,
    delivery_fee_cents: o.deliveryFeeCents,
    driver_tip_cents: o.driverTipCents,
    wallet_applied_cents: o.walletAppliedCents,
    final_payable_cents: o.finalPayableCents,
    payment_status_summary: o.paymentStatusSummary,
    payment_summary: serializePaymentSummary(
      o as Parameters<typeof serializePaymentSummary>[0],
      successfulPayments,
    ),
    customer_order_notes: o.customerOrderNotes,
    estimated_ready_at: o.estimatedReadyAt,
    estimated_window_min_minutes: o.estimatedWindowMinMinutes,
    estimated_window_max_minutes: o.estimatedWindowMaxMinutes,
    student_discount_requested: o.studentDiscountRequested,
    cancel_allowed_until: o.cancelAllowedUntil ?? null,
    // PRD §12.2: Help → "Contact us" needs a click-to-call target.
    location_phone: o.location?.phoneNumber ?? null,
    location_name: o.location?.name ?? null,
    assigned_driver: o.assignedDriver
      ? {
          user_id: o.assignedDriver.userId,
          full_name:
            o.assignedDriver.employeeProfile?.user?.displayName ?? "Delivery driver",
          phone: o.assignedDriver.phoneNumberMirror ?? null,
          vehicle_type: o.assignedDriver.vehicleType ?? null,
          vehicle_identifier: o.assignedDriver.vehicleIdentifier ?? null,
        }
      : null,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
    items,
    status_events: statusEvents,
    payments,
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly refundService: RefundService,
    private readonly realtime: RealtimeGateway,
    private readonly orderStatusEmails: OrderStatusEmailService,
    private readonly cartService: CartService,
  ) {}

  async listOrders(params: {
    userId: string;
    userRole: string;
    locationId?: string;
    cursor?: string;
    limit?: number;
    status?: string;
    mine?: boolean;
    placedOn?: string;
  }) {
    const take = Math.min(params.limit ?? 20, 50);

    const where: Record<string, unknown> = {};

    if (params.mine || params.userRole === "CUSTOMER") {
      where.customerUserId = params.userId;
    }
    if (params.locationId) {
      where.locationId = params.locationId;
    }
    if (params.status) {
      where.status = params.status;
    }

    const placedOn = params.placedOn?.trim();
    if (placedOn && PLACED_ON_RE.test(placedOn)) {
      let tz = "UTC";
      if (params.locationId) {
        const loc = await this.prisma.location.findUnique({
          where: { id: params.locationId },
          select: { timezoneName: true },
        });
        if (loc?.timezoneName) {
          tz = loc.timezoneName;
        }
      }
      const [yStr, moStr, dStr] = placedOn.split("-");
      const y = Number(yStr);
      const mo = Number(moStr);
      const da = Number(dStr);
      if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(da)) {
        const anchor = TZDate.tz(tz, y, mo - 1, da);
        const start = startOfDay(anchor);
        const endExclusive = addDays(start, 1);
        where.placedAt = {
          gte: start,
          lt: endExclusive,
        };
      }
    }

    if (params.cursor) {
      if (!isUUID(params.cursor) || !await this.prisma.order.findFirst({
        where: { ...where, id: params.cursor }, select: { id: true },
      })) throw new BadRequestException('Invalid order cursor. Refresh your order history and try again.');
    }

    const orders = await this.prisma.order.findMany({
      where,
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    });

    const hasMore = orders.length > take;
    const page = hasMore ? orders.slice(0, take) : orders;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    const unreadCounts = await this.chatService.getUnreadCountsForOrders(
      page.map((o) => o.id),
      params.userRole as "CUSTOMER" | "STAFF" | "ADMIN",
    );

    return {
      orders: page.map((o) => ({
        ...serializeOrderSummary(o as unknown as Record<string, unknown>),
        unread_chat_count: unreadCounts.get(o.id) ?? 0,
      })),
      next_cursor: nextCursor,
    };
  }

  async getOrderDetail(
    orderId: string,
    userId: string,
    userRole: string,
    locationId?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: { modifiers: true, flavours: true },
          orderBy: { lineNo: "asc" },
        },
        statusEvents: { orderBy: { createdAt: "asc" } },
        payments: { orderBy: { createdAt: "desc" } },
        location: { select: { phoneNumber: true, name: true } },
        assignedDriver: {
          select: {
            userId: true,
            phoneNumberMirror: true,
            vehicleType: true,
            vehicleIdentifier: true,
            employeeProfile: {
              select: {
                user: { select: { displayName: true } },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (userRole === "CUSTOMER" && order.customerUserId !== userId) {
      throw new ForbiddenException("You do not have access to this order");
    }

    if (
      userRole !== "CUSTOMER" &&
      locationId &&
      order.locationId !== locationId
    ) {
      throw new ForbiddenException("You do not have access to this order");
    }

    return serializeOrderDetail(
      order as unknown as Record<string, unknown>,
      userRole === "CUSTOMER" ? "CUSTOMER" : "STAFF",
    );
  }

  async customerCancel(orderId: string, userId: string, _reason?: string) {
    // PRD §12.1: customer-self cancel uses a fixed system-authored reason,
    // regardless of any client-supplied text, for consistent admin/reporting.
    const reason = SELF_CANCEL_DEFAULT_REASON;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (order.customerUserId !== userId) {
      throw new ForbiddenException("You do not have access to this order");
    }

    if (TERMINAL_STATUSES.includes(order.status as (typeof TERMINAL_STATUSES)[number])) {
      throw new UnprocessableEntityException({
        message: `Order is already in terminal status "${order.status}" and cannot be cancelled.`,
        field: "status",
      });
    }

    // Race-condition guard: the kitchen may start preparing the order inside
    // the customer's self-cancel window (common for fast items like a single
    // drink). Once KDS moves the order to PREPARING, self-cancel is no longer
    // reasonable — the loss now belongs on the store or support flow, not
    // on a one-click customer action. Applies to both PICKUP and DELIVERY.
    // The client also hides the button once status=PREPARING, but this check
    // has to exist here too because the client's status may be stale by a
    // few seconds vs. KDS.
    if (order.status !== "PLACED" && order.status !== "ACCEPTED") {
      throw new ConflictException({
        message:
          "Your order is already in preparation and can no longer be cancelled here. Please use order chat/help if you need assistance.",
        field: "status",
      });
    }

    const now = new Date();
    if (!order.cancelAllowedUntil || now > order.cancelAllowedUntil) {
      throw new ConflictException(
        "The self-cancel window has expired. Please use order chat/help to request a cancellation.",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.order.update({
        where: { id: orderId },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          cancelledByUserId: userId,
          cancellationSource: "CUSTOMER_SELF",
          cancellationReason: reason,
        },
      });

      await tx.orderStatusEvent.create({
        data: {
          orderId,
          locationId: order.locationId,
          fromStatus: order.status,
          toStatus: "CANCELLED",
          eventType: "CUSTOMER_SELF_CANCEL",
          actorUserId: userId,
          reasonText: reason,
        },
      });

      return cancelled;
    });

    await this.chatService.closeConversation(orderId);
    await this.orderStatusEmails.send(updated, "CANCELLED");

    // PRD §12.6: paid order cancelled → auto-create PENDING refund_request.
    await this.refundService.createForCancelledOrder({
      orderId,
      locationId: order.locationId,
      initiatedByUserId: userId,
      reasonText: `Auto: ${reason}`,
    });

    this.realtime.emitOrderEvent(order.locationId, orderId, "order.cancelled", {
      order_id: orderId,
      from_status: order.status,
      to_status: "CANCELLED",
      changed_by_user_id: userId,
      cancellation_source: "CUSTOMER_SELF",
    });

    return {
      id: updated.id,
      order_id: updated.id,
      status: updated.status,
      cancelled_at: updated.cancelledAt,
      cancellation_source: updated.cancellationSource,
      cancellation_reason: updated.cancellationReason,
    };
  }

  /** Preview only; current Cart Quote validators remain authoritative. */
  async reorder(orderId: string, userId: string, context: ReorderContext = {}, scopedLocationId?: string) {
    return previewReorder(this.prisma, this.cartService, orderId, userId, context, scopedLocationId);
  }
}
