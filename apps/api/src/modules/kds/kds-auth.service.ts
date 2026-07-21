import {
  Injectable,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { resolveLocationRef } from "../../common/utils/location-ref";
import { isAllowedStoreIp } from "../../common/utils/store-ip";
import { KdsOperatingHoursService } from "./kds-operating-hours.service";

export const KDS_STATION_COOKIE_NAME = "w4u_kds_session";
export const KDS_STATION_COOKIE_PATH = "/";
const KDS_STATION_SESSION_TTL_MS = 8 * 24 * 60 * 60 * 1_000;

@Injectable()
export class KdsAuthService {
  private static readonly STATION_MAX_ATTEMPTS = 5;
  private static readonly STATION_LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
  private readonly logger = new Logger(KdsAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly operatingHours: KdsOperatingHoursService,
  ) {}

  async resolveLocationId(locationRef: string): Promise<string | null> {
    return resolveLocationRef(this.prisma, locationRef);
  }

  async login(
    locationRef: string,
    passwordPlain: string,
    clientIp: string,
    deviceId?: string,
  ) {
    const locationId = await this.resolveLocationId(locationRef);
    if (!locationId) {
      throw new ForbiddenException("KDS password is not configured for this location");
    }

    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: { kdsPasswordHash: true, trustedIpRanges: true },
    });
    if (!isAllowedStoreIp(clientIp, settings?.trustedIpRanges)) {
      this.logger.warn(
        JSON.stringify({ event: "kds.unlock_denied", location_id: locationId }),
      );
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
    if (!match) {
      await this.recordAttempt(locationId, clientIp, deviceId, false);
      throw new UnauthorizedException("Invalid KDS password");
    }

    await this.recordAttempt(locationId, clientIp, deviceId, true);

    const sessionKey = randomBytes(32).toString("hex");
    const token = randomBytes(64).toString("base64");
    const tokenHash = await bcrypt.hash(token, 10);

    const expiresAt = new Date(Date.now() + KDS_STATION_SESSION_TTL_MS);
    const schedule = await this.operatingHours.getClientState(locationId);

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
    this.logger.log(
      JSON.stringify({
        event: "kds.unlocked",
        location_id: locationId,
        schedule_state: schedule.is_open ? "OPEN" : "WAITING_FOR_OPEN",
        expires_at: expiresAt.toISOString(),
      }),
    );

    return { sessionKey, token, expiresAt, schedule };
  }

  async getSchedule(locationId: string) {
    return this.operatingHours.getClientState(locationId);
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
