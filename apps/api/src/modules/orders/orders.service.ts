import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay } from "date-fns";
import { PrismaService } from "../../database/prisma.service";
import { ChatService } from "../chat/chat.service";
import { RefundService } from "../refunds/refund.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

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

function serializeOrderDetail(order: Record<string, unknown>) {
  const o = order as Record<string, unknown> & {
    orderNumber: bigint;
    orderItems?: Record<string, unknown>[];
    statusEvents?: Record<string, unknown>[];
    cancellationRequests?: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
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

  const payments = (o.payments ?? []).map((p: Record<string, unknown>) => ({
    id: p.id,
    payment_method: p.paymentMethod,
    amount_cents: p.amountCents,
    status: p.status,
    created_at: p.createdAt,
  }));

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

    const orders = await this.prisma.order.findMany({
      where,
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      orderBy: { placedAt: "desc" },
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

  async getOrderDetail(orderId: string, userId: string, userRole: string) {
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

    return serializeOrderDetail(order as unknown as Record<string, unknown>);
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

  // PRD §7 Reorder Button — Behaviour Rules.
  // Revalidates each item at current state (NOT a blind clone of the snapshot):
  //   available  → include at *current* price, with still-valid modifiers
  //   unavailable / archived → skip, name listed in `skipped`
  //   required modifier group missing → skip
  //   modifiers dropped (option/group gone) → include, listed in `modifier_changes`
  //   unit price changed → include, listed in `price_changes`
  // Snapshot prices are for historical records, not reorders.
  async reorder(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: { modifiers: true, flavours: true },
          orderBy: { lineNo: "asc" },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }
    if (order.customerUserId !== userId) {
      throw new ForbiddenException("You do not have access to this order");
    }

    const sourceItems = order.orderItems;
    const menuItemIds = Array.from(
      new Set(sourceItems.map((i) => i.menuItemId).filter((v): v is string => !!v)),
    );
    const optionIds = Array.from(
      new Set(
        sourceItems.flatMap((i) =>
          i.modifiers
            .filter((m) => m.modifierKind !== "REMOVE_INGREDIENT" && m.modifierOptionId)
            .map((m) => m.modifierOptionId as string),
        ),
      ),
    );

    const [menuItems, modifierOptions] = await Promise.all([
      menuItemIds.length
        ? this.prisma.menuItem.findMany({
            where: { id: { in: menuItemIds }, locationId: order.locationId },
            include: {
              modifierGroups: { include: { modifierGroup: true } },
              removableIngredients: true,
            },
          })
        : Promise.resolve([]),
      optionIds.length
        ? this.prisma.modifierOption.findMany({
            where: { id: { in: optionIds } },
            include: { modifierGroup: true },
          })
        : Promise.resolve([]),
    ]);

    const menuItemMap = new Map(menuItems.map((m) => [m.id, m]));
    const optionMap = new Map(modifierOptions.map((o) => [o.id, o]));

    type SkipReason =
      | "unavailable"
      | "archived"
      | "location_mismatch"
      | "required_group_missing";

    const skipped: Array<{ name: string; reason: SkipReason }> = [];
    const modifierChanges: Array<{ name: string; dropped: string[] }> = [];
    const priceChanges: Array<{ name: string; old_cents: number; new_cents: number }> = [];
    const items: Array<{
      menu_item_id: string;
      menu_item_slug: string | null;
      name: string;
      image_url: string | null;
      base_price_cents: number;
      quantity: number;
      modifier_selections: Array<{
        modifier_option_id: string;
        group_name: string;
        option_name: string;
        price_delta_cents: number;
      }>;
      removed_ingredients: Array<{ id: string; name: string }>;
      special_instructions: string;
      builder_payload: Record<string, unknown> | null;
    }> = [];

    for (const src of sourceItems) {
      const displayName = src.productNameSnapshot;
      if (!src.menuItemId) {
        skipped.push({ name: displayName, reason: "archived" });
        continue;
      }
      const current = menuItemMap.get(src.menuItemId);
      if (!current) {
        // Soft-deleted (missing from current location catalog) per PRD.
        skipped.push({ name: displayName, reason: "location_mismatch" });
        continue;
      }
      if (current.archivedAt || !current.isAvailable) {
        skipped.push({
          name: displayName,
          reason: current.archivedAt ? "archived" : "unavailable",
        });
        continue;
      }

      const removedIngredients = src.modifiers
        .filter((m) => m.modifierKind === "REMOVE_INGREDIENT")
        .map((m) => ({ id: "", name: m.modifierNameSnapshot }));
      // Remap removed-ingredient names onto the current item's removable
      // ingredient ids so the cart/quote can validate them.
      const removableByName = new Map(
        current.removableIngredients.map((ri) => [ri.name.toLowerCase(), ri]),
      );
      const resolvedRemoved: Array<{ id: string; name: string }> = [];
      const droppedRemovals: string[] = [];
      for (const removed of removedIngredients) {
        const match = removableByName.get(removed.name.toLowerCase());
        if (match) resolvedRemoved.push({ id: match.id, name: match.name });
        else droppedRemovals.push(removed.name);
      }

      const attachedGroupIds = new Set(
        current.modifierGroups.map((mg) => mg.modifierGroupId),
      );

      const keptSelections: Array<{
        modifier_option_id: string;
        group_name: string;
        option_name: string;
        price_delta_cents: number;
      }> = [];
      const droppedMods: string[] = [...droppedRemovals];
      for (const mod of src.modifiers) {
        if (mod.modifierKind === "REMOVE_INGREDIENT") continue;
        if (!mod.modifierOptionId) {
          droppedMods.push(mod.modifierNameSnapshot);
          continue;
        }
        const opt = optionMap.get(mod.modifierOptionId);
        if (!opt || !opt.isActive || !attachedGroupIds.has(opt.modifierGroupId)) {
          droppedMods.push(mod.modifierNameSnapshot);
          continue;
        }
        keptSelections.push({
          modifier_option_id: opt.id,
          group_name: opt.modifierGroup.name,
          option_name: opt.name,
          price_delta_cents: opt.priceDeltaCents,
        });
      }

      // If a currently-required group on the item has no kept selection, skip.
      const requiredGroups = current.modifierGroups
        .map((mg) => mg.modifierGroup)
        .filter((g) => g.isRequired);
      const satisfiedGroupIds = new Set(
        keptSelections
          .map((s) => optionMap.get(s.modifier_option_id)?.modifierGroupId)
          .filter((v): v is string => !!v),
      );
      const unsatisfied = requiredGroups.filter((g) => !satisfiedGroupIds.has(g.id));
      if (unsatisfied.length > 0) {
        skipped.push({ name: displayName, reason: "required_group_missing" });
        continue;
      }

      if (droppedMods.length > 0) {
        modifierChanges.push({ name: displayName, dropped: droppedMods });
      }

      const newUnitPrice =
        current.basePriceCents +
        keptSelections.reduce((sum, s) => sum + s.price_delta_cents, 0);
      if (newUnitPrice !== src.unitPriceCents) {
        priceChanges.push({
          name: displayName,
          old_cents: src.unitPriceCents,
          new_cents: newUnitPrice,
        });
      }

      items.push({
        menu_item_id: current.id,
        menu_item_slug: current.slug,
        name: current.name,
        image_url: current.imageUrl,
        base_price_cents: current.basePriceCents,
        quantity: src.quantity,
        modifier_selections: keptSelections,
        removed_ingredients: resolvedRemoved,
        special_instructions: src.specialInstructions ?? "",
        builder_payload:
          (src.builderPayloadJson as Record<string, unknown> | null) ?? null,
      });
    }

    return {
      order_id: order.id,
      location_id: order.locationId,
      fulfillment_type_hint: order.fulfillmentType,
      items,
      diff: {
        skipped,
        modifier_changes: modifierChanges,
        price_changes: priceChanges,
      },
      all_unavailable: items.length === 0,
    };
  }
}
