import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class KdsStationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;

    if (user?.role === "ADMIN") {
      return true;
    }

    if (user?.role !== "STAFF") {
      throw new ForbiddenException("KDS access requires staff station access");
    }

    if (user.isPosSession) {
      throw new ForbiddenException("KDS access requires KDS station access");
    }

    if (!req.locationId || user.stationLocationId !== req.locationId) {
      throw new ForbiddenException("KDS access requires KDS station access");
    }

    return true;
  }
}
