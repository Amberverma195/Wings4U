import { Body, Controller, Post, Req, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Public } from "../../common/decorators/roles.decorator";
import { CartService } from "./cart.service";

class ModifierSelectionDto {
  @IsUUID()
  modifier_option_id!: string;
}

class RemovedIngredientDto {
  @IsUUID()
  id!: string;

  @IsString()
  name!: string;
}

class CartItemDto {
  @IsUUID()
  menu_item_id!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModifierSelectionDto)
  modifier_selections?: ModifierSelectionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RemovedIngredientDto)
  removed_ingredients?: RemovedIngredientDto[];

  @IsOptional()
  @IsString()
  special_instructions?: string;

  @IsOptional()
  @IsObject()
  builder_payload?: Record<string, unknown>;
}

class CartQuoteDto {
  @IsUUID()
  location_id!: string;

  @IsIn(["PICKUP", "DELIVERY"])
  fulfillment_type!: "PICKUP" | "DELIVERY";

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];

  @IsOptional()
  @IsString()
  promo_code?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  driver_tip_cents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  wallet_applied_cents?: number;

  @IsOptional()
  @IsString()
  scheduled_for?: string;

  /**
   * When true, the signed-in customer wants to redeem their wings-rewards
   * stamp card ("Get 1lb of wings free"). The quote re-validates — it must
   * find 8+ available stamps AND >=1lb of wings in the cart — and returns
   * the preview discount. No state is mutated on quote; the actual stamp
   * decrement happens in checkout.
   */
  @IsOptional()
  @IsBoolean()
  apply_wings_reward?: boolean;
}

@Controller("cart")
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Post("quote")
  @Public()
  @UseGuards(LocationScopeGuard)
  async quote(@Body() body: CartQuoteDto, @Req() req: Request) {
    if (body.location_id !== req.locationId) {
      throw new UnprocessableEntityException({
        message: "location_id must match X-Location-Id",
        field: "location_id",
      });
    }

    return this.cartService.computeQuote(
      body.location_id,
      body.fulfillment_type,
      body.items,
      body.promo_code,
      body.driver_tip_cents,
      body.wallet_applied_cents,
      body.scheduled_for,
      req.user?.userId,
      body.apply_wings_reward,
    );
  }
}
