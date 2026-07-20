import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { KdsOperatingHoursService } from "./kds-operating-hours.service";

const ALLOW_OUTSIDE_KDS_HOURS = "allowOutsideKdsHours";

export const AllowOutsideKdsHours = () =>
  SetMetadata(ALLOW_OUTSIDE_KDS_HOURS, true);

@Injectable()
export class KdsOperatingHoursGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly operatingHours: KdsOperatingHoursService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowOutsideHours = this.reflector.getAllAndOverride<boolean>(
      ALLOW_OUTSIDE_KDS_HOURS,
      [context.getHandler(), context.getClass()],
    );
    if (allowOutsideHours) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!request.locationId) {
      throw new ForbiddenException("KDS location is required");
    }

    const operating = await this.operatingHours.mayOperate(request.locationId);
    if (!operating.allowed) {
      throw new ForbiddenException({
        code: "KDS_SCHEDULE_CLOSED",
        message: "KDS is outside scheduled operating hours",
      });
    }
    return true;
  }
}
