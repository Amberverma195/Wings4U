import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException
} from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../../database/prisma.service";
import { IS_PUBLIC_KEY } from "../decorators/roles.decorator";
import { normalizeLocationRef, resolveLocationRef } from "../utils/location-ref";

function isPublicRoute(context: ExecutionContext): boolean {
  return Boolean(
    Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler()) ??
      Reflect.getMetadata(IS_PUBLIC_KEY, context.getClass()),
  );
}

@Injectable()
export class LocationScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const rawId = req.headers["x-location-id"];
    if (typeof rawId !== "string") {
      throw new UnprocessableEntityException({
        message: "X-Location-Id header must be a valid location id or code",
        field: "X-Location-Id"
      });
    }
    const ref = normalizeLocationRef(rawId);
    const id = await resolveLocationRef(this.prisma, ref);
    if (!id) {
      throw new UnprocessableEntityException({
        message: "X-Location-Id header must be a valid active location id or code",
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
    req.locationRef = ref;
    return true;
  }
}
