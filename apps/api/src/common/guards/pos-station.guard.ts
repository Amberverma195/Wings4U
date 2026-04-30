import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  POS_STATION_COOKIE_NAME,
  PosAuthService,
} from "../../modules/pos/pos-auth.service";

/**
 * Guards `/api/v1/pos/*` business endpoints. Requires the POS station cookie
 * minted by `/api/v1/pos/auth/login` and rejects any request that arrives
 * with only a regular `access_token` (customer/staff/admin) — POS is now a
 * fully station-gated surface, independent of personal accounts.
 *
 * Prerequisite: `LocationScopeGuard` must run first so `req.locationId` is
 * already set; the station session must match that location.
 */
@Injectable()
export class PosStationGuard implements CanActivate {
  constructor(private readonly posAuthService: PosAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const cookie = req.cookies?.[POS_STATION_COOKIE_NAME];
    if (!cookie) {
      throw new UnauthorizedException("POS station session required");
    }

    const session = await this.posAuthService.validateSession(cookie);
    if (!session) {
      throw new UnauthorizedException("Invalid or expired POS station session");
    }

    if (!req.locationId || session.locationId !== req.locationId) {
      throw new ForbiddenException(
        "POS station session is for a different location",
      );
    }

    req.posStationSession = {
      id: session.id,
      locationId: session.locationId,
      sessionKey: session.sessionKey,
    };

    return true;
  }
}
