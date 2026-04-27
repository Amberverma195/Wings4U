import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from "class-validator";
import type { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { AdminStaffService } from "./admin-staff.service";

const EMPLOYEE_ROLE_VALUES = ["MANAGER", "CASHIER", "KITCHEN", "DRIVER"] as const;
const DRIVER_STATUS_VALUES = [
  "AVAILABLE",
  "ON_DELIVERY",
  "OFF_SHIFT",
  "UNAVAILABLE",
  "INACTIVE",
] as const;

class CreateStaffMemberDto {
  @IsString()
  full_name!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsIn(EMPLOYEE_ROLE_VALUES)
  employee_role!: (typeof EMPLOYEE_ROLE_VALUES)[number];

  @IsOptional()
  @Matches(/^\d{5}$/)
  employee_pin?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  hourly_rate_cents?: number;

  @IsOptional()
  @IsString()
  hire_date?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsIn(DRIVER_STATUS_VALUES)
  availability_status?: (typeof DRIVER_STATUS_VALUES)[number];

  @IsOptional()
  @IsString()
  vehicle_type?: string;

  @IsOptional()
  @IsString()
  vehicle_identifier?: string;
}

class UpdateStaffMemberDto {
  @IsString()
  full_name!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @Matches(/^\d{5}$/)
  employee_pin?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  hourly_rate_cents?: number;

  @IsOptional()
  @IsString()
  hire_date?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsIn(DRIVER_STATUS_VALUES)
  availability_status?: (typeof DRIVER_STATUS_VALUES)[number];

  @IsOptional()
  @IsString()
  vehicle_type?: string;

  @IsOptional()
  @IsString()
  vehicle_identifier?: string;
}

@Controller("admin/staff")
@UseGuards(LocationScopeGuard)
@Roles("ADMIN")
export class AdminStaffController {
  constructor(private readonly adminStaffService: AdminStaffService) {}

  @Get()
  async list(@Req() req: Request) {
    return this.adminStaffService.listMembers(req.locationId!);
  }

  @Post()
  async create(
    @Body() body: CreateStaffMemberDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Req() req: Request,
  ) {
    return this.adminStaffService.createMember(
      req.locationId!,
      user.userId,
      body,
    );
  }

  @Put(":id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateStaffMemberDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Req() req: Request,
  ) {
    return this.adminStaffService.updateMember(
      req.locationId!,
      user.userId,
      id,
      body,
    );
  }

  @Delete(":id")
  async deleteDriver(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Req() req: Request,
  ) {
    return this.adminStaffService.deleteDriver(
      req.locationId!,
      user.userId,
      id,
    );
  }
}
