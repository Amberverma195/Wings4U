import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AdminCustomerDetail, AdminCustomerOrdersPage, AdminCustomerStampsPage } from "./admin-customers.dto";
import { PrismaService } from "../../database/prisma.service";
import { STAMPS_PER_REWARD } from "../rewards/rewards.service";
import { primaryContacts, primaryIdentityOrder } from "../../common/utils/primary-identity";

/** Customer accounts are global; this guard never substitutes snapshot names for account ownership. */
export function customerAccountWhere(id?: string): Prisma.UserWhereInput {
  return { ...(id ? { id } : {}), role: "CUSTOMER", archivedAt: null };
}

@Injectable()
export class AdminCustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCustomer(customerId: string, locationId: string) {
    if (!locationId) throw new ForbiddenException("An authorized restaurant location is required");
    const customer = await this.prisma.user.findFirst({ where: customerAccountWhere(customerId), select: { id: true } });
    if (!customer) throw new NotFoundException("Customer not found");
  }

  async getCustomer(customerId: string, locationId: string): Promise<AdminCustomerDetail> {
    if (!locationId) throw new ForbiddenException("An authorized restaurant location is required");
    const customer = await this.prisma.user.findFirst({
      where: customerAccountWhere(customerId),
      select: { id: true, displayName: true, firstName: true, lastName: true, createdAt: true,
        _count: { select: { ordersAsCustomer: { where: { locationId } } } },
        identities: { orderBy: primaryIdentityOrder,
          select: { emailNormalized: true, phoneE164: true } },
        customerAddresses: { orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
          select: { id: true, label: true, line1: true, city: true, postalCode: true, isDefault: true } },
      },
    });
    if (!customer) throw new NotFoundException("Customer not found");
    const addresses = customer.customerAddresses.map(address => ({
      id: address.id, label: address.label, line1: address.line1, city: address.city,
      postal_code: address.postalCode, is_default: address.isDefault,
    }));
    return {
      id: customer.id, display_name: customer.displayName, first_name: customer.firstName, last_name: customer.lastName,
      ...primaryContacts(customer.identities),
      created_at: customer.createdAt.toISOString(), saved_addresses: addresses,
      total_order_count: customer._count.ordersAsCustomer,
      default_address: addresses.find(address => address.is_default) ?? null,
    };
  }

  async getOrders(customerId: string, locationId: string, cursor?: string, limit = 20): Promise<AdminCustomerOrdersPage> {
    await this.assertCustomer(customerId, locationId);
    const take = Math.max(1, Math.min(limit, 50));
    const scope = { customerUserId: customerId, locationId };
    const anchor = cursor ? await this.prisma.order.findFirst({
      where: { ...scope, id: cursor }, select: { id: true },
    }) : null;
    if (cursor && !anchor) throw new BadRequestException("Invalid order-history cursor for this customer and restaurant");
    const rows = await this.prisma.order.findMany({
      where: scope,
      // Let the database compare timestamp precision; never round a cursor's
      // timestamp through JavaScript before selecting the subsequent page.
      ...(anchor ? { cursor: { id: anchor.id }, skip: 1 } : {}),
      orderBy: [{ placedAt: "desc" }, { id: "desc" }], take: take + 1,
      select: { id: true, orderNumber: true, placedAt: true, status: true, fulfillmentType: true, finalPayableCents: true },
    });
    const page = rows.slice(0, take);
    return { orders: page.map(order => ({ id: order.id, order_number: order.orderNumber.toString(),
      placed_at: order.placedAt.toISOString(), status: order.status, fulfillment_type: order.fulfillmentType,
      final_payable_cents: order.finalPayableCents })), next_cursor: rows.length > take ? page[page.length - 1].id : null };
  }

  async getStamps(customerId: string, locationId: string, cursor?: string, limit = 20): Promise<AdminCustomerStampsPage> {
    await this.assertCustomer(customerId, locationId);
    const take = Math.max(1, Math.min(limit, 50));
    const anchor = cursor ? await this.prisma.customerWingsStampLedger.findFirst({
      where: { id: cursor, customerUserId: customerId }, select: { id: true },
    }) : null;
    if (cursor && !anchor) throw new BadRequestException("Invalid stamp-history cursor for this customer");
    const [summary, rows] = await Promise.all([
      this.prisma.customerWingsRewards.findUnique({ where: { customerUserId: customerId },
        select: { availableStamps: true, lifetimeStamps: true, lifetimeRedemptions: true } }),
      this.prisma.customerWingsStampLedger.findMany({
        where: { customerUserId: customerId },
        ...(anchor ? { cursor: { id: anchor.id }, skip: 1 } : {}),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1,
        select: { id: true, entryType: true, deltaStamps: true, balanceAfterStamps: true, poundsAwarded: true,
          reasonText: true, createdAt: true, orderId: true,
          order: { select: { id: true, orderNumber: true, locationId: true, customerUserId: true, fulfillmentType: true } } },
      }),
    ]);
    const page = rows.slice(0, take);
    const available = summary?.availableStamps ?? 0;
    return {
      summary: { available_stamps: available, lifetime_stamps: summary?.lifetimeStamps ?? 0,
        lifetime_redemptions: summary?.lifetimeRedemptions ?? 0, stamps_per_reward: STAMPS_PER_REWARD,
        reward_available: available >= STAMPS_PER_REWARD },
      entries: page.map(entry => {
        const accessible = entry.order?.locationId === locationId && entry.order.customerUserId === customerId;
        const restricted = Boolean(entry.orderId) && !accessible;
        return { id: entry.id, entry_type: entry.entryType, delta_stamps: entry.deltaStamps,
          balance_after_stamps: entry.balanceAfterStamps,
          pounds_awarded: restricted || entry.poundsAwarded === null ? null : Number(entry.poundsAwarded),
          reason_text: restricted ? (entry.entryType === "REDEEMED" ? "Reward redeemed at another restaurant." : "Stamps earned at another restaurant.") : entry.reasonText,
          created_at: entry.createdAt.toISOString(), order_id: accessible ? entry.order!.id : null,
          order_number: accessible ? entry.order!.orderNumber.toString() : null,
          order_fulfillment_type: accessible ? entry.order!.fulfillmentType : null, order_accessible: accessible,
        };
      }),
      next_cursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }
}
