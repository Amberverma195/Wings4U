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

@Injectable()
export class LocationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(locationId: string) {
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
    });

    if (!settings) {
      throw new NotFoundException(`Settings for location ${locationId} not found`);
    }

    const { kdsPasswordHash, ...rest } = settings;
    return {
      ...rest,
      kdsPasswordConfigured: !!kdsPasswordHash,
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
      const result = await tx.locationSettings.update({
        where: { locationId },
        data: nextData,
      });

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
          payloadJson: { ...nextData, kdsPasswordHash: undefined }, // Don't log hash
        },
      });

      return result;
    });

    const { kdsPasswordHash, ...rest } = updated;
    return {
      ...rest,
      kdsPasswordConfigured: !!kdsPasswordHash,
    };
  }
}
