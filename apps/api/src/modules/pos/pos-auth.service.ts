import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { isAllowedStoreIp } from "../../common/utils/store-ip";

export const POS_STATION_COOKIE_NAME = "w4u_pos_session";
export const POS_STATION_COOKIE_PATH = "/";

/**
 * POS station auth — mirrors KDS station auth.
 *
 * POS no longer routes through the per-employee staff/admin login flow.
 * Instead, on the configured store IP a 5-/8-digit station password
 * unlocks the POS register and we mint a `w4u_pos_session` cookie that
 * is independent of the KDS station cookie. Both surfaces share the same
 * stored password (`location_settings.kds_password_hash`) but each gets
 * its own session row + cookie so unlocking one surface does not unlock
 * the other.
 */
@Injectable()
export class PosAuthService {
  private static readonly STATION_MAX_ATTEMPTS = 5;
  private static readonly STATION_LOCKOUT_WINDOW_MS = 10 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async login(
    locationId: string,
    passwordPlain: string,
    clientIp: string,
    deviceId?: string,
  ) {
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: { kdsPasswordHash: true, trustedIpRanges: true },
    });

    if (!isAllowedStoreIp(clientIp, settings?.trustedIpRanges)) {
      throw new ForbiddenException(
        "POS access is restricted to in-store network only",
      );
    }

    if (!settings?.kdsPasswordHash) {
      throw new ForbiddenException(
        "POS station password is not configured for this location",
      );
    }

    const lockoutWindowStart = new Date(
      Date.now() - PosAuthService.STATION_LOCKOUT_WINDOW_MS,
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

    if (recentFailedAttempts >= PosAuthService.STATION_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        "Too many failed attempts from this device. Please wait 10 minutes.",
      );
    }

    const match = await bcrypt.compare(passwordPlain, settings.kdsPasswordHash);
    if (!match) {
      await this.recordAttempt(locationId, clientIp, deviceId, false);
      throw new UnauthorizedException("Invalid POS station password");
    }

    await this.recordAttempt(locationId, clientIp, deviceId, true);

    const sessionKey = randomBytes(32).toString("hex");
    const token = randomBytes(64).toString("base64");
    const tokenHash = await bcrypt.hash(token, 10);

    // 12-hour station session, matching KDS.
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 12);

    await this.prisma.posStationSession.create({
      data: {
        locationId,
        sessionKey,
        tokenHash,
        clientIp,
        deviceId,
        expiresAt,
      },
    });

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
    await this.prisma.posStationSession.updateMany({
      where: { sessionKey, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async validateSession(cookieValue: string) {
    if (!cookieValue) return null;
    const [sessionKey, token] = cookieValue.split(":");
    if (!sessionKey || !token) return null;

    const session = await this.prisma.posStationSession.findUnique({
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
