import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAdminWidgets(locationId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      activeOrdersCount,
      salesTodayAggr,
      clockedInEmployeesCouunt,
      driversOnDeliveryCount,
      inventoryLowStockCount,
      menuLowStockCount,
      openTicketsCount,
      pendingCateringCount,
      openRegistersCount,
    ] = await Promise.all([
      // Active Orders
      this.prisma.order.count({
        where: {
          locationId,
          status: {
            in: ["PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"],
          },
        },
      }),

      // Sales Today
      this.prisma.order.aggregate({
        where: {
          locationId,
          status: { notIn: ["CANCELLED"] },
          placedAt: { gte: todayStart },
        },
        _sum: { finalPayableCents: true },
      }),

      // Employees clocked in
      this.prisma.employeeShift.count({
        where: {
          locationId,
          clockOutAt: null,
          status: {
            in: ["CLOCKED_IN", "ON_BREAK"],
          },
        },
      }),

      // Drivers on delivery
      this.prisma.driverProfile.count({
        where: {
          locationId,
          isOnDelivery: true,
          isActive: true,
        },
      }),

      // Low stock items
      this.prisma.$queryRaw<{count: number}[]>`
        SELECT COUNT(*)::int as count 
        FROM inventory_items 
        WHERE location_id = ${locationId}::uuid
          AND is_active = true 
          AND low_stock_threshold_numeric IS NOT NULL 
          AND current_quantity_numeric <= low_stock_threshold_numeric
      `,

      this.prisma.menuItem.count({
        where: {
          locationId,
          archivedAt: null,
          stockStatus: "LOW_STOCK",
        },
      }),

      // Open support tickets
      this.prisma.supportTicket.count({
        where: {
          locationId,
          status: {
            notIn: ["RESOLVED", "CLOSED"],
          },
        },
      }),

      // Pending catering inquiries
      this.prisma.cateringInquiry.count({
        where: {
          assignedLocationId: locationId,
          status: {
            in: ["NEW", "PENDING"],
          },
        },
      }),

      // Open registers
      this.prisma.registerSession.count({
        where: {
          locationId,
          closedAt: null,
        },
      }),
    ]);

    return {
      active_orders: activeOrdersCount,
      sales_today_cents: salesTodayAggr._sum.finalPayableCents ?? 0,
      employees_clocked_in: clockedInEmployeesCouunt,
      drivers_on_delivery: driversOnDeliveryCount,
      low_stock_items:
        (inventoryLowStockCount[0]?.count ?? 0) + menuLowStockCount,
      open_support_tickets: openTicketsCount,
      pending_catering_inquiries: pendingCateringCount,
      open_registers: openRegistersCount,
    };
  }

  async getSalesDashboard(locationId: string, startDate: Date, endDate: Date) {
    // 1. Get all completed/paid orders in range for this location
    const orders = await this.prisma.order.findMany({
      where: {
        locationId,
        placedAt: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          notIn: ["CANCELLED"],
        },
      },
      select: {
        placedAt: true,
        finalPayableCents: true,
        orderSource: true,
        fulfillmentType: true,
      },
    });

    const timeline: Record<string, number> = {};
    const sourceBreakdown: Record<string, number> = {};
    const fulfillmentBreakdown: Record<string, number> = {};
    let totalSalesCents = 0;
    let totalOrders = orders.length;

    for (const order of orders) {
      const amount = order.finalPayableCents ?? 0;
      totalSalesCents += amount;

      // Group by date/hour (ISO string slice for generic hour grouping)
      // "2023-01-01T14:00:00.000Z" -> "2023-01-01T14"
      const hourBucket = order.placedAt.toISOString().slice(0, 13) + ":00:00Z";
      timeline[hourBucket] = (timeline[hourBucket] || 0) + amount;

      // Order Source
      const source = order.orderSource;
      sourceBreakdown[source] = (sourceBreakdown[source] || 0) + amount;

      // Payment Split Breakdown (simplified: could be cash/card/credit tracking realistically in order payments, but as fallback or schema depending on how we track paymentMethod)
      // I'll leave the payment split to loop through order.payments below.

      // Fulfillment
      const fulfillment = order.fulfillmentType;
      fulfillmentBreakdown[fulfillment] = (fulfillmentBreakdown[fulfillment] || 0) + amount;
    }

    // Now get the payment methods, refunds, discounts
    const [paymentsResult, refundsResult, discountsResult] = await Promise.all([
      this.prisma.orderPayment.groupBy({
        by: ['paymentMethod'],
        where: { order: { locationId, placedAt: { gte: startDate, lte: endDate }, status: { notIn: ["CANCELLED"] } }, transactionStatus: "SUCCESS" },
        _sum: { signedAmountCents: true }
      }),
      this.prisma.refundRequest.aggregate({
        where: { locationId, status: "ISSUED", issuedAt: { gte: startDate, lte: endDate } },
        _sum: { amountCents: true }
      }),
      this.prisma.order.aggregate({
        where: { locationId, placedAt: { gte: startDate, lte: endDate }, status: { notIn: ["CANCELLED"] } },
        _sum: { itemDiscountTotalCents: true, orderDiscountTotalCents: true }
      })
    ]);

    const paymentMethods: Record<string, number> = {};
    for (const p of paymentsResult) {
      if (p.paymentMethod) {
        paymentMethods[p.paymentMethod] = p._sum.signedAmountCents ?? 0;
      }
    }

    const totalRefundsCents = refundsResult._sum.amountCents ?? 0;
    const totalDiscountsCents = (discountsResult._sum.itemDiscountTotalCents ?? 0) + (discountsResult._sum.orderDiscountTotalCents ?? 0);
    const averageOrderValueCents = totalOrders > 0 ? Math.round(totalSalesCents / totalOrders) : 0;

    return {
      total_sales_cents: totalSalesCents,
      total_orders: totalOrders,
      average_order_value_cents: averageOrderValueCents,
      timeline: Object.keys(timeline).sort().map(k => ({ time_bucket: k, sales_cents: timeline[k] })),
      source_breakdown: sourceBreakdown,
      fulfillment_breakdown: fulfillmentBreakdown,
      payment_method_breakdown: paymentMethods,
      total_refunds_cents: totalRefundsCents,
      total_discounts_cents: totalDiscountsCents,
    };
  }

  async getProductPerformance(locationId: string, startDate: Date, endDate: Date) {
    // Top selling items (quantity & revenue)
    const orderItems = await this.prisma.orderItem.groupBy({
      by: ['menuItemId', 'productNameSnapshot', 'categoryNameSnapshot'],
      where: {
        order: {
          locationId,
          placedAt: { gte: startDate, lte: endDate },
          status: { notIn: ["CANCELLED"] },
        },
      },
      _sum: {
        quantity: true,
        lineTotalCents: true,
      },
      orderBy: {
        _sum: { quantity: "desc" },
      },
      take: 50, // Top 50 items
    });

    const items = orderItems.map(item => ({
      menu_item_id: item.menuItemId,
      product_name: item.productNameSnapshot,
      category_name: item.categoryNameSnapshot,
      quantity_sold: item._sum.quantity ?? 0,
      revenue_cents: item._sum.lineTotalCents ?? 0,
    }));

    // Attach rates for modifiers (top modifiers)
    const modifiersRaw = await this.prisma.$queryRaw<{
      modifier_option_id: string | null;
      modifier_name: string;
      modifier_group: string;
      quantity_sold: number;
      revenue_cents: number;
    }[]>`
      SELECT 
        oim.modifier_option_id,
        oim.modifier_name_snapshot as modifier_name,
        oim.modifier_group_name_snapshot as modifier_group,
        SUM(oim.quantity)::int as quantity_sold,
        SUM(oim.quantity * oim.price_delta_cents)::int as revenue_cents
      FROM order_item_modifiers oim
      JOIN order_items oi ON oim.order_item_id = oi.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.location_id = ${locationId}::uuid
        AND o.placed_at >= ${startDate}
        AND o.placed_at <= ${endDate}
        AND o.status != 'CANCELLED'
      GROUP BY oim.modifier_option_id, oim.modifier_name_snapshot, oim.modifier_group_name_snapshot
      ORDER BY quantity_sold DESC
      LIMIT 50
    `;

    // Least selling items (quantity)
    const leastSellingItemsRaw = await this.prisma.orderItem.groupBy({
      by: ['menuItemId', 'productNameSnapshot', 'categoryNameSnapshot'],
      where: {
        order: {
          locationId,
          placedAt: { gte: startDate, lte: endDate },
          status: { notIn: ["CANCELLED"] },
        },
      },
      _sum: {
        quantity: true,
      },
      orderBy: {
        _sum: { quantity: "asc" },
      },
      take: 20, // Bottom 20
    });

    const leastItems = leastSellingItemsRaw.map(item => ({
      menu_item_id: item.menuItemId,
      product_name: item.productNameSnapshot,
      category_name: item.categoryNameSnapshot,
      quantity_sold: item._sum.quantity ?? 0,
    }));

    const soldOutFrequency = await this.prisma.$queryRaw<{
      inventory_item_id: string;
      item_name: string;
      count: number;
    }[]>`
      SELECT
        ia.inventory_item_id,
        ii.name as item_name,
        COUNT(*)::int as count
      FROM inventory_adjustments ia
      JOIN inventory_items ii ON ii.id = ia.inventory_item_id
      WHERE ia.location_id = ${locationId}::uuid
        AND ia.created_at >= ${startDate}
        AND ia.created_at <= ${endDate}
        AND ia.reason_text ILIKE '%sold out%'
      GROUP BY ia.inventory_item_id, ii.name
      ORDER BY count DESC
      LIMIT 20
    `;

    return {
      top_items: items,
      least_items: leastItems,
      top_modifiers: modifiersRaw,
      sold_out_frequency: soldOutFrequency,
    };
  }
}
