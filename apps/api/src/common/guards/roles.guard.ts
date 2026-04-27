import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import {
  type EmployeeRole,
  type RoleSpec,
  ROLES_KEY
} from "../decorators/roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const spec = this.reflector.getAllAndOverride<RoleSpec | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!spec) return true;

    const { user } = context.switchToHttp().getRequest<Request>();
    if (!user) {
      throw new ForbiddenException("Authentication required");
    }

    if (user.role === "ADMIN") return true;

    if (!spec.userRoles.includes(user.role)) {
      throw new ForbiddenException("Insufficient role");
    }

    const needsEmployeeCheck =
      spec.employeeRoles && spec.employeeRoles.length > 0;

    if (needsEmployeeCheck && user.role === "STAFF") {
      if (
        !user.employeeRole ||
        !spec.employeeRoles!.includes(user.employeeRole as EmployeeRole)
      ) {
        throw new ForbiddenException("Insufficient employee role");
      }
    }

    return true;
  }
}
