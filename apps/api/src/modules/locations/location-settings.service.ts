import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import {
  isValidTrustedIpEntry,
  normalizeTrustedIpRanges,
} from "../../common/utils/store-ip";
import * as bcrypt from "bcryptjs";

const STORE_HOURS_SERVICE_TYPE = "STORE";
const STORE_HOURS_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

function normalizeMinuteOfDay(value: unknown, fieldName: string): number | null {
  if (value == null || value === "") return null;
  const minutes =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
    throw new BadRequestException(`${fieldName} must be a time between 00:00 and 23:59`);
  }
  return minutes;
}

type StoreHoursInput = {
  day_of_week?: unknown;
  dayOfWeek?: unknown;
  time_from?: unknown;
  timeFrom?: unknown;
  time_to?: unknown;
  timeTo?: unknown;
  is_closed?: unknown;
  isClosed?: unknown;
};

function timeStringToDate(value: unknown, fieldName: string): Date {
  if (typeof value !== "string") {
    throw new BadRequestException(`${fieldName} must be a time in HH:MM format`);
  }
  const [hourText, minuteText] = value.split(":");
  const hour = Number.parseInt(hourText ?? "", 10);
  const minute = Number.parseInt(minuteText ?? "", 10);
  if (
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

function timeDateToString(value: Date): string {
  return `${String(value.getUTCHours()).padStart(2, "0")}:${String(
    value.getUTCMinutes(),
  ).padStart(2, "0")}`;
}

function serializeStoreHours(
  hours: Array<{
    dayOfWeek: number;
    timeFrom: Date;
    timeTo: Date;
    isClosed: boolean;
  }>,
) {
  const byDay = new Map(hours.map((hour) => [hour.dayOfWeek, hour]));
  return STORE_HOURS_DAY_ORDER.map((dayOfWeek) => {
    const hour = byDay.get(dayOfWeek);
    return {
      day_of_week: dayOfWeek,
      time_from: hour ? timeDateToString(hour.timeFrom) : "11:00",
      time_to: hour
        ? timeDateToString(hour.timeTo)
        : dayOfWeek === 5 || dayOfWeek === 6
          ? "02:30"
          : "01:00",
      is_closed: hour?.isClosed ?? false,
    };
  });
}

function normalizeStoreHoursInput(value: unknown) {
  if (!Array.isArray(value)) {
    throw new BadRequestException("Store hours must be an array");
  }

  const seen = new Set<number>();
  const rows = value.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new BadRequestException(`Store hours row ${index + 1} is invalid`);
    }
    const row = raw as StoreHoursInput;
    const dayOfWeek = Number(row.day_of_week ?? row.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new BadRequestException("Store hours day must be between 0 and 6");
    }
    if (seen.has(dayOfWeek)) {
      throw new BadRequestException("Store hours can only include each day once");
    }
    seen.add(dayOfWeek);

    const isClosed = Boolean(row.is_closed ?? row.isClosed);
    return {
      dayOfWeek,
      timeFrom: timeStringToDate(row.time_from ?? row.timeFrom, "Store opens at"),
      timeTo: timeStringToDate(row.time_to ?? row.timeTo, "Store closes at"),
      isClosed,
    };
  });

  if (seen.size !== 7) {
    throw new BadRequestException("Store hours must include all 7 days");
  }

  return rows;
}

@Injectable()
export class LocationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(locationId: string) {
    const [settings, storeHours] = await Promise.all([
      this.prisma.locationSettings.findUnique({
        where: { locationId },
      }),
      this.prisma.locationHours.findMany({
        where: { locationId, serviceType: STORE_HOURS_SERVICE_TYPE },
        orderBy: [{ dayOfWeek: "asc" }, { timeFrom: "asc" }],
      }),
    ]);

    if (!settings) {
      throw new NotFoundException(`Settings for location ${locationId} not found`);
    }

