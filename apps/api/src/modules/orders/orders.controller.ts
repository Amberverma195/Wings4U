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
import { IsOptional, IsString } from "class-validator";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { DeliveryPinService } from "../kds/delivery-pin.service";
import { OrdersService } from "./orders.service";

class CancelOrderDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class ListOrdersQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

@Controller("orders")
@UseGuards(LocationScopeGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly deliveryPin: DeliveryPinService,
  ) {}

  @Get()
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async list(@Query() query: ListOrdersQueryDto, @Req() req: Request) {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return this.ordersService.listOrders({
      userId: req.user!.userId,
      userRole: req.user!.role,
      locationId: req.locationId,
      cursor: query.cursor,
      limit: Number.isFinite(limit) ? limit : undefined,
      status: query.status,
    });
  }

  @Get(":id")
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async getOne(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.ordersService.getOrderDetail(id, req.user!.userId, req.user!.role);
  }

  // PRD §7.8.5: customer sees their delivery PIN on the order detail page
  // while OUT_FOR_DELIVERY — they read it to the driver at handoff.
  @Get(":id/delivery-pin")
  @Roles("CUSTOMER")
  async getDeliveryPin(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.deliveryPin.fetchForCustomer(id, req.user!.userId);
  }

  @Post(":id/cancel")
  @Roles("CUSTOMER")
  async cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CancelOrderDto,
    @Req() req: Request,
  ) {
    return this.ordersService.customerCancel(id, req.user!.userId, body.reason);
  }

  // PRD §7: customer-facing reorder. Returns revalidated cart items + a diff
  // of skipped/price-changed/modifier-dropped. Frontend shows the diff and
  // the customer confirms before the cart is populated.
  @Post(":id/reorder")
  @Roles("CUSTOMER")
  async reorder(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.ordersService.reorder(id, req.user!.userId);
  }
}
