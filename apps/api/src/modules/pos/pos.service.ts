import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { OrderStatus, PaymentTenderMethod } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { lockAndReadWalletBalanceCents } from "../../database/wallet-row-lock";

interface PosOrderItem {
  menuItemId: string;
  quantity: number;
  modifierSelections?: Array<{ modifierOptionId: string }>;
  specialInstructions?: string;
}

interface CreatePosOrderParams {
  actorUserId: string;
  locationId: string;
  fulfillmentType: string;
  orderSource: "POS" | "PHONE";
  items: PosOrderItem[];
  customerPhone?: string;
  customerName?: string;
  paymentMethod: string;
  amountTendered?: number;
  specialInstructions?: string;
}

interface ApplyManualDiscountParams {
  orderId: string;
  locationId: string;
  actorUserId: string;
  discountAmountCents: number;
  reason: string;
  description?: string;
}

function serializePosOrder(order: Record<string, unknown>) {
  const o = order as Record<string, unknown> & {
    orderNumber: bigint;
    orderItems?: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
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
  }));

  const payments = (o.payments ?? []).map((p: Record<string, unknown>) => ({
    id: p.id,
    payment_method: p.paymentMethod,
    transaction_type: p.transactionType,
    transaction_status: p.transactionStatus,
    signed_amount_cents: p.signedAmountCents,
    created_at: p.createdAt,
  }));

  return {
    id: o.id,
    location_id: o.locationId,
    customer_user_id: o.customerUserId,
    created_by_user_id: null,
    order_number: Number(o.orderNumber),
    order_source: o.orderSource,
    fulfillment_type: o.fulfillmentType,
    status: o.status,
    placed_at: o.placedAt,
    accepted_at: o.acceptedAt,
    customer_name_snapshot: o.customerNameSnapshot,
    customer_phone_snapshot: o.customerPhoneSnapshot,
    item_subtotal_cents: o.itemSubtotalCents,
    tax_cents: o.taxCents,
    tax_rate_bps: o.taxRateBps,
    delivery_fee_cents: o.deliveryFeeCents,
    final_payable_cents: o.finalPayableCents,
    total_paid_cents: o.netPaidAmountCents,
    payment_status_summary: o.paymentStatusSummary,
    customer_order_notes: o.customerOrderNotes,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
    items,
    payments,
  };
}

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}

  async createPosOrder(params: CreatePosOrderParams) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Resolve customer user
      let customerUserId: string;
      let customerName: string;
      let customerPhone: string;

      if (params.customerPhone) {
        const phoneE164 = params.customerPhone;
        const existingIdentity = await tx.userIdentity.findUnique({
          where: { phoneE164 },
          include: { user: true },
        });

        if (existingIdentity) {
          customerUserId = existingIdentity.userId;
          customerName =
            params.customerName ?? existingIdentity.user.displayName;
          customerPhone = phoneE164;
        } else {
          const newUser = await tx.user.create({
            data: {
              role: "CUSTOMER",
              displayName: params.customerName ?? "Walk-in Customer",
              identities: {
                create: {
                  provider: "PHONE_OTP",
                  phoneE164,
                  isPrimary: true,
                  isVerified: false,
                },
              },
              customerProfile: {
                create: {},
              },
            },
          });
          customerUserId = newUser.id;
          customerName = newUser.displayName;
          customerPhone = phoneE164;
        }
      } else {
        customerUserId = params.actorUserId;
        customerName = params.customerName ?? "Walk-in";
        customerPhone = "";
      }

      // 2. Fetch location + settings
      const location = await tx.location.findUnique({
        where: { id: params.locationId },
        include: { settings: true },
      });
      if (!location || !location.isActive) {
        throw new NotFoundException("Location not found or inactive");
      }
      const settings = location.settings;
      if (!settings) {
        throw new NotFoundException("Location settings not configured");
      }

      // 3. Validate items against menu
      const menuItemIds = params.items.map((i) => i.menuItemId);
      const menuItems = await tx.menuItem.findMany({
        where: { id: { in: menuItemIds }, locationId: params.locationId },
        include: { category: true },
      });
      const menuItemMap = new Map(menuItems.map((mi) => [mi.id, mi]));

      const allOptionIds = params.items.flatMap(
        (i) => i.modifierSelections?.map((s) => s.modifierOptionId) ?? [],
      );
      const modifierOptions =
        allOptionIds.length > 0
          ? await tx.modifierOption.findMany({
              where: { id: { in: allOptionIds }, isActive: true },
              include: { modifierGroup: true },
            })
          : [];
      const optionMap = new Map(modifierOptions.map((o) => [o.id, o]));

      // 4. Build line items + pricing
      let itemSubtotalCents = 0;
      const lineItems: {
        menuItemId: string;
        productNameSnapshot: string;
        categoryNameSnapshot: string;
        builderType: string | null;
        quantity: number;
        unitPriceCents: number;
        lineTotalCents: number;
        specialInstructions: string | null;
        modifiers: {
          modifierGroupId: string;
          modifierOptionId: string;
          modifierGroupNameSnapshot: string;
          modifierNameSnapshot: string;
          modifierKind: string;
          priceDeltaCents: number;
          sortOrder: number;
        }[];
      }[] = [];

      for (const cartItem of params.items) {
        const menuItem = menuItemMap.get(cartItem.menuItemId);
        if (!menuItem) {
          throw new UnprocessableEntityException({
            message: `Menu item ${cartItem.menuItemId} not found at this location`,
            field: "items",
          });
        }
        if (!menuItem.isAvailable) {
          throw new UnprocessableEntityException({
            message: `Menu item "${menuItem.name}" is currently unavailable`,
            field: "items",
          });
        }

        let modifierTotalCents = 0;
        const modifiers: (typeof lineItems)[number]["modifiers"] = [];

        if (cartItem.modifierSelections) {
          for (let si = 0; si < cartItem.modifierSelections.length; si++) {
            const sel = cartItem.modifierSelections[si];
            const opt = optionMap.get(sel.modifierOptionId);
            if (!opt) {
              throw new UnprocessableEntityException({
                message: `Modifier option ${sel.modifierOptionId} not found or inactive`,
                field: "items",
              });
            }
            modifierTotalCents += opt.priceDeltaCents;
            modifiers.push({
              modifierGroupId: opt.modifierGroupId,
              modifierOptionId: opt.id,
              modifierGroupNameSnapshot: opt.modifierGroup.name,
              modifierNameSnapshot: opt.name,
              modifierKind: "ADDON",
              priceDeltaCents: opt.priceDeltaCents,
              sortOrder: si,
            });
          }
        }

        const unitPriceCents = menuItem.basePriceCents + modifierTotalCents;
        const lineTotalCents = unitPriceCents * cartItem.quantity;
        itemSubtotalCents += lineTotalCents;

        lineItems.push({
          menuItemId: menuItem.id,
          productNameSnapshot: menuItem.name,
          categoryNameSnapshot: menuItem.category.name,
          builderType: menuItem.builderType,
          quantity: cartItem.quantity,
          unitPriceCents,
          lineTotalCents,
          specialInstructions: cartItem.specialInstructions ?? null,
          modifiers,
        });
      }

      // 5. Compute tax
      const taxableSubtotalCents = itemSubtotalCents;
      const taxCents = Math.max(
        0,
        Math.round((taxableSubtotalCents * settings.taxRateBps) / 10_000),
      );
      const finalPayableCents = itemSubtotalCents + taxCents;

      // 5b. STORE_CREDIT: validate and debit wallet atomically
      let walletAppliedCents = 0;
      if (params.paymentMethod === "STORE_CREDIT") {
        // Lock before checking balance so concurrent POS store-credit orders
        // cannot both pass against the same pre-debit wallet value.
        const balance = await lockAndReadWalletBalanceCents(tx, customerUserId);
        if (balance < finalPayableCents) {
          throw new BadRequestException(
            `Insufficient store credit. Balance: ${balance} cents, required: ${finalPayableCents} cents`,
          );
        }
        walletAppliedCents = finalPayableCents;

        const updatedWallet = await tx.customerWallet.update({
          where: { customerUserId },
          data: { balanceCents: { decrement: walletAppliedCents } },
        });
        await tx.customerCreditLedger.create({
          data: {
            customerUserId,
            entryType: "POS_DEBIT",
            amountCents: -walletAppliedCents,
            balanceAfterCents: updatedWallet.balanceCents,
            reasonText: "POS order wallet debit",
            createdByUserId: params.actorUserId,
          },
        });
      }

      // 6. Generate order number
      const orderCount = await tx.order.count({
        where: { locationId: params.locationId },
      });
      const orderNumber = BigInt(orderCount + 1001);

      const now = new Date();
      const fulfillmentType = params.fulfillmentType as "PICKUP" | "DELIVERY";

      // POS orders are auto-accepted
      const initialStatus: OrderStatus = "ACCEPTED";

      const pricingSnapshot = {
        item_subtotal_cents: itemSubtotalCents,
        item_discount_total_cents: 0,
        order_discount_total_cents: 0,
        discounted_subtotal_cents: itemSubtotalCents,
        taxable_subtotal_cents: taxableSubtotalCents,
        tax_cents: taxCents,
        tax_rate_bps: settings.taxRateBps,
        delivery_fee_cents: 0,
        driver_tip_cents: 0,
        wallet_applied_cents: walletAppliedCents,
        final_payable_cents: finalPayableCents,
      };

      // 7. Create order
      const createdOrder = await tx.order.create({
        data: {
          locationId: params.locationId,
          customerUserId,
          orderNumber,
          orderSource: params.orderSource,
          fulfillmentType,
          status: initialStatus,
          scheduledFor: now,
          placedAt: now,
          acceptedAt: now,
          customerNameSnapshot: customerName,
          customerPhoneSnapshot: customerPhone,
          pricingSnapshotJson: pricingSnapshot,
          itemSubtotalCents,
          discountedSubtotalCents: itemSubtotalCents,
          taxableSubtotalCents,
          taxCents,
          taxRateBps: settings.taxRateBps,
          finalPayableCents,
          walletAppliedCents,
          customerOrderNotes: params.specialInstructions ?? null,
          orderItems: {
            create: lineItems.map((line, idx) => ({
              lineNo: idx + 1,
              menuItemId: line.menuItemId,
              productNameSnapshot: line.productNameSnapshot,
              categoryNameSnapshot: line.categoryNameSnapshot,
              builderType: line.builderType,
              quantity: line.quantity,
              unitPriceCents: line.unitPriceCents,
              lineTotalCents: line.lineTotalCents,
              specialInstructions: line.specialInstructions,
              modifiers: {
                create: line.modifiers.map((mod) => ({
                  modifierGroupId: mod.modifierGroupId,
                  modifierOptionId: mod.modifierOptionId,
                  modifierGroupNameSnapshot: mod.modifierGroupNameSnapshot,
                  modifierNameSnapshot: mod.modifierNameSnapshot,
                  modifierKind: mod.modifierKind,
                  priceDeltaCents: mod.priceDeltaCents,
                  sortOrder: mod.sortOrder,
                })),
              },
            })),
          },
          statusEvents: {
            create: [
              {
                locationId: params.locationId,
                toStatus: "PLACED",
                eventType: "POS_CHECKOUT",
                actorUserId: params.actorUserId,
              },
              {
                locationId: params.locationId,
                fromStatus: "PLACED",
                toStatus: "ACCEPTED",
                eventType: "POS_AUTO_ACCEPT",
                actorUserId: params.actorUserId,
              },
            ],
          },
        },
        include: {
          orderItems: {
            include: { modifiers: true },
            orderBy: { lineNo: "asc" },
          },
          payments: { orderBy: { createdAt: "desc" } },
        },
      });

      // 8. Create payment record
      const isCash = params.paymentMethod === "CASH";
      const isStoreCredit = params.paymentMethod === "STORE_CREDIT";
      const tenderMethod: PaymentTenderMethod = isCash
        ? "CASH"
        : isStoreCredit
          ? "STORE_CREDIT"
          : "CARD";
      const transactionType =
        isCash || isStoreCredit ? "CAPTURE" : "AUTH";
      const transactionStatus =
        isCash || isStoreCredit ? "SUCCESS" : "PENDING";

      await tx.orderPayment.create({
        data: {
          orderId: createdOrder.id,
          locationId: params.locationId,
          paymentMethod: tenderMethod,
          transactionType,
          transactionStatus,
          signedAmountCents: finalPayableCents,
          currency: "CAD",
          createdByUserId: params.actorUserId,
          initiatedByUserId: params.actorUserId,
        },
      });

      const paymentStatusSummary =
        isCash || isStoreCredit ? "PAID" : "PENDING";
      const paymentMethod = isCash
        ? "CASH"
        : isStoreCredit
          ? "STORE_CREDIT"
          : "CARD";

      const finalOrder = await tx.order.update({
        where: { id: createdOrder.id },
        data: {
          paymentStatusSummary,
          paymentMethod,
          netPaidAmountCents:
            isCash || isStoreCredit ? finalPayableCents : 0,
        },
        include: {
          orderItems: {
            include: { modifiers: true },
            orderBy: { lineNo: "asc" },
          },
          payments: { orderBy: { createdAt: "desc" } },
        },
      });

      const result = serializePosOrder(
        finalOrder as unknown as Record<string, unknown>,
      );

      // Receipt/drawer intent flags for POS device integration
      const receiptAction = "PRINT";
      const drawerAction = isCash ? "OPEN" : "CLOSED";

      if (isCash && params.amountTendered != null) {
        return {
          ...result,
          receipt_action: receiptAction,
          drawer_action: drawerAction,
          amount_tendered_cents: params.amountTendered,
          change_due_cents: Math.max(
            0,
            params.amountTendered - finalPayableCents,
          ),
        };
      }

      return {
        ...result,
        receipt_action: receiptAction,
        drawer_action: drawerAction,
      };
    });
  }

  async listPosOrders(locationId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const orders = await this.prisma.order.findMany({
      where: {
        locationId,
        orderSource: { in: ["POS", "PHONE", "ONLINE"] },
        placedAt: { gte: startOfDay },
      },
      include: {
        orderItems: {
          include: { modifiers: true },
          orderBy: { lineNo: "asc" },
        },
        payments: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { placedAt: "desc" },
    });

    return orders.map((o) =>
      serializePosOrder(o as unknown as Record<string, unknown>),
    );
  }

  async applyManualDiscount(params: ApplyManualDiscountParams) {
    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }
    if (order.locationId !== params.locationId) {
      throw new ForbiddenException("Order does not belong to this location");
    }
    if (order.status === "CANCELLED") {
      throw new BadRequestException("Cannot apply discount to a cancelled order");
    }

    // Create the discount record with attribution
    const discount = await this.prisma.orderDiscount.create({
      data: {
        orderId: params.orderId,
        discountType: "MANUAL",
        discountAmountCents: params.discountAmountCents,
        description: params.description ?? `Manual discount`,
        appliedByUserId: params.actorUserId,
        reasonText: params.reason,
      },
    });

    // Update order totals
    const newDiscountTotal =
      order.orderDiscountTotalCents + params.discountAmountCents;
    const newFinalPayable = Math.max(
      0,
      order.finalPayableCents - params.discountAmountCents,
    );

    await this.prisma.order.update({
      where: { id: params.orderId },
      data: {
        orderDiscountTotalCents: newDiscountTotal,
        finalPayableCents: newFinalPayable,
      },
    });

    // Audit log
    await this.prisma.adminAuditLog.create({
      data: {
        locationId: params.locationId,
        actorUserId: params.actorUserId,
        actorRoleSnapshot: "STAFF",
        actionKey: "POS_MANUAL_DISCOUNT",
        entityType: "ORDER",
        entityId: params.orderId,
        reasonText: params.reason,
        payloadJson: {
          discount_amount_cents: params.discountAmountCents,
          description: params.description,
          new_final_payable_cents: newFinalPayable,
        },
      },
    });

    return {
      id: discount.id,
      order_id: params.orderId,
      discount_type: "MANUAL",
      discount_amount_cents: params.discountAmountCents,
      reason: params.reason,
      description: discount.description,
      applied_by_user_id: params.actorUserId,
      applied_at: discount.appliedAt,
      new_final_payable_cents: newFinalPayable,
    };
  }
}
