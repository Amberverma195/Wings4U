import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { LocationSettingsService } from "./location-settings.service";
import { AuthGuard } from "../../common/guards/auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { POLICIES } from "../../common/policies/permission-matrix";
import type { Request } from "express";

@Controller("locations/settings")
@UseGuards(AuthGuard, RolesGuard, LocationScopeGuard)
export class LocationsController {
  constructor(private readonly settingsService: LocationSettingsService) {}

  @Get()
  @Roles(POLICIES.ADMIN_ONLY)
  async getSettings(@Req() req: Request) {
    return this.settingsService.getSettings(req.locationId!);
  }

  @Patch()
  @Roles(POLICIES.ADMIN_ONLY)
  async updateSettings(
    @Body() data: Record<string, any>,
    @Req() req: Request,
  ) {
    // Basic validation of fields could go here, omitting for brevity
    return this.settingsService.updateSettings(req.locationId!, data, req.user!.userId);
  }
}
