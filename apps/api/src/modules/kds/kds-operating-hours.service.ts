import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import {
  evaluateOperatingSchedule,
  KDS_ACTIVE_ORDER_STATUSES,
  KDS_HOURS_SERVICE_TYPE,
  OperatingHour,
  serializeScheduleState,
  STORE_HOURS_SERVICE_TYPE,
} from "./kds-operating-hours";

@Injectable()
export class KdsOperatingHoursService {
  constructor(private readonly prisma: PrismaService) {}

  async getHours(locationId: string): Promise<{
    timezone: string;
    hours: OperatingHour[];
  }> {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: {
        timezoneName: true,
        hours: {
          where: { serviceType: { in: [KDS_HOURS_SERVICE_TYPE, STORE_HOURS_SERVICE_TYPE] } },
          orderBy: [{ dayOfWeek: "asc" }, { timeFrom: "asc" }],
        },
      },
    });
    if (!location) {
      throw new NotFoundException("Location not found");
    }

    const kdsHours = location.hours.filter(
      (hour) => hour.serviceType === KDS_HOURS_SERVICE_TYPE,
    );
    const hours =
      kdsHours.length > 0
        ? kdsHours
        : location.hours.filter(
            (hour) => hour.serviceType === STORE_HOURS_SERVICE_TYPE,
          );

    return { timezone: location.timezoneName, hours };
  }

  async getState(locationId: string, at = new Date()) {
    const { timezone, hours } = await this.getHours(locationId);
    return {
      hours,
      state: evaluateOperatingSchedule(hours, timezone, at),
    };
  }

  async getSerializedState(locationId: string, at = new Date()) {
    const { hours, state } = await this.getState(locationId, at);
    return serializeScheduleState(state, hours);
  }

  async getClientState(locationId: string, at = new Date()) {
    const [schedule, hasActiveTickets] = await Promise.all([
      this.getSerializedState(locationId, at),
      this.hasActiveTickets(locationId),
    ]);
    return { ...schedule, has_active_tickets: hasActiveTickets };
  }

  async getDailySessionExpiry(locationId: string, at = new Date()): Promise<Date> {
    const { hours, state } = await this.getState(locationId, at);
    const targetWindow = state.currentWindow ?? state.nextWindow;
    if (!targetWindow) {
      throw new ForbiddenException("KDS schedule is closed");
    }

    const targetState = evaluateOperatingSchedule(
      hours,
      state.timezone,
      new Date(targetWindow.opensAt.getTime() + 1),
    );
    const nextOpening = targetState.nextWindow?.opensAt;
    const hardLimit = new Date(at.getTime() + 8 * 24 * 60 * 60 * 1_000);
    if (!nextOpening || nextOpening > hardLimit) {
      return hardLimit;
    }
    return nextOpening;
  }

  async hasActiveTickets(locationId: string): Promise<boolean> {
    const count = await this.prisma.order.count({
      where: {
        locationId,
        status: { in: [...KDS_ACTIVE_ORDER_STATUSES] },
      },
    });
    return count > 0;
  }

  async mayOperate(locationId: string, at = new Date()): Promise<{
    allowed: boolean;
    draining: boolean;
    closesAt: Date | null;
  }> {
    const { state } = await this.getState(locationId, at);
    if (state.isOpen) {
      return {
        allowed: true,
        draining: false,
        closesAt: state.currentWindow?.closesAt ?? null,
      };
    }
    const draining = await this.hasActiveTickets(locationId);
    return { allowed: draining, draining, closesAt: null };
  }
}
