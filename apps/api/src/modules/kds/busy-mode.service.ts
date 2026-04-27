import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const HISTORY_MAX_LIMIT = 100;

@Injectable()
export class BusyModeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async getCurrent(locationId: string) {
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: {
        busyModeEnabled: true,
        busyModePrepTimeMinutes: true,
        defaultPrepTimeMinutes: true,
      },
    });
    if (!settings) throw new NotFoundException("Location settings not found");

    // The open event (endedAt = null) is the source of truth for "who turned
    // it on and when". A mismatch (enabled = true but no open event) is
    // possible on legacy rows; the enabled flag still drives behavior.
    const openEvent = settings.busyModeEnabled
      ? await this.prisma.busyModeEvent.findFirst({
          where: { locationId, endedAt: null },
          orderBy: { startedAt: "desc" },
        })
      : null;

    return {
      enabled: settings.busyModeEnabled,
      prep_minutes: settings.busyModePrepTimeMinutes,
      default_prep_minutes: settings.defaultPrepTimeMinutes,
      current_event: openEvent
        ? {
            id: openEvent.id,
            started_at: openEvent.startedAt,
            started_by_user_id: openEvent.startedByUserId,
            prep_minutes_snapshot: openEvent.prepMinutesSnapshot,
            note: openEvent.note,
          }
        : null,
    };
  }

  async setState(
    locationId: string,
    actorUserId: string,
    enabled: boolean,
    prepMinutes?: number,
    note?: string,
  ) {
    if (enabled && prepMinutes != null && prepMinutes <= 0) {
      throw new BadRequestException("prep_minutes must be > 0");
    }

    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
    });
    if (!settings) throw new NotFoundException("Location settings not found");

    // Idempotent — turning it on when it's already on just updates the prep
    // snapshot and note on the open event (if any). Avoids orphan open events.
    if (enabled === settings.busyModeEnabled) {
      if (!enabled) {
        return this.getCurrent(locationId);
      }
      const openEvent = await this.prisma.busyModeEvent.findFirst({
        where: { locationId, endedAt: null },
        orderBy: { startedAt: "desc" },
      });
      if (openEvent && (prepMinutes != null || note != null)) {
        await this.prisma.busyModeEvent.update({
          where: { id: openEvent.id },
          data: {
            prepMinutesSnapshot: prepMinutes ?? openEvent.prepMinutesSnapshot,
            note: note ?? openEvent.note,
          },
        });
        if (prepMinutes != null) {
          await this.prisma.locationSettings.update({
            where: { locationId },
            data: { busyModePrepTimeMinutes: prepMinutes },
          });
        }
      }
      return this.getCurrent(locationId);
    }

    const now = new Date();

    if (enabled) {
      const effectivePrep = prepMinutes ?? settings.busyModePrepTimeMinutes;
      if (effectivePrep == null) {
        throw new UnprocessableEntityException({
          message:
            "busy_mode_prep_time_minutes must be set (admin) or provided in this request",
          field: "prep_minutes",
        });
      }
      await this.prisma.$transaction([
        this.prisma.locationSettings.update({
          where: { locationId },
          data: {
            busyModeEnabled: true,
            busyModePrepTimeMinutes: effectivePrep,
          },
        }),
        this.prisma.busyModeEvent.create({
          data: {
            locationId,
            startedAt: now,
            startedByUserId: actorUserId,
            prepMinutesSnapshot: effectivePrep,
            note: note ?? null,
          },
        }),
      ]);
    } else {
      // Close the currently open event, if any. If none exists (legacy state),
      // we still disable cleanly.
      const openEvent = await this.prisma.busyModeEvent.findFirst({
        where: { locationId, endedAt: null },
        orderBy: { startedAt: "desc" },
      });
      await this.prisma.$transaction([
        this.prisma.locationSettings.update({
          where: { locationId },
          data: { busyModeEnabled: false },
        }),
        ...(openEvent
          ? [
              this.prisma.busyModeEvent.update({
                where: { id: openEvent.id },
                data: {
                  endedAt: now,
                  endedByUserId: actorUserId,
                  note: note ?? openEvent.note,
                },
              }),
            ]
          : []),
      ]);
    }

    const current = await this.getCurrent(locationId);
    this.realtime.emitAdminEvent(locationId, "admin.busy_mode_changed", {
      location_id: locationId,
      enabled: current.enabled,
      prep_minutes: current.prep_minutes,
      changed_by_user_id: actorUserId,
    });
    return current;
  }

  async listHistory(locationId: string, limit: number | undefined, cursor: string | undefined) {
    const effectiveLimit = Math.min(Math.max(limit ?? 25, 1), HISTORY_MAX_LIMIT);
    const events = await this.prisma.busyModeEvent.findMany({
      where: {
        locationId,
        ...(cursor ? { startedAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: effectiveLimit,
    });
    return {
      items: events.map((e) => ({
        id: e.id,
        started_at: e.startedAt,
        ended_at: e.endedAt,
        started_by_user_id: e.startedByUserId,
        ended_by_user_id: e.endedByUserId,
        prep_minutes_snapshot: e.prepMinutesSnapshot,
        note: e.note,
      })),
      next_cursor:
        events.length === effectiveLimit
          ? events[events.length - 1].startedAt.toISOString()
          : null,
    };
  }
}
