import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../../database/prisma.service";
import {
  extractClientIp as resolveClientIp,
  isAllowedStoreIp,
} from "../utils/store-ip";

/**
 * Reusable guard that restricts access to the configured in-store IP only.
 *
 * Reads the location's allowed IP entry from `trusted_ip_ranges` and checks
 * the client IP against it. Loopback/localhost is treated as allowed for
 * same-machine POS use. If no IP is configured for non-localhost traffic, or
 * the IP does not match, the request is rejected with a standardized 403
 * message.
 *
 * Prerequisites: `LocationScopeGuard` must run first so `req.locationId` is
 * set. Forwarded proxy headers are honored through the shared helper so this
 * guard, `/auth/pos/login`, and `/auth/pos/network-status` all resolve the
 * same client IP.
 */
@Injectable()
export class StoreNetworkGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const locationId = req.locationId;
    if (!locationId) return true;

    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: { trustedIpRanges: true },
    });

    const clientIp = this.extractClientIp(req);
    if (!isAllowedStoreIp(clientIp, settings?.trustedIpRanges)) {
      throw new ForbiddenException(
        "Store access is restricted to in-store network only",
      );
    }

    return true;
  }

  private extractClientIp(req: Request): string | null {
    return resolveClientIp(req) || null;
  }
}
