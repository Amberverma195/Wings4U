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
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { OrderChangesService } from "./order-changes.service";

class AddItemDto {
  @IsUUID()
  menu_item_id!: string;

  @IsInt()
  @Min(1)
  @Max(20)
  quantity!: number;

  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  modifier_option_ids?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  special_instructions?: string;
}

class CreateAddItemsRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AddItemDto)
  items!: AddItemDto[];
}

class RejectDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

class AdminListQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

@Controller()
@UseGuards(LocationScopeGuard)
export class OrderChangesController {
  constructor(private readonly service: OrderChangesService) {}

  // PRD §13 — customer submits an add-items request (3-min window enforced
  // in the service).
  @Post("orders/:orderId/changes")
  @Roles("CUSTOMER")
  async create(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: CreateAddItemsRequestDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.service.createChangeRequest({
      orderId,
      customerUserId: user.userId,
      items: body.items.map((i) => ({
        menuItemId: i.menu_item_id,
        quantity: i.quantity,
        modifierOptionIds: i.modifier_option_ids ?? [],
        specialInstructions: i.special_instructions,
      })),
    });
  }

  @Get("orders/:orderId/changes")
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async listForOrder(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.service.listByOrder(orderId, user.role, user.userId);
  }

  // PRD §13.2 — admin / manager queue of pending requests scoped to a location.
  @Get("admin/order-changes")
  @Roles("ADMIN")
  async listPending(
    @Query() query: AdminListQueryDto,
    @Req() req: Request,
  ) {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return this.service.listPendingForAdmin({
      locationId: req.locationId!,
      cursor: query.cursor,
      limit: limit != null && Number.isFinite(limit) ? limit : undefined,
    });
  }

  @Post("admin/order-changes/:id/approve")
  @Roles("ADMIN")
  async approve(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.service.approveChangeRequest({
      requestId: id,
      approverUserId: user.userId,
    });
  }

  @Post("admin/order-changes/:id/reject")
  @Roles("ADMIN")
  async reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RejectDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.service.rejectChangeRequest({
      requestId: id,
      approverUserId: user.userId,
      reason: body.reason,
    });
  }
}
