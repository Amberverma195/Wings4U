import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { formatUsdFromCents } from "../../common/utils/money";
import { lockAndReadWalletBalanceCents } from "../../database/wallet-row-lock";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import {
  getLocationLocalDate,
  isLunchSpecialMenuItem,
  buildScheduleViolationBody,
} from "../shared/pricing";

// PRD §13: customers may add items up to 3 minutes after placing an order.
const ADD_ITEMS_WINDOW_MS = 3 * 60 * 1000;
const REJECTION_REASON_MIN_LENGTH = 5;

type AddItemRequestInput = {
  menuItemId: string;
  quantity: number;
  modifierOptionIds?: string[];
  specialInstructions?: string;
};

interface CreateChangeRequestParams {
  orderId: string;
  customerUserId: string;
  items: AddItemRequestInput[];
}

interface ApproveParams {
  requestId: string;
  approverUserId: string;
}

interface RejectParams {
  requestId: string;
  approverUserId: string;
  reason: string;
}

interface PricingRecompute {
  itemSubtotalCents: number;
  discountedSubtotalCents: number;
  taxableSubtotalCents: number;
  taxCents: number;
  finalPayableCents: number;
}

function formatAddedItemTimelineText(
  lines: Array<{
    productNameSnapshot: string;
    quantity: number;
    lineTotalCents: number;
  }>,
): string {
  return lines
    .map((line) => {
      const quantity = line.quantity > 1 ? ` x${line.quantity}` : "";
      return `${line.productNameSnapshot}${quantity} - ${formatUsdFromCents(
        line.lineTotalCents,
      )}`;
    })
    .join("; ");
}

function serialize(row: Record<string, unknown>) {
  return {
    id: row.id,
    order_id: row.orderId,
    type: row.type,
    status: row.status,
    requested_items_json: row.requestedItemsJson,
    requested_by_user_id: row.requestedByUserId,
    resolved_by_user_id: row.resolvedByUserId,
    resolved_at: row.resolvedAt,
    rejection_reason: row.rejectionReason,
    note: row.note,
    created_at: row.createdAt,
  };
}

