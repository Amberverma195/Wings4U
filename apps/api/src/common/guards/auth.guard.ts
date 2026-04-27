import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../decorators/roles.decorator";
import { SessionValidator } from "../session/session-validator.service";

/**
 * HTTP auth guard. Uses {@link SessionValidator} so that every request is
 * validated against the `auth_sessions` row and the current user role in
 * the database — not just the JWT signature. This makes revocation and
 * role demotion take effect on the next request, instead of waiting for
 * the JWT's 15-minute TTL.
 *
 * Public routes still go through the validator so that `req.user` is
 * populated when a valid session cookie is present, but an absent or
 * invalid session does not block the request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionValidator: SessionValidator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    const req = context.switchToHttp().getRequest<Request>();
    const accessToken: string | undefined = req.cookies?.access_token;
    const session = await this.sessionValidator.resolve(accessToken);

    if (session) {
      req.user = {
        userId: session.userId,
        role: session.role,
        employeeRole: session.employeeRole,
        locationId: session.locationId,
        stationLocationId: session.stationLocationId,
        isPosSession: session.isPosSession,
        sessionId: session.sessionId,
      };
    }

    if (isPublic) return true;

    if (!session) {
      throw new UnauthorizedException("Missing or invalid authentication token");
    }

    return true;
  }
}
