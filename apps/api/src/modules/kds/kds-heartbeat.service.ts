import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

// PRD §11.1B: auto-accept only fires when KDS heartbeat is healthy. We treat
// a location as healthy if any registered KDS session has posted a heartbeat
// within HEARTBEAT_HEALTHY_WINDOW_MS. Browser clients ping every ~5s; 20s
// tolerates one missed beat plus network jitter without flapping.
export const HEARTBEAT_HEALTHY_WINDOW_MS = 20_000;

@Injectable()
export class KdsHeartbeatService {
  constructor(private readonly prisma: PrismaService) {}

  async recordHeartbeat(params: {
    locationId: string;
    sessionKey: string;
    deviceId?: string | null;
  }): Promise<{ last_seen_at: Date }> {
    const now = new Date();
    const row = await this.prisma.kdsHeartbeat.upsert({
      where: {
        locationId_sessionKey: {
          locationId: params.locationId,
          sessionKey: params.sessionKey,
        },
      },
      create: {
        locationId: params.locationId,
        sessionKey: params.sessionKey,
        deviceId: params.deviceId ?? null,
        lastSeenAt: now,
      },
      update: {
        lastSeenAt: now,
        deviceId: params.deviceId ?? null,
      },
    });
    return { last_seen_at: row.lastSeenAt };
  }

  async isLocationHealthy(locationId: string, now: Date = new Date()): Promise<boolean> {
    const threshold = new Date(now.getTime() - HEARTBEAT_HEALTHY_WINDOW_MS);
    const fresh = await this.prisma.kdsHeartbeat.findFirst({
      where: { locationId, lastSeenAt: { gte: threshold } },
      select: { id: true },
    });
    return fresh !== null;
  }
}
