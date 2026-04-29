import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  KDS_STATION_COOKIE_NAME,
  KdsAuthService,
} from "../../modules/kds/kds-auth.service";

@Injectable()
export class KdsStationGuard implements CanActivate {
  constructor(private readonly kdsAuthService: KdsAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const cookie = req.cookies?.[KDS_STATION_COOKIE_NAME];
    if (!cookie) {
      throw new UnauthorizedException("KDS station session required");
    }

    const session = await this.kdsAuthService.validateSession(cookie);
    if (!session) {
      throw new UnauthorizedException("Invalid or expired KDS station session");
    }

    if (!req.locationId || session.locationId !== req.locationId) {
      throw new ForbiddenException("KDS station session is for a different location");
    }

    req.kdsStationSession = {
      id: session.id,
      locationId: session.locationId,
      sessionKey: session.sessionKey,
    };

    return true;
  }
}
