import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsDateString,
  MaxLength,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { Request } from "express";
import { Public } from "../../common/decorators/roles.decorator";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { assertRequestLocationMatches } from "../../common/utils/location-ref";
import { extractClientIp } from "../../common/utils/store-ip";
import { RateLimiterService } from "../rate-limit/rate-limit.service";
import {
  DELIVERY_ADDRESS_LIMITS,
} from "./delivery-address";
import {
  DELIVERY_QUOTE_RATE_LIMIT,
  DELIVERY_QUOTE_RATE_WINDOW_MS,
} from "./delivery-pricing.constants";
import { DeliveryPricingService } from "./delivery-pricing.service";

class DeliveryAddressSnapshotDto {
  @IsString()
  @MaxLength(DELIVERY_ADDRESS_LIMITS.line1)
  line1!: string;

  @IsString()
  @MaxLength(DELIVERY_ADDRESS_LIMITS.city)
  city!: string;

  @IsString()
  @MaxLength(DELIVERY_ADDRESS_LIMITS.postalCode)
  postal_code!: string;
}

class CreateDeliveryQuoteDto {
  @IsString()
  location_id!: string;

  @ValidateNested()
  @Type(() => DeliveryAddressSnapshotDto)
  address_snapshot_json!: DeliveryAddressSnapshotDto;

  @IsOptional()
  @IsDateString()
  scheduled_for?: string;
}

@Controller("delivery")
export class DeliveryPricingController {
  constructor(
    private readonly deliveryPricing: DeliveryPricingService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Post("quote")
  @Public()
  @UseGuards(LocationScopeGuard)
  async quote(@Body() body: CreateDeliveryQuoteDto, @Req() req: Request) {
    const locationId = assertRequestLocationMatches(body.location_id, req);
    const clientIp = extractClientIp(req);
    const perIpLimit = await this.rateLimiter.check(
      `rate-limit:delivery-quote:ip:${clientIp || "unknown"}`,
      DELIVERY_QUOTE_RATE_LIMIT,
      DELIVERY_QUOTE_RATE_WINDOW_MS,
    );
    if (!perIpLimit.allowed) {
      throw new HttpException(
        {
          code: "DELIVERY_QUOTE_RATE_LIMITED",
          message: "Too many delivery estimate attempts. Please try again later.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.deliveryPricing.createQuote({
      locationId,
      addressSnapshotJson: body.address_snapshot_json,
      scheduledFor: body.scheduled_for,
    });
  }
}
