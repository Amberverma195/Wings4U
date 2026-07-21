import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import {
  evaluateOperatingSchedule,
  isScheduleCovered,
  KDS_ACTIVE_ORDER_STATUSES,
  KDS_HOURS_SERVICE_TYPE,
  OperatingHour,
  serializeScheduleState,
  STORE_HOURS_SERVICE_TYPE,
} from "./kds-operating-hours";

export type KdsOperatingHourInput = {
  day_of_week: number;
  time_from: string;
  time_to: string;
  is_closed: boolean;
};

function timeStringToDate(value: string, fieldName: string): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const hour = Number.parseInt(match?.[1] ?? "", 10);
  const minute = Number.parseInt(match?.[2] ?? "", 10);
  if (
    !match ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new BadRequestException(`${fieldName} must be a time in HH:MM format`);
  }
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
}

function normalizeHoursInput(value: KdsOperatingHourInput[]): OperatingHour[] {
  if (!Array.isArray(value) || value.length !== 7) {
    throw new BadRequestException("KDS hours must include all 7 days");
  }

  const seen = new Set<number>();
  const hours = value.map((row, index) => {
    const dayOfWeek = row?.day_of_week;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new BadRequestException(`KDS hours row ${index + 1} has an invalid day`);
    }
    if (seen.has(dayOfWeek)) {
      throw new BadRequestException("KDS hours can only include each day once");
    }
    if (typeof row.is_closed !== "boolean") {
      throw new BadRequestException(`KDS hours row ${index + 1} has an invalid closed state`);
    }
    seen.add(dayOfWeek);
    return {
      dayOfWeek,
      timeFrom: timeStringToDate(row.time_from, "KDS opening time"),
      timeTo: timeStringToDate(row.time_to, "KDS closing time"),
      isClosed: row.is_closed,
    };
  });

  return hours;
}

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

  async updateHours(
    locationId: string,
    input: KdsOperatingHourInput[],
  ) {
    const hours = normalizeHoursInput(input);
    const [location, storeHours] = await Promise.all([
      this.prisma.location.findUnique({
        where: { id: locationId },
        select: { id: true },
      }),
      this.prisma.locationHours.findMany({
        where: { locationId, serviceType: STORE_HOURS_SERVICE_TYPE },
      }),
    ]);
    if (!location) {
      throw new NotFoundException("Location not found");
    }
    if (!isScheduleCovered(storeHours, hours)) {
      throw new BadRequestException(
        "KDS hours must cover all customer Store Hours",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.locationHours.deleteMany({
        where: { locationId, serviceType: KDS_HOURS_SERVICE_TYPE },
      });
      await tx.locationHours.createMany({
        data: hours.map((hour) => ({
          locationId,
          serviceType: KDS_HOURS_SERVICE_TYPE,
          dayOfWeek: hour.dayOfWeek,
          timeFrom: hour.timeFrom,
          timeTo: hour.timeTo,
          isClosed: hour.isClosed,
        })),
      });
      await tx.adminAuditLog.create({
        data: {
          locationId,
          actorUserId: null,
          actorRoleSnapshot: "KDS_STATION",
          actionKey: "kds.operating_hours.update",
          entityType: "LocationHours",
          entityId: locationId,
          payloadJson: { kdsHours: input },
        },
      });
    });

    return this.getClientState(locationId);
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
