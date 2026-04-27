import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMinSize,
  IsArray,
  IsIn,
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
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { POLICIES } from "../../common/policies/permission-matrix";
import { PosService } from "./pos.service";

class PosModifierSelectionDto {
  @IsUUID()
  modifier_option_id!: string;
}

class PosOrderItemDto {
  @IsUUID()
  menu_item_id!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosModifierSelectionDto)
  modifier_selections?: PosModifierSelectionDto[];

  @IsOptional()
  @IsString()
  special_instructions?: string;
}

class CreatePosOrderDto {
  @IsIn(["PICKUP", "DELIVERY"])
  fulfillment_type!: string;

  @IsIn(["POS", "PHONE"])
  order_source!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosOrderItemDto)
  items!: PosOrderItemDto[];

  @IsOptional()
  @IsString()
  customer_phone?: string;

  @IsOptional()
  @IsString()
  customer_name?: string;

  @IsIn(["CASH", "CARD_TERMINAL", "STORE_CREDIT"])
  payment_method!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amount_tendered?: number;

  @IsOptional()
  @IsString()
  special_instructions?: string;
}

class ApplyManualDiscountDto {
  @IsInt()
  @Min(1)
  @Max(100_00) // max $100 manual discount
  discount_amount_cents!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

@Controller("pos")
@UseGuards(LocationScopeGuard, StoreNetworkGuard)
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Post("orders")
  @Roles(POLICIES.ANY_STAFF)
  async createOrder(@Body() body: CreatePosOrderDto, @Req() req: Request) {
    return this.posService.createPosOrder({
      actorUserId: req.user!.userId,
      locationId: req.locationId!,
      fulfillmentType: body.fulfillment_type,
      orderSource: body.order_source as "POS" | "PHONE",
      items: body.items.map((i) => ({
        menuItemId: i.menu_item_id,
        quantity: i.quantity,
        modifierSelections: i.modifier_selections?.map((s) => ({
          modifierOptionId: s.modifier_option_id,
        })),
        specialInstructions: i.special_instructions,
      })),
      customerPhone: body.customer_phone,
      customerName: body.customer_name,
      paymentMethod: body.payment_method,
      amountTendered: body.amount_tendered,
      specialInstructions: body.special_instructions,
    });
  }

  @Get("orders")
  @Roles(POLICIES.ANY_STAFF)
  async listOrders(@Req() req: Request) {
    return this.posService.listPosOrders(req.locationId!);
  }

  @Post("orders/:id/discounts")
  @Roles(
    { userRoles: ["STAFF"], employeeRoles: ["MANAGER"] },
    "ADMIN",
  )
  async applyManualDiscount(
    @Param("id") orderId: string,
    @Body() body: ApplyManualDiscountDto,
    @Req() req: Request,
  ) {
    return this.posService.applyManualDiscount({
      orderId,
      locationId: req.locationId!,
      actorUserId: req.user!.userId,
      discountAmountCents: body.discount_amount_cents,
      reason: body.reason,
      description: body.description,
    });
  }
}
