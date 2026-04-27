import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AdminService } from "./admin.service";

class DecideCancellationDto {
  @IsEnum(["APPROVE", "DENY"])
  action!: "APPROVE" | "DENY";

  @IsOptional()
  @IsString()
  admin_notes?: string;
}

class DecideRefundDto {
  @IsEnum(["APPROVE", "REJECT"])
  action!: "APPROVE" | "REJECT";

  @IsOptional()
  @IsString()
  refund_method?: string;

  @IsOptional()
  @IsString()
  admin_notes?: string;
}

class CancelOrderDto {
  @IsString()
  reason!: string;
}

class CreditCustomerDto {
  @IsInt()
  @Min(1)
  amount_cents!: number;

  @IsString()
  reason!: string;
}

class DailyTaxQueryDto {
  @IsString()
  date!: string;
}

class AuditLogQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

class PendingQueueQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

@Controller("admin")
@UseGuards(LocationScopeGuard)
@Roles("ADMIN")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post("cancellation-requests/:id/decide")
  async decideCancellation(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: DecideCancellationDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Req() req: Request,
  ) {
    return this.adminService.decideCancellation(
      id,
      user.userId,
      body.action,
      body.admin_notes,
      req.locationId,
    );
  }

  @Post("refund-requests/:id/decide")
  async decideRefund(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: DecideRefundDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.adminService.decideRefund(
      id,
      user.userId,
      body.action,
      body.refund_method,
      body.admin_notes,
    );
  }

  @Post("orders/:id/cancel")
  async cancelOrder(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CancelOrderDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Req() req: Request,
  ) {
    return this.adminService.cancelOrder(
      id,
      user.userId,
      body.reason,
      req.locationId!,
    );
  }

  @Post("customers/:id/credit")
  async creditCustomer(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreditCustomerDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.adminService.creditCustomer(
      id,
      user.userId,
      body.amount_cents,
      body.reason,
    );
  }

  @Get("reports/daily-tax")
  async getDailyTaxReport(
    @Query() query: DailyTaxQueryDto,
    @Req() req: Request,
  ) {
    return this.adminService.getDailyTaxReport(req.locationId!, query.date);
  }

  @Get("audit-log")
  async getAuditLog(
    @Query() query: AuditLogQueryDto,
    @Req() req: Request,
  ) {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return this.adminService.getAuditLog(
      req.locationId!,
      query.cursor,
      Number.isFinite(limit) ? limit : undefined,
    );
  }

  @Get("search")
  async search(
    @Query("q") query: string,
    @Req() req: Request,
  ) {
    if (!query || query.length < 2) {
      return { query, orders: [], tickets: [], customers: [] };
    }
    return this.adminService.globalSearch(req.locationId!, query);
  }

  // PRD §12.3 / §12.6: Admin needs to discover pending cancellation requests
  // (KDS or chat-initiated) to action via the decide endpoint above.
  @Get("cancellation-requests")
  async listCancellationRequests(
    @Query() query: PendingQueueQueryDto,
    @Req() req: Request,
  ) {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return this.adminService.listCancellationRequests(req.locationId!, {
      status: query.status,
      cursor: query.cursor,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  }

  // PRD §12.6: pending refund queue used by the admin approvals surface.
  @Get("refund-requests")
  async listRefundRequests(
    @Query() query: PendingQueueQueryDto,
    @Req() req: Request,
  ) {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return this.adminService.listRefundRequests(req.locationId!, {
      status: query.status,
      cursor: query.cursor,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  }
}

