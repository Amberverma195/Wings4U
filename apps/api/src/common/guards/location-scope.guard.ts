import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnprocessableEntityException
} from "@nestjs/common";
import type { Request } from "express";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    req.locationId = id;
    return true;
  }
}