    const { kdsPasswordHash, ...rest } = settings;
    return {
      ...rest,
      kdsPasswordConfigured: !!kdsPasswordHash,
      storeHours: serializeStoreHours(storeHours),
    };
  }

  async updateSettings(locationId: string, data: Record<string, any>, actorUserId: string) {
    const existing = await this.prisma.locationSettings.findUnique({
      where: { locationId },
    });
    if (!existing) {
      throw new NotFoundException(`Settings for location ${locationId} not found`);
    }

    const nextData = { ...data };
    const storeHoursInput =
      "storeHours" in nextData ? normalizeStoreHoursInput(nextData.storeHours) : null;
    delete nextData.storeHours;
    if ("trustedIpRanges" in nextData) {
      const normalized = normalizeTrustedIpRanges(nextData.trustedIpRanges);
      if (normalized.length > 0 && !isValidTrustedIpEntry(normalized[0]!)) {
        throw new BadRequestException(
          "Allowed IP address must be a valid non-localhost IPv4 address or CIDR range",
        );
      }
      nextData.trustedIpRanges = normalized;
    }

    if (nextData.kdsPassword !== undefined) {
      if (nextData.kdsPassword) {
        if (!/^\d{8}$/.test(nextData.kdsPassword)) {
          throw new BadRequestException("KDS password must be exactly 8 digits");
        }
        nextData.kdsPasswordHash = await bcrypt.hash(nextData.kdsPassword, 10);
      } else {
        nextData.kdsPasswordHash = null;
      }
      delete nextData.kdsPassword;
      delete nextData.kdsPasswordConfigured;
    } else if (nextData.kdsPasswordConfigured !== undefined) {
      // Do not allow kdsPasswordConfigured to be directly updated
      delete nextData.kdsPasswordConfigured;
    }

    if ("deliveryDisabled" in nextData) {
      nextData.deliveryDisabled = Boolean(nextData.deliveryDisabled);
    }
    if ("deliveryAvailableFromMinutes" in nextData) {
      nextData.deliveryAvailableFromMinutes = normalizeMinuteOfDay(
        nextData.deliveryAvailableFromMinutes,
        "Delivery starts at",
      );
    }
    if ("deliveryAvailableUntilMinutes" in nextData) {
      nextData.deliveryAvailableUntilMinutes = normalizeMinuteOfDay(
        nextData.deliveryAvailableUntilMinutes,
        "Delivery ends at",
      );
    }
    const nextFrom =
      "deliveryAvailableFromMinutes" in nextData
        ? nextData.deliveryAvailableFromMinutes
        : existing.deliveryAvailableFromMinutes;
    const nextUntil =
      "deliveryAvailableUntilMinutes" in nextData
        ? nextData.deliveryAvailableUntilMinutes
        : existing.deliveryAvailableUntilMinutes;
    if ((nextFrom == null) !== (nextUntil == null)) {
      throw new BadRequestException(
        "Set both delivery start and end times, or leave both blank",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result =
        Object.keys(nextData).length > 0
          ? await tx.locationSettings.update({
              where: { locationId },
              data: nextData,
            })
          : existing;

      if (storeHoursInput) {
        await tx.locationHours.deleteMany({
          where: { locationId, serviceType: STORE_HOURS_SERVICE_TYPE },
        });
        await tx.locationHours.createMany({
          data: storeHoursInput.map((row) => ({
            locationId,
            serviceType: STORE_HOURS_SERVICE_TYPE,
            dayOfWeek: row.dayOfWeek,
            timeFrom: row.timeFrom,
            timeTo: row.timeTo,
            isClosed: row.isClosed,
          })),
        });
      }

      // If kdsPasswordHash was updated, revoke all active KDS *and* POS
      // station sessions — both surfaces are unlocked by the same shared
      // password, so a password rotation must invalidate both.
      if ("kdsPasswordHash" in nextData) {
        await tx.kdsStationSession.updateMany({
          where: { locationId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.posStationSession.updateMany({
          where: { locationId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await tx.adminAuditLog.create({
        data: {
          locationId,
          actorUserId,
          actorRoleSnapshot: "ADMIN",
          actionKey: "location_settings.update",
          entityType: "LocationSettings",
          entityId: locationId,
          payloadJson: {
            ...nextData,
            storeHours: storeHoursInput
              ? serializeStoreHours(storeHoursInput)
              : undefined,
            kdsPasswordHash: undefined,
          }, // Don't log hash
        },
      });

      return result;
    });

    const { kdsPasswordHash, ...rest } = updated;
    return {
      ...rest,
      kdsPasswordConfigured: !!kdsPasswordHash,
      storeHours: storeHoursInput
        ? serializeStoreHours(storeHoursInput)
        : serializeStoreHours(
            await this.prisma.locationHours.findMany({
              where: { locationId, serviceType: STORE_HOURS_SERVICE_TYPE },
              orderBy: [{ dayOfWeek: "asc" }, { timeFrom: "asc" }],
            }),
          ),
    };
  }
}
