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
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
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
   * Used by the KDS surface to pick a driver to assign. It follows the
   * same in-store station rule as KDS itself.
   */
  @Get("available")
  @UseGuards(StoreNetworkGuard)
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
