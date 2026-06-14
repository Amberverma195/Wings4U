import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
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
import { Public, Roles } from "../../common/decorators/roles.decorator";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { assertRequestLocationMatches } from "../../common/utils/location-ref";
import { StripePaymentsService } from "./stripe-payments.service";

type StripeWebhookRequest = Request & { rawBody?: Buffer };

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

class StripeCheckoutItemDto {
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

class CreateStripePaymentIntentDto {
  @IsString()
  location_id!: string;

  @IsIn(["PICKUP", "DELIVERY"])
  fulfillment_type!: "PICKUP" | "DELIVERY";

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StripeCheckoutItemDto)
  items!: StripeCheckoutItemDto[];

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

  @IsOptional()
  @IsBoolean()
  apply_wings_reward?: boolean;
}

@Controller("payments/stripe")
export class StripePaymentsController {
  constructor(private readonly stripePaymentsService: StripePaymentsService) {}

  @Get("config")
  @Public()
  getConfig() {
    return this.stripePaymentsService.getPublicConfig();
  }

  @Post("webhook")
  @Public()
  handleWebhook(
    @Req() req: StripeWebhookRequest,
    @Headers("stripe-signature") signature?: string,
  ) {
    return this.stripePaymentsService.handleWebhook({
      rawBody: req.rawBody,
      signature,
    });
  }

  @Post("payment-intent")
  @Roles("CUSTOMER")
  @UseGuards(LocationScopeGuard)
  async createPaymentIntent(
    @Body() body: CreateStripePaymentIntentDto,
    @Req() req: Request,
  ) {
    const locationId = assertRequestLocationMatches(body.location_id, req);

    return this.stripePaymentsService.createCheckoutPaymentIntent({
      userId: req.user!.userId,
      locationId,
      fulfillmentType: body.fulfillment_type,
      items: body.items,
      promoCode: body.promo_code,
      driverTipCents: body.driver_tip_cents,
      walletAppliedCents: body.wallet_applied_cents,
      scheduledFor: body.scheduled_for,
      applyWingsReward: body.apply_wings_reward,
    });
  }
}
