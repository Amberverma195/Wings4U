import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { isAllowedStoreIp } from "../../common/utils/store-ip";

export const KDS_STATION_COOKIE_NAME = "w4u_kds_session";
export const KDS_STATION_COOKIE_PATH = "/";

@Injectable()
export class KdsAuthService {
  private static readonly STATION_MAX_ATTEMPTS = 5;
  private static readonly STATION_LOCKOUT_WINDOW_MS = 10 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async login(
    locationId: string,
    passwordPlain: string,
    clientIp: string,
    deviceId?: string,
  ) {
    console.log("[KdsAuthService] login attempt:", { locationId, clientIp, deviceId });
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: { kdsPasswordHash: true, trustedIpRanges: true },
    });
    console.log("[KdsAuthService] settings found:", !!settings);

    if (!isAllowedStoreIp(clientIp, settings?.trustedIpRanges)) {
      console.log("[KdsAuthService] IP blocked:", clientIp, "Allowed:", settings?.trustedIpRanges);
      throw new ForbiddenException(
        "KDS access is restricted to in-store network only",
      );
    }

    if (!settings?.kdsPasswordHash) {
      throw new ForbiddenException("KDS password is not configured for this location");
    }

    const lockoutWindowStart = new Date(
      Date.now() - KdsAuthService.STATION_LOCKOUT_WINDOW_MS,
    );
    const recentFailedAttempts = await this.prisma.posLoginAttempt.count({
      where: {
        locationId,
        clientIp,
        ...(deviceId ? { deviceFingerprint: deviceId } : {}),
        wasSuccessful: false,
        attemptedAt: { gte: lockoutWindowStart },
      },
    });

    if (recentFailedAttempts >= KdsAuthService.STATION_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        "Too many failed attempts from this device. Please wait 10 minutes.",
      );
    }

    const match = await bcrypt.compare(passwordPlain, settings.kdsPasswordHash);
    console.log("[KdsAuthService] match:", match);
    if (!match) {
      await this.recordAttempt(locationId, clientIp, deviceId, false);
      throw new UnauthorizedException("Invalid KDS password");
    }

    await this.recordAttempt(locationId, clientIp, deviceId, true);

    const sessionKey = randomBytes(32).toString("hex");
    const token = randomBytes(64).toString("base64");
    const tokenHash = await bcrypt.hash(token, 10);

    // Expire in 12 hours
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 12);

    console.log("[KdsAuthService] creating session...");
    await this.prisma.kdsStationSession.create({
      data: {
        locationId,
        sessionKey,
        tokenHash,
        clientIp,
        deviceId,
        expiresAt,
      },
    });
    console.log("[KdsAuthService] session created");

    return { sessionKey, token, expiresAt };
  }

  private async recordAttempt(
    locationId: string,
    clientIp: string,
    deviceId: string | undefined,
    success: boolean,
  ) {
    await this.prisma.posLoginAttempt.create({
      data: {
        locationId,
        clientIp,
        deviceFingerprint: deviceId ?? null,
        wasSuccessful: success,
      },
    });
  }

  async logout(sessionKey: string) {
    await this.prisma.kdsStationSession.updateMany({
      where: { sessionKey, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async validateSession(cookieValue: string) {
    if (!cookieValue) return null;
    const [sessionKey, token] = cookieValue.split(":");
    if (!sessionKey || !token) return null;

    const session = await this.prisma.kdsStationSession.findUnique({
      where: { sessionKey },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return null;
    }

    const match = await bcrypt.compare(token, session.tokenHash);
    if (!match) return null;

    return session;
  }
}
