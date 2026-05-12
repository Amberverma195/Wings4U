import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException
} from "@nestjs/common";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../decorators/roles.decorator";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPublicRoute(context: ExecutionContext): boolean {
  return Boolean(
    Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler()) ??
      Reflect.getMetadata(IS_PUBLIC_KEY, context.getClass()),
  );
}

@Injectable()
export class LocationScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const id = req.headers["x-location-id"];
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      throw new UnprocessableEntityException({
        message: "X-Location-Id header must be a valid UUID",
        field: "X-Location-Id"
      });
    }

    const user = req.user;
    if (!isPublicRoute(context) && user?.role === "STAFF") {
      if (!user.locationId || user.locationId !== id) {
        throw new ForbiddenException(
          "You do not have access to this location",
        );
      }
    }

    req.locationId = id;
    return true;
  }
}
