import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { SupportService } from "../support/support.service";

const BATCH_LIMIT = 100;

export const OVERDUE_TICKET_TYPE = "DELIVERY_OVERDUE";

@Injectable()
export class OverdueDeliveryJob {
  private readonly logger = new Logger(OverdueDeliveryJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportService,
  ) {}

  async runOnce(now = new Date()): Promise<number> {
    const candidates = await this.prisma.order.findMany({
      where: {
        status: "OUT_FOR_DELIVERY",
        estimatedArrivalAt: { not: null, lte: now },
      },
      select: {
        id: true,
        locationId: true,
        customerUserId: true,
        orderNumber: true,
        estimatedArrivalAt: true,
      },
      take: BATCH_LIMIT,
    });
    if (candidates.length === 0) return 0;

    const locationIds = Array.from(new Set(candidates.map((order) => order.locationId)));
    const settings = await this.prisma.locationSettings.findMany({
      where: { locationId: { in: locationIds } },
      select: { locationId: true, overdueDeliveryGraceMinutes: true },
    });
    const graceByLocation = new Map(
      settings.map((setting) => [
        setting.locationId,
        setting.overdueDeliveryGraceMinutes,
      ]),
    );

    let createdCount = 0;
    for (const order of candidates) {
      const grace = graceByLocation.get(order.locationId);
      if (grace == null || !order.estimatedArrivalAt) continue;
      const threshold = new Date(order.estimatedArrivalAt.getTime() + grace * 60_000);
      if (threshold > now) continue;

      const existing = await this.prisma.supportTicket.findFirst({
        where: { orderId: order.id, ticketType: OVERDUE_TICKET_TYPE },
        select: { id: true },
      });
      if (existing) continue;

      try {
        await this.support.createTicket({
          locationId: order.locationId,
          customerUserId: order.customerUserId,
          orderId: order.id,
          ticketType: OVERDUE_TICKET_TYPE,
          subject: `Delivery overdue - order #${order.orderNumber}`,
          description:
            `Auto-generated: delivery for order #${order.orderNumber} is past its ` +
            `estimated arrival (${order.estimatedArrivalAt.toISOString()}) plus the ` +
            `${grace}-minute grace window.`,
          createdSource: "SYSTEM_OVERDUE_DELIVERY",
          priority: "HIGH",
        });
        createdCount += 1;
      } catch (err) {
        this.logger.error(
          `Overdue ticket creation failed for order ${order.id}: ${(err as Error).message}`,
        );
      }
    }

    return createdCount;
  }
}
