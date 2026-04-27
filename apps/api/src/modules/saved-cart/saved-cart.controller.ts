import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { Request, Response } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Public } from "../../common/decorators/roles.decorator";
import { SavedCartService } from "./saved-cart.service";
import {
  clearGuestTokenCookie,
  setGuestTokenCookie,
} from "./guest-cart-cookie";

class ModifierSelectionBody {
  @IsUUID()
  modifier_option_id!: string;

  @IsString()
  group_name!: string;

  @IsString()
  option_name!: string;

  @IsInt()
  price_delta_cents!: number;
}

class RemovedIngredientBody {
  @IsUUID()
  id!: string;

  @IsString()
  name!: string;
}

class CartItemBody {
  @IsString()
  key!: string;

  @IsUUID()
  menu_item_id!: string;

  @IsOptional()
  @IsString()
  menu_item_slug?: string | null;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  image_url?: string | null;

  @IsInt()
  @Min(0)
  base_price_cents!: number;

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModifierSelectionBody)
  modifier_selections!: ModifierSelectionBody[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RemovedIngredientBody)
  removed_ingredients!: RemovedIngredientBody[];

  @IsString()
  special_instructions!: string;

  @IsOptional()
  @IsObject()
  builder_payload?: Record<string, unknown> | null;
}

class SaveCartBody {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CartItemBody)
  items!: CartItemBody[];

  @IsIn(["PICKUP", "DELIVERY"])
  fulfillment_type!: "PICKUP" | "DELIVERY";

  @IsString()
  location_timezone!: string;

  @IsOptional()
  @IsString()
  scheduled_for?: string | null;

  @IsIn(["none", "10", "15", "20"])
  driver_tip_percent!: "none" | "10" | "15" | "20";
}

/**
 * Persisted-cart endpoints. Completely separate from POST /cart/quote which
 * remains the single source of truth for pricing — GET here just returns
 * what the client last saved, PUT just stores what the client gives us. The
 * checkout flow re-prices server-side; never trust saved prices.
 */
@Controller("cart")
export class SavedCartController {
  constructor(private readonly savedCartService: SavedCartService) {}

  @Get("me")
  @Public()
  @UseGuards(LocationScopeGuard)
  async getMyCart(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { snapshot, cookies } = await this.savedCartService.getForRequest(
      req,
      req.locationId!,
    );
    applyCookies(res, cookies);
    return snapshot;
  }

  @Put("me")
  @Public()
  @UseGuards(LocationScopeGuard)
  async saveMyCart(
    @Body() body: SaveCartBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { snapshot, cookies } = await this.savedCartService.saveForRequest(
      req,
      req.locationId!,
      {
        items: body.items.map((item) => ({
          key: item.key,
          menu_item_id: item.menu_item_id,
          menu_item_slug: item.menu_item_slug ?? null,
          name: item.name,
          image_url: item.image_url ?? null,
          base_price_cents: item.base_price_cents,
          quantity: item.quantity,
          modifier_selections: item.modifier_selections,
          removed_ingredients: item.removed_ingredients,
          special_instructions: item.special_instructions,
          builder_payload: item.builder_payload ?? null,
        })),
        fulfillment_type: body.fulfillment_type,
        location_timezone: body.location_timezone,
        scheduled_for: body.scheduled_for ?? null,
        driver_tip_percent: body.driver_tip_percent,
      },
    );
    applyCookies(res, cookies);
    return snapshot;
  }

  @Delete("me")
  @Public()
  @UseGuards(LocationScopeGuard)
  async clearMyCart(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { cookies } = await this.savedCartService.clearForRequest(
      req,
      req.locationId!,
    );
    applyCookies(res, cookies);
    return { cleared: true };
  }

  @Post("merge")
  @Public()
  @UseGuards(LocationScopeGuard)
  async mergeOnLogin(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { snapshot, mergeOutcome, cookies } =
      await this.savedCartService.mergeOnLogin(req, req.locationId!);
    applyCookies(res, cookies);
    return { snapshot, merge_outcome: mergeOutcome };
  }
}

function applyCookies(
  res: Response,
  cookies: Array<
    | { action: "set"; name: string; token: string }
    | { action: "clear"; name: string }
  >,
): void {
  for (const cookie of cookies) {
    if (cookie.action === "set") {
      setGuestTokenCookie(res, cookie.token);
    } else {
      clearGuestTokenCookie(res);
    }
  }
}
