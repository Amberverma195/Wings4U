import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsString } from "class-validator";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { POLICIES } from "../../common/policies/permission-matrix";
import { DriversService } from "./drivers.service";

class UpdateAvailabilityDto {
  @IsString()
  status!: string;
}

@Controller("drivers")
@UseGuards(LocationScopeGuard)
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  /**
   * Used by the KDS surface to pick a driver to assign. KDS itself is
   * ADMIN / KITCHEN / MANAGER only, so this endpoint must not be broader
   * than that or a CASHIER could enumerate available drivers via the API
   * even though they cannot see the KDS page.
   */
  @Get("available")
  @Roles(POLICIES.KDS_STAFF_OR_ADMIN)
  async getAvailable(@Req() req: Request) {
    return this.driversService.getAvailableDrivers(req.locationId!);
  }

  @Post(":id/availability")
  @Roles("STAFF", "ADMIN")
  async updateAvailability(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateAvailabilityDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Req() req: Request,
  ) {
    if (
      user.role !== "ADMIN" &&
      !(user.role === "STAFF" && user.employeeRole === "DRIVER" && user.userId === id)
    ) {
      throw new ForbiddenException(
        "Only admins or the driver themselves can update availability",
      );
    }

    return this.driversService.updateAvailability(id, body.status, req.locationId!);
  }
}
