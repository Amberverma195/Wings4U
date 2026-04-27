import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  BadRequestException,
} from "@nestjs/common";
import { ReportsService } from "./reports.service";
import { AuthGuard } from "../../common/guards/auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { POLICIES } from "../../common/policies/permission-matrix";
import type { Request } from "express";

@Controller("reports")
@UseGuards(AuthGuard, RolesGuard, LocationScopeGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("widgets")
  @Roles(POLICIES.ADMIN_ONLY)
  async getWidgets(@Req() req: Request) {
    if (!req.locationId) throw new BadRequestException("X-Location-Id header is required");
    return this.reportsService.getAdminWidgets(req.locationId);
  }

  @Get("sales")
  @Roles(POLICIES.ADMIN_ONLY)
  async getSalesDashboard(
    @Req() req: Request,
    @Query("start_date") startDateStr?: string,
    @Query("end_date") endDateStr?: string,
  ) {
    if (!req.locationId) throw new BadRequestException("X-Location-Id header is required");
    // defaults to today
    const now = new Date();
    const startDate = startDateStr ? new Date(startDateStr) : new Date(now.setHours(0,0,0,0));
    const endDate = endDateStr ? new Date(endDateStr) : new Date(now.setHours(23,59,59,999));
    return this.reportsService.getSalesDashboard(req.locationId, startDate, endDate);
  }

  @Get("products")
  @Roles(POLICIES.ADMIN_ONLY)
  async getProductPerformance(
    @Req() req: Request,
    @Query("start_date") startDateStr?: string,
    @Query("end_date") endDateStr?: string,
  ) {
    if (!req.locationId) throw new BadRequestException("X-Location-Id header is required");
    const now = new Date();
    const startDate = startDateStr ? new Date(startDateStr) : new Date(now.setHours(0,0,0,0));
    const endDate = endDateStr ? new Date(endDateStr) : new Date(now.setHours(23,59,59,999));
    return this.reportsService.getProductPerformance(req.locationId, startDate, endDate);
  }
}
