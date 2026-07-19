import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { KdsPresenceService, KDS_RECONNECT_GRACE_MS } from "./kds-presence.service";
import { KdsService } from "./kds.service";

type PendingOrderTiming = {
  id: string;
  locationId: string;
  placedAt: Date;
  autoAcceptSeconds: number;
};

@Injectable()
export class KdsAutoAcceptScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KdsAutoAcceptScheduler.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private recoveryTimer: NodeJS.Timeout | null = null;
  private readonly automaticSchedulingEnabled = process.env.NODE_ENV !== "test";

  constructor(
    private readonly prisma: PrismaService,
    private readonly kds: KdsService,
    private readonly presence: KdsPresenceService,
  ) {}

  onModuleInit(): void {
    if (!this.automaticSchedulingEnabled) return;

    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.recoverPendingOrders();
    }, KDS_RECONNECT_GRACE_MS);
    this.recoveryTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  async scheduleOrder(orderId: string): Promise<void> {
    if (!this.automaticSchedulingEnabled) return;

    try {
      const timing = await this.loadOrderTiming(orderId);
      if (timing) this.arm(timing);
    } catch (err) {
      this.logger.error(
        `Failed to schedule auto-accept for order ${orderId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  async processOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, locationId: true, status: true },
    });
    if (!order || order.status !== "PLACED") return;

    if (this.presence.isHealthy(order.locationId)) {
      await this.kds.systemAutoAccept(order.id);
      return;
    }
    await this.kds.flagForManualReview(order.id);
  }

  async recoverPendingOrders(): Promise<void> {
    try {
      const orders = await this.prisma.order.findMany({
        where: { status: "PLACED" },
        select: {
          id: true,
          locationId: true,
          placedAt: true,
          location: {
            select: {
              settings: { select: { kdsAutoAcceptSeconds: true } },
            },
          },
        },
        orderBy: { placedAt: "asc" },
      });

      for (const order of orders) {
        const autoAcceptSeconds = order.location.settings?.kdsAutoAcceptSeconds ?? 0;
        if (autoAcceptSeconds <= 0) continue;
        this.arm({ ...order, autoAcceptSeconds });
      }
    } catch (err) {
      this.logger.error(
        `Auto-accept recovery failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async loadOrderTiming(orderId: string): Promise<PendingOrderTiming | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        locationId: true,
        placedAt: true,
        status: true,
        location: {
          select: {
            settings: { select: { kdsAutoAcceptSeconds: true } },
          },
        },
      },
    });
    const autoAcceptSeconds = order?.location.settings?.kdsAutoAcceptSeconds ?? 0;
    if (!order || order.status !== "PLACED" || autoAcceptSeconds <= 0) {
      return null;
    }
    return { ...order, autoAcceptSeconds };
  }

  private arm(order: PendingOrderTiming): void {
    const existing = this.timers.get(order.id);
    if (existing) clearTimeout(existing);

    const deadlineMs = order.placedAt.getTime() + order.autoAcceptSeconds * 1000;
    const timer = setTimeout(() => {
      this.timers.delete(order.id);
      void this.processOrder(order.id).catch((err) => {
        this.logger.error(
          `Auto-accept failed for order ${order.id}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      });
    }, Math.max(0, deadlineMs - Date.now()));
    timer.unref();
    this.timers.set(order.id, timer);
  }
}
