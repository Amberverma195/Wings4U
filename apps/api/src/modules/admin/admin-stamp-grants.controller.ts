import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { AdminStampGrantsService } from "./admin-stamp-grants.service";
import { AdminStampGrantRequestDto } from "./admin-stamp-grant-request.dto";

@Controller("admin/customers/:customerId/stamps")
@Roles("ADMIN")
@UseGuards(LocationScopeGuard)
export class AdminStampGrantsController {
  constructor(private readonly grants: AdminStampGrantsService) {}

  @Post("grant")
  grant(@Param("customerId", ParseUUIDPipe) customerId: string, @Body() input: AdminStampGrantRequestDto,
    @Req() req: Request, @CurrentUser() actor: NonNullable<Request["user"]>) {
    return this.grants.grant(customerId, req.locationId!, actor, input);
  }

  @Post(":grantId/email/retry")
  retry(@Param("customerId", ParseUUIDPipe) customerId: string, @Param("grantId", ParseUUIDPipe) grantId: string,
    @Req() req: Request, @CurrentUser() actor: NonNullable<Request["user"]>) {
    return this.grants.retryEmail(customerId, grantId, req.locationId!, actor);
  }
}
