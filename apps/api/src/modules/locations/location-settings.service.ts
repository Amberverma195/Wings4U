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

@Injectable()
export class LocationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(locationId: string) {
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
    });

    if (!settings) {
      // If none exist, you could create default or throw
      throw new NotFoundException(`Settings for location ${locationId} not found`);
    }

    return settings;
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.locationSettings.update({
        where: { locationId },
        data: nextData,
      });

      await tx.adminAuditLog.create({
        data: {
          locationId,
          actorUserId,
          actorRoleSnapshot: "ADMIN",
          actionKey: "location_settings.update",
          entityType: "LocationSettings",
          entityId: locationId,
          payloadJson: nextData,
        },
      });

      return result;
    });

    return updated;
  }
}
