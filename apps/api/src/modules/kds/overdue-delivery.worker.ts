import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { SupportService } from "../support/support.service";

// PRD §7.8.8: if estimated_arrival_at + overdue_delivery_grace_minutes passes
// while the order is still OUT_FOR_DELIVERY, auto-open a support ticket.
// Dedupe: one auto-generated ticket per order.
const TICK_INTERVAL_MS = 60_000;
const BATCH_LIMIT = 100;

export const OVERDUE_TICKET_TYPE = "DELIVERY_OVERDUE";

@Injectable()
export class OverdueDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OverdueDeliveryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processOverdue();
    } catch (err) {
      this.logger.error(
        `Overdue tick failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }

  private async processOverdue(): Promise<void> {
    const now = new Date();
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
    if (candidates.length === 0) return;

    const locationIds = Array.from(new Set(candidates.map((o) => o.locationId)));
    const settings = await this.prisma.locationSettings.findMany({
      where: { locationId: { in: locationIds } },
      select: { locationId: true, overdueDeliveryGraceMinutes: true },
    });
    const graceByLocation = new Map(
      settings.map((s) => [s.locationId, s.overdueDeliveryGraceMinutes]),
    );

    for (const order of candidates) {
      const grace = graceByLocation.get(order.locationId);
      if (grace == null) continue;
      if (!order.estimatedArrivalAt) continue;
      const threshold = new Date(order.estimatedArrivalAt.getTime() + grace * 60_000);
      if (threshold > now) continue;

      // Dedupe — only one auto-generated overdue ticket per order, regardless
      // of its current status (avoids a repeat ticket on flap / reassignment).
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
          subject: `Delivery overdue — order #${order.orderNumber}`,
          description:
            `Auto-generated: delivery for order #${order.orderNumber} is past its ` +
            `estimated arrival (${order.estimatedArrivalAt.toISOString()}) plus the ` +
            `${grace}-minute grace window.`,
          createdSource: "SYSTEM_OVERDUE_DELIVERY",
          priority: "HIGH",
        });
      } catch (err) {
        this.logger.error(
          `Overdue ticket creation failed for order ${order.id}: ${(err as Error).message}`,
        );
      }
    }
  }
}
