import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { KdsHeartbeatService } from "./kds-heartbeat.service";
import { KdsService } from "./kds.service";

// PRD §11.1B: auto-accept window is configured per-location via
// location_settings.kds_auto_accept_seconds. This worker ticks periodically
// and, for each PLACED order past its deadline, either auto-accepts (if the
// location's KDS heartbeat is healthy) or flags the order for manual review.
const TICK_INTERVAL_MS = 2_000;

// Small batch ceiling so a backed-up queue never starves the event loop.
const BATCH_LIMIT = 50;

@Injectable()
export class KdsAutoAcceptWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KdsAutoAcceptWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kds: KdsService,
    private readonly heartbeat: KdsHeartbeatService,
  ) {}

  onModuleInit(): void {
    // Disabled in tests to avoid spurious DB traffic during Jest runs.
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Exposed for tests / manual invocation.
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processDueOrders();
    } catch (err) {
      this.logger.error(
        `Auto-accept tick failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }

  private async processDueOrders(): Promise<void> {
    const now = new Date();

    // Candidate orders: still PLACED. We filter against each location's
    // kds_auto_accept_seconds in memory since LocationSettings lives on a
    // sibling table and the setting is small/cheap to fetch.
    const candidates = await this.prisma.order.findMany({
      where: { status: "PLACED" },
      select: { id: true, locationId: true, placedAt: true },
      orderBy: { placedAt: "asc" },
      take: BATCH_LIMIT,
    });
    if (candidates.length === 0) return;

    const locationIds = Array.from(new Set(candidates.map((c) => c.locationId)));
    const settings = await this.prisma.locationSettings.findMany({
      where: { locationId: { in: locationIds } },
      select: { locationId: true, kdsAutoAcceptSeconds: true },
    });
    const settingsByLocation = new Map(
      settings.map((s) => [s.locationId, s.kdsAutoAcceptSeconds]),
    );

    // Group due orders by location so heartbeat is checked once per location.
    const dueByLocation = new Map<string, string[]>();
    for (const order of candidates) {
      const seconds = settingsByLocation.get(order.locationId);
      if (!seconds || seconds <= 0) continue;
      const deadline = new Date(order.placedAt.getTime() + seconds * 1000);
      if (deadline > now) continue;
      const list = dueByLocation.get(order.locationId) ?? [];
      list.push(order.id);
      dueByLocation.set(order.locationId, list);
    }
    if (dueByLocation.size === 0) return;

    for (const [locationId, orderIds] of dueByLocation) {
      const healthy = await this.heartbeat.isLocationHealthy(locationId, now);
      for (const orderId of orderIds) {
        try {
          if (healthy) {
            await this.kds.systemAutoAccept(orderId);
          } else {
            await this.kds.flagForManualReview(orderId);
          }
        } catch (err) {
          this.logger.error(
            `Auto-accept failed for order ${orderId}: ${(err as Error).message}`,
          );
        }
      }
    }
  }
}
