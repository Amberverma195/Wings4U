import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { TimeclockService } from "./timeclock.service";

class ShiftHistoryQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

@Controller("timeclock")
@UseGuards(LocationScopeGuard, StoreNetworkGuard)
export class TimeclockController {
  constructor(private readonly timeclockService: TimeclockService) {}

  @Post("clock-in")
  @Roles("STAFF")
  async clockIn(
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Req() req: Request,
  ) {
    return this.timeclockService.clockIn(user.userId, req.locationId!);
  }

  @Post("clock-out")
  @Roles("STAFF")
  async clockOut(
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.timeclockService.clockOut(user.userId);
  }

  @Post("break/start")
  @Roles("STAFF")
  async startBreak(
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.timeclockService.startBreak(user.userId);
  }

  @Post("break/end")
  @Roles("STAFF")
  async endBreak(
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.timeclockService.endBreak(user.userId);
  }

  @Get("current")
  @Roles("STAFF")
  async getCurrent(
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    const shift = await this.timeclockService.getActiveShift(user.userId);
    return shift ?? { shift: null };
  }

  @Get("history")
  @Roles("STAFF")
  async getHistory(
    @Query() query: ShiftHistoryQueryDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return this.timeclockService.getShiftHistory(
      user.userId,
      query.cursor,
      Number.isFinite(limit) ? limit : undefined,
    );
  }
}