@Injectable()
export class OrderChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * PRD §13 — customer requests to add items. If the location has
   * add_items_auto_approve_enabled=true we skip the queue and approve
   * inline; otherwise the request sits PENDING for admin action.
   */
  async createChangeRequest(params: CreateChangeRequestParams) {
    if (!params.items || params.items.length === 0) {
      throw new BadRequestException("At least one item is required");
    }
    for (const item of params.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new BadRequestException("Each item must have a positive integer quantity");
      }
    }

    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        locationId: true,
        customerUserId: true,
        status: true,
        placedAt: true,
        orderSource: true,
        paymentMethod: true,
        paymentStatusSummary: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.customerUserId !== params.customerUserId) {
      throw new ForbiddenException("You can only modify your own orders");
    }

    this.assertWithinWindow(order.placedAt);
    this.assertStatusAllowsAddItems(order);

    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId: order.locationId },
      select: { addItemsAutoApproveEnabled: true },
    });

    const requestedPayload = params.items.map((i) => ({
      menu_item_id: i.menuItemId,
      quantity: i.quantity,
      modifier_option_ids: i.modifierOptionIds ?? [],
      special_instructions: i.specialInstructions ?? null,
    }));

    const created = await this.prisma.orderChangeRequest.create({
      data: {
        orderId: params.orderId,
        requestedByUserId: params.customerUserId,
        type: "ADD_ITEMS",
        status: "PENDING",
        requestedItemsJson: requestedPayload as Prisma.InputJsonValue,
      },
    });

    this.realtime.emitOrderEvent(
      order.locationId,
      order.id,
      "order.change_requested",
      { order_id: order.id, change_request_id: created.id, type: "ADD_ITEMS" },
    );

    if (settings?.addItemsAutoApproveEnabled) {
      return this.approveChangeRequest({
        requestId: created.id,
        approverUserId: params.customerUserId,
      });
    }

    return serialize(created as unknown as Record<string, unknown>);
  }

  /**
   * Customer view of their own change requests on a given order, or
   * staff/admin view of every request on an order.
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

    const rows = await this.prisma.orderChangeRequest.findMany({
      where: { orderId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => serialize(r as unknown as Record<string, unknown>));
  }

  /**
   * Admin queue — pending ADD_ITEMS requests for the given location, newest
   * first. Location scoping is enforced via the order join.
   */
  async listPendingForAdmin(params: {
    locationId: string;
    limit?: number;
    cursor?: string;
  }) {
    const take = Math.min(Math.max(params.limit ?? 50, 1), 100);
    const rows = await this.prisma.orderChangeRequest.findMany({
      where: {
        status: "PENDING",
        type: "ADD_ITEMS",
        order: { locationId: params.locationId },
      },
      include: { order: { select: { orderNumber: true, status: true, customerUserId: true } } },
      orderBy: { createdAt: "asc" },
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: page.map((r) => ({
        ...serialize(r as unknown as Record<string, unknown>),
        order_number: Number((r as { order: { orderNumber: bigint } }).order.orderNumber),
        order_status: (r as { order: { status: string } }).order.status,
      })),
      next_cursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /**
   * Approve and apply an add-items change request atomically:
   *   1. Re-validate menu items + availability at the order's location.
   *   2. Re-check 3-minute window and payment-method matrix.
   *   3. For STORE_CREDIT orders, debit the wallet for the delta in-tx.
   *   4. Append order_items + modifiers, recompute order totals.
   *   5. Mark the request APPROVED; emit order.change_approved.
   */
  async approveChangeRequest(params: ApproveParams) {
    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.orderChangeRequest.findUnique({
        where: { id: params.requestId },
        include: {
          order: {
            include: {
              orderItems: { select: { id: true, lineNo: true } },
              location: { select: { timezoneName: true } },
            },
          },
        },
      });
      if (!request) throw new NotFoundException("Change request not found");
      if (request.status !== "PENDING") {
        throw new BadRequestException(`Request is already ${request.status}`);
      }
      const order = request.order;
      this.assertWithinWindow(order.placedAt);
      this.assertStatusAllowsAddItems(order);

      const items = this.parseRequestedItems(request.requestedItemsJson);

      const menuItemIds = Array.from(new Set(items.map((i) => i.menuItemId)));
      const menuItems = await tx.menuItem.findMany({
        where: { id: { in: menuItemIds }, locationId: order.locationId },
        include: { category: true, schedules: true },
      });
      const menuItemMap = new Map(menuItems.map((m) => [m.id, m]));

      // Mirror checkout-grade validation so direct API callers can't bypass
      // constraints the web client enforces (PRD §13, §8 menu rules).
      const timezone = order.location?.timezoneName ?? "America/Toronto";
      const scheduleReference = order.scheduledFor ?? order.placedAt;
      const localNow = getLocationLocalDate(scheduleReference, timezone);
      const dow = localNow.getDay();
      const hhmm = localNow.getHours() * 60 + localNow.getMinutes();
      const scheduleViolationIds: string[] = [];
      const lunchScheduleViolationIds: string[] = [];
      for (const item of items) {
        const menuItem = menuItemMap.get(item.menuItemId);
        if (!menuItem) continue; // per-item existence errors raised in next loop
        // Builder-flow items (wings/wing-combo/lunch-special/customization)
        // require the full builder payload — the add-items endpoint only
        // accepts simple line items.
        if (menuItem.builderType) {
          throw new UnprocessableEntityException({
            message: `"${menuItem.name}" must be added through its builder, not the add-items flow`,
            field: "items",
            code: "ADD_ITEMS_BUILDER_NOT_SUPPORTED",
          });
        }
        if (
          menuItem.allowedFulfillmentType !== "BOTH" &&
          menuItem.allowedFulfillmentType !== order.fulfillmentType
        ) {
          throw new UnprocessableEntityException({
            message: `"${menuItem.name}" is not available for ${order.fulfillmentType}`,
            field: "items",
            code: "ADD_ITEMS_FULFILLMENT_MISMATCH",
          });
        }
        if (menuItem.schedules.length > 0) {
          const inWindow = menuItem.schedules.some((schedule) => {
            if (schedule.dayOfWeek !== dow) return false;
            const from = new Date(schedule.timeFrom);
            const to = new Date(schedule.timeTo);
            const fromMin = from.getUTCHours() * 60 + from.getUTCMinutes();
            const toMin = to.getUTCHours() * 60 + to.getUTCMinutes();
            return hhmm >= fromMin && hhmm < toMin;
          });
          if (!inWindow) {
            scheduleViolationIds.push(menuItem.id);
            if (isLunchSpecialMenuItem(menuItem)) {
              lunchScheduleViolationIds.push(menuItem.id);
            }
          }
        }
      }
      if (scheduleViolationIds.length > 0) {
        throw new HttpException(
          buildScheduleViolationBody({
            affectedItemIds: scheduleViolationIds,
            timezone,
            lunchOnly:
              lunchScheduleViolationIds.length === scheduleViolationIds.length,
          }),
          422,
        );
      }

      const optionIds = Array.from(
        new Set(items.flatMap((i) => i.modifierOptionIds ?? [])),
      );
      const options = optionIds.length
        ? await tx.modifierOption.findMany({
            where: { id: { in: optionIds }, isActive: true },
            include: { modifierGroup: true },
          })
        : [];
      const optionMap = new Map(options.map((o) => [o.id, o]));

      let deltaSubtotalCents = 0;
      const linesToCreate: Array<{
        menuItemId: string;
        productNameSnapshot: string;
        categoryNameSnapshot: string;
        builderType: string | null;
        quantity: number;
        unitPriceCents: number;
        lineTotalCents: number;
        specialInstructions: string | null;
        modifiers: Array<{
          modifierGroupId: string;
          modifierOptionId: string;
          modifierGroupNameSnapshot: string;
          modifierNameSnapshot: string;
          modifierKind: string;
          priceDeltaCents: number;
          sortOrder: number;
        }>;
      }> = [];

      for (const item of items) {
        const menuItem = menuItemMap.get(item.menuItemId);
        if (!menuItem) {
          throw new UnprocessableEntityException({
            message: `Menu item ${item.menuItemId} is no longer available at this location`,
            field: "items",
          });
        }
        if (menuItem.archivedAt || !menuItem.isAvailable) {
          throw new UnprocessableEntityException({
            message: `Menu item "${menuItem.name}" is currently unavailable`,
            field: "items",
          });
        }

        const modifiers: (typeof linesToCreate)[number]["modifiers"] = [];
        let modifierDelta = 0;
        (item.modifierOptionIds ?? []).forEach((optionId, idx) => {
          const opt = optionMap.get(optionId);
          if (!opt) {
            throw new UnprocessableEntityException({
              message: `Modifier option ${optionId} is inactive or not found`,
              field: "items",
            });
          }
          modifierDelta += opt.priceDeltaCents;
          modifiers.push({
            modifierGroupId: opt.modifierGroupId,
            modifierOptionId: opt.id,
            modifierGroupNameSnapshot: opt.modifierGroup.name,
            modifierNameSnapshot: opt.name,
            modifierKind: "ADDON",
            priceDeltaCents: opt.priceDeltaCents,
            sortOrder: idx,
          });
        });

        const unitPriceCents = menuItem.basePriceCents + modifierDelta;
        const lineTotalCents = unitPriceCents * item.quantity;
        deltaSubtotalCents += lineTotalCents;

        linesToCreate.push({
          menuItemId: menuItem.id,
          productNameSnapshot: menuItem.name,
          categoryNameSnapshot: menuItem.category.name,
          builderType: menuItem.builderType,
          quantity: item.quantity,
          unitPriceCents,
          lineTotalCents,
          specialInstructions: item.specialInstructions ?? null,
          modifiers,
        });
      }

      // Recompute totals. Add-items only extends item_subtotal; delivery fee,
      // tip, wallet already-applied, and order-level discount stay unchanged.
      const newItemSubtotal = order.itemSubtotalCents + deltaSubtotalCents;
      const newDiscountedSubtotal = Math.max(
        0,
        newItemSubtotal - order.itemDiscountTotalCents - order.orderDiscountTotalCents,
      );
      const deliveryTaxable = order.taxDeliveryFeeApplied ? order.deliveryFeeCents : 0;
      const tipTaxable = order.taxTipApplied ? order.driverTipCents : 0;
      const newTaxableSubtotal = Math.max(0, newDiscountedSubtotal + deliveryTaxable + tipTaxable);
      const newTaxCents = Math.max(
        0,
        Math.round((newTaxableSubtotal * order.taxRateBps) / 10_000),
      );
      const newFinalPayable = Math.max(
        0,
        newDiscountedSubtotal +
          order.deliveryFeeCents +
          order.driverTipCents +
          newTaxCents -
          order.walletAppliedCents,
      );
      const priceDelta = newFinalPayable - order.finalPayableCents;

      // PRD §13: if the original order was paid with store credit and the
      // approval increases the total, debit the wallet for the delta. Runs in
      // the same transaction so everything rolls back on any later failure.
      if (order.paymentMethod === "STORE_CREDIT" && priceDelta > 0) {
        const balanceAfterLock = await lockAndReadWalletBalanceCents(
          tx,
          order.customerUserId,
        );
        if (balanceAfterLock < priceDelta) {
          throw new UnprocessableEntityException({
            message: "Insufficient wallet balance to approve this change",
            field: "items",
          });
        }
        const updatedWallet = await tx.customerWallet.update({
          where: { customerUserId: order.customerUserId },
          data: { balanceCents: { decrement: priceDelta } },
        });
        await tx.customerCreditLedger.create({
          data: {
            customerUserId: order.customerUserId,
            amountCents: -priceDelta,
            balanceAfterCents: updatedWallet.balanceCents,
            entryType: "CREDIT_USED",
            reasonText: "Applied to add-items request",
            orderId: order.id,
            createdByUserId: params.approverUserId,
          },
        });
      }

      const nextLineNo =
        (order.orderItems.reduce((max, it) => Math.max(max, it.lineNo), 0) || 0) + 1;

      for (let i = 0; i < linesToCreate.length; i++) {
        const line = linesToCreate[i];
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            lineNo: nextLineNo + i,
            menuItemId: line.menuItemId,
            productNameSnapshot: line.productNameSnapshot,
            categoryNameSnapshot: line.categoryNameSnapshot,
            builderType: line.builderType,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            lineTotalCents: line.lineTotalCents,
            specialInstructions: line.specialInstructions,
            modifiers: {
              create: line.modifiers.map((m) => ({
                modifierGroupId: m.modifierGroupId,
                modifierOptionId: m.modifierOptionId,
                modifierGroupNameSnapshot: m.modifierGroupNameSnapshot,
                modifierNameSnapshot: m.modifierNameSnapshot,
                modifierKind: m.modifierKind,
                priceDeltaCents: m.priceDeltaCents,
                sortOrder: m.sortOrder,
              })),
            },
          },
        });
      }

      const pricing: PricingRecompute = {
        itemSubtotalCents: newItemSubtotal,
        discountedSubtotalCents: newDiscountedSubtotal,
        taxableSubtotalCents: newTaxableSubtotal,
        taxCents: newTaxCents,
        finalPayableCents: newFinalPayable,
      };

      const newPricingSnapshot = {
        item_subtotal_cents: pricing.itemSubtotalCents,
        item_discount_total_cents: order.itemDiscountTotalCents,
        order_discount_total_cents: order.orderDiscountTotalCents,
        discounted_subtotal_cents: pricing.discountedSubtotalCents,
        taxable_subtotal_cents: pricing.taxableSubtotalCents,
        tax_cents: pricing.taxCents,
        tax_rate_bps: order.taxRateBps,
        delivery_fee_cents: order.deliveryFeeCents,
        driver_tip_cents: order.driverTipCents,
        wallet_applied_cents: order.walletAppliedCents,
        final_payable_cents: pricing.finalPayableCents,
      };

      await tx.order.update({
        where: { id: order.id },
        data: {
          itemSubtotalCents: pricing.itemSubtotalCents,
          discountedSubtotalCents: pricing.discountedSubtotalCents,
          taxableSubtotalCents: pricing.taxableSubtotalCents,
          taxCents: pricing.taxCents,
          finalPayableCents: pricing.finalPayableCents,
          pricingSnapshotJson: newPricingSnapshot as Prisma.InputJsonValue,
        },
      });

      const updatedRequest = await tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          resolvedAt: new Date(),
          resolvedByUserId: params.approverUserId,
        },
      });

      // Finding 6: audit trail row so the order timeline shows the approval.
      const addedItemsTimelineText = formatAddedItemTimelineText(linesToCreate);
      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          locationId: order.locationId,
          fromStatus: order.status,
          toStatus: order.status,
          eventType: "CHANGE_REQUEST_APPROVED",
          actorUserId: params.approverUserId,
          reasonText: addedItemsTimelineText,
        },
      });

      return {
        request: updatedRequest,
        orderId: order.id,
        locationId: order.locationId,
        priceDelta,
      };
    });

    this.realtime.emitOrderEvent(
      result.locationId,
      result.orderId,
      "order.change_approved",
      {
        order_id: result.orderId,
        change_request_id: result.request.id,
        price_delta_cents: result.priceDelta,
      },
    );

    return serialize(result.request as unknown as Record<string, unknown>);
  }

  /**
   * PRD §13.3 — rejection requires a reason (≥5 chars) that is surfaced to
   * the customer.
   */
  async rejectChangeRequest(params: RejectParams) {
    const reason = params.reason?.trim() ?? "";
    if (reason.length < REJECTION_REASON_MIN_LENGTH) {
      throw new BadRequestException(
        `Rejection reason must be at least ${REJECTION_REASON_MIN_LENGTH} characters`,
      );
    }

    const existing = await this.prisma.orderChangeRequest.findUnique({
      where: { id: params.requestId },
      include: { order: { select: { id: true, locationId: true } } },
    });
    if (!existing) throw new NotFoundException("Change request not found");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(`Request is already ${existing.status}`);
    }

    const updated = await this.prisma.orderChangeRequest.update({
      where: { id: existing.id },
      data: {
        status: "REJECTED",
        resolvedAt: new Date(),
        resolvedByUserId: params.approverUserId,
        rejectionReason: reason,
      },
    });

    // Finding 6: audit trail row so the order timeline shows the rejection.
    await this.prisma.orderStatusEvent.create({
      data: {
        orderId: existing.order.id,
        locationId: existing.order.locationId,
        fromStatus: "PLACED", // informational — status doesn't change on reject
        toStatus: "PLACED",
        eventType: "CHANGE_REQUEST_REJECTED",
        actorUserId: params.approverUserId,
        reasonText: `Add-items request ${existing.id} rejected: ${reason}`,
      },
    });

    this.realtime.emitOrderEvent(
      existing.order.locationId,
      existing.order.id,
      "order.change_rejected",
      {
        order_id: existing.order.id,
        change_request_id: updated.id,
        rejection_reason: reason,
      },
    );

    return serialize(updated as unknown as Record<string, unknown>);
  }

  private assertWithinWindow(placedAt: Date) {
    const elapsed = Date.now() - placedAt.getTime();
    if (elapsed > ADD_ITEMS_WINDOW_MS) {
      throw new UnprocessableEntityException({
        message: "The 3-minute add-items window has expired",
        code: "ADD_ITEMS_WINDOW_EXPIRED",
      });
    }
  }

  /**
   * PRD §13 payment-method matrix:
   *   - online card (paid or pending capture) → PLACED only
   *   - cash / POS (unpaid, collected at handoff) → PLACED|ACCEPTED|PREPARING
   *   - store credit → PLACED only (debit applied on approve)
   */
  private assertStatusAllowsAddItems(order: {
    status: string;
    orderSource: string;
    paymentMethod: string | null;
    paymentStatusSummary: string;
  }) {
    const isCashLike =
      order.paymentMethod === "CASH" ||
      (order.orderSource !== "ONLINE" && order.paymentStatusSummary === "UNPAID");
    const allowed = isCashLike
      ? new Set(["PLACED", "ACCEPTED", "PREPARING"])
      : new Set(["PLACED"]);

    if (!allowed.has(order.status)) {
      throw new UnprocessableEntityException({
        message: `Items can no longer be added — order is ${order.status}`,
        code: "ADD_ITEMS_NOT_ALLOWED_IN_STATUS",
      });
    }
  }

  private parseRequestedItems(json: unknown): AddItemRequestInput[] {
    if (!Array.isArray(json)) return [];
    const out: AddItemRequestInput[] = [];
    for (let i = 0; i < json.length; i++) {
      const raw = json[i];
      if (!raw || typeof raw !== "object") {
        throw new BadRequestException(
          `Invalid add-items entry at index ${i}: expected an object`,
        );
      }
      const r = raw as Record<string, unknown>;
      if (typeof r.menu_item_id !== "string" || !r.menu_item_id) {
        throw new BadRequestException(
          `Invalid add-items entry at index ${i}: missing or invalid menu_item_id`,
        );
      }
      if (typeof r.quantity !== "number" || r.quantity < 1) {
        throw new BadRequestException(
          `Invalid add-items entry at index ${i}: quantity must be a positive number`,
        );
      }
      const modifierOptionIds = Array.isArray(r.modifier_option_ids)
        ? r.modifier_option_ids.filter((x): x is string => typeof x === "string")
        : [];
      out.push({
        menuItemId: r.menu_item_id,
        quantity: r.quantity,
        modifierOptionIds,
        specialInstructions:
          typeof r.special_instructions === "string" ? r.special_instructions : undefined,
      });
    }
    return out;
  }
}
