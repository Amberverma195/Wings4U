import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { assertRequestLocationMatches } from "../../common/utils/location-ref";
import { AuthService } from "../auth/auth.service";
import { CheckoutService } from "./checkout.service";

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

class CheckoutItemDto {
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

class PlaceOrderDto {
  @IsString()
  location_id!: string;

  @IsIn(["PICKUP", "DELIVERY"])
  fulfillment_type!: "PICKUP" | "DELIVERY";

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];

  @IsOptional()
  @IsString()
  scheduled_for?: string;

  @IsOptional()
  @IsIn(["HAND_TO_ME", "LEAVE_AT_DOOR", "CALL_ON_ARRIVAL", "TEXT_ON_ARRIVAL"])
  contactless_pref?: string;

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
  special_instructions?: string;

  @IsOptional()
  @IsObject()
  address_snapshot_json?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  delivery_quote_token?: string;

  @IsOptional()
  @IsBoolean()
  is_student_order?: boolean;

  @IsOptional()
  @IsString()
  student_id_snapshot?: string;

  /**
   * When true, redeem the customer's wings-rewards "1lb free" card:
   * atomically decrement 8 stamps + apply the cheapest-1lb discount to
   * the order. Throws 422 if the user no longer has 8 stamps or no wings
   * are in the cart (re-validated server-side; the client must not be
   * trusted to gate this).
   */
  @IsOptional()
  @IsBoolean()
  apply_wings_reward?: boolean;

  @IsOptional()
  @IsString()
  promo_code?: string;

  @IsOptional()
  @IsIn(["PAY_AT_STORE", "ONLINE_CARD"])
  payment_method?: "PAY_AT_STORE" | "ONLINE_CARD";

  @IsOptional()
  @IsString()
  stripe_payment_intent_id?: string;
}

@Controller("checkout")
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  @Roles("CUSTOMER")
  @UseGuards(LocationScopeGuard)
  async checkout(
    @Body() body: PlaceOrderDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key header is required");
    }

    const profileComplete = await this.authService.isCustomerProfileComplete(req.user!.userId);
    if (!profileComplete) {
      throw new ForbiddenException({
        message: "Customer profile is incomplete",
        code: "PROFILE_INCOMPLETE",
      });
    }

    const locationId = assertRequestLocationMatches(body.location_id, req);

    return this.checkoutService.placeOrder({
      userId: req.user!.userId,
      locationId,
      fulfillmentType: body.fulfillment_type,
      items: body.items.map((item) => ({
        menuItemId: item.menu_item_id,
        quantity: item.quantity,
        modifierSelections: item.modifier_selections?.map((selection) => ({
          modifierOptionId: selection.modifier_option_id,
        })),
        removedIngredients: item.removed_ingredients,
        specialInstructions: item.special_instructions,
        builderPayload: item.builder_payload,
      })),
      scheduledFor: body.scheduled_for,
      contactlessPref: body.contactless_pref,
      driverTipCents: body.driver_tip_cents,
      walletAppliedCents: body.wallet_applied_cents,
      specialInstructions: body.special_instructions,
      idempotencyKey,
      addressSnapshotJson: body.address_snapshot_json,
      isStudentOrder: body.is_student_order,
      studentIdSnapshot: body.student_id_snapshot,
      applyWingsReward: body.apply_wings_reward,
      promoCode: body.promo_code,
      paymentMethod: body.payment_method,
      stripePaymentIntentId: body.stripe_payment_intent_id,
      deliveryQuoteToken: body.delivery_quote_token,
    });
  }
}
