import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
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
import { PosStationGuard } from "../../common/guards/pos-station.guard";
import { Public } from "../../common/decorators/roles.decorator";
import { PosService } from "./pos.service";

class PosModifierSelectionDto {
  @IsOptional()
  @IsUUID()
  modifier_option_id?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  price_delta_cents?: number;
}

class PosRemovedIngredientDto {
  @IsUUID()
  id!: string;

  @IsString()
  name!: string;
}

class PosOrderItemDto {
  @IsOptional()
  @IsUUID()
  menu_item_id?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  unit_price_cents?: number;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosModifierSelectionDto)
  modifier_selections?: PosModifierSelectionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosRemovedIngredientDto)
  removed_ingredients?: PosRemovedIngredientDto[];

  @IsOptional()
  @IsObject()
  builder_payload?: Record<string, unknown>;

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

  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsIn(["CASH", "CARD_TERMINAL", "STORE_CREDIT"])
  payment_method!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amount_tendered?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_00)
  discount_amount_cents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  discount_reason?: string;

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

/**
 * POS business endpoints.
 *
 * POS is a station-gated surface, not an account-gated one — `@Public()`
 * tells the global `AuthGuard` not to require an `access_token` cookie,
 * and the layered guards below enforce:
 *   1. `LocationScopeGuard`  - requires `X-Location-Id` header.
 *   2. `StoreNetworkGuard`   - request originates from the configured store IP.
 *   3. `PosStationGuard`     - valid `w4u_pos_session` cookie for that location.
 *
 * Because POS no longer has manager/admin identity, station-originated POS
 * actions (including manual discounts) pass `actorUserId: null` into the
 * service layer; audit rows attribute the action to "POS_STATION" via
 * `actor_role_snapshot` rather than a user id.
 */
@Controller("pos")
@Public()
@UseGuards(LocationScopeGuard, StoreNetworkGuard, PosStationGuard)
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Post("orders")
  async createOrder(@Body() body: CreatePosOrderDto, @Req() req: Request) {
    return this.posService.createPosOrder({
      actorUserId: null,
      locationId: req.locationId!,
      fulfillmentType: body.fulfillment_type,
      orderSource: body.order_source as "POS" | "PHONE",
      items: body.items.map((i) => ({
        menuItemId: i.menu_item_id,
        name: i.name,
        unitPriceCents: i.unit_price_cents,
        quantity: i.quantity,
        modifierSelections: i.modifier_selections?.map((s) => ({
          modifierOptionId: s.modifier_option_id,
          name: s.name,
          priceDeltaCents: s.price_delta_cents,
        })),
        removedIngredients: i.removed_ingredients,
        builderPayload: i.builder_payload ?? undefined,
        specialInstructions: i.special_instructions,
      })),
      customerPhone: body.customer_phone,
      customerName: body.customer_name,
      customerId: body.customer_id,
      paymentMethod: body.payment_method,
      amountTendered: body.amount_tendered,
      discountAmountCents: body.discount_amount_cents,
      discountReason: body.discount_reason,
      specialInstructions: body.special_instructions,
    });
  }

  @Get("orders")
  async listOrders(@Req() req: Request) {
    return this.posService.listPosOrders(req.locationId!);
  }

  @Get("staff")
  async listStaff(@Req() req: Request) {
    return this.posService.listStaff(req.locationId!);
  }

  @Get("customer-lookup")
  async lookupCustomer(@Query("phone") phone: string) {
    return this.posService.lookupCustomer(phone);
  }

  @Post("orders/:id/discounts")
  async applyManualDiscount(
    @Param("id") orderId: string,
    @Body() body: ApplyManualDiscountDto,
    @Req() req: Request,
  ) {
    return this.posService.applyManualDiscount({
      orderId,
      locationId: req.locationId!,
      actorUserId: null,
      discountAmountCents: body.discount_amount_cents,
      reason: body.reason,
      description: body.description,
    });
  }
}
