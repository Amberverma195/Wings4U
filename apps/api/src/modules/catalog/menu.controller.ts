import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString } from "class-validator";
import type { Request } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Public } from "../../common/decorators/roles.decorator";
import { assertRequestLocationMatches } from "../../common/utils/location-ref";
import { getJwtSecret } from "../../common/utils/jwt-secret";
import { extractClientIp } from "../../common/utils/store-ip";
import { RATE_LIMITS } from "../rate-limit/rate-limit.policies";
import { RateLimiterService, rateLimitKeyPart } from "../rate-limit/rate-limit.service";
import { CatalogService } from "./catalog.service";

/**
 * The Next.js catalog fetches are cached by URL + headers, so they cannot
 * carry a per-visitor IP. They send this constant HMAC instead and share a
 * server budget rather than the per-IP budget of the Vercel egress address.
 */
export const CATALOG_SERVER_HEADER = "x-w4u-catalog-server";
const CATALOG_SERVER_CONTEXT = "w4u-catalog-server:v1";
const MENU_LIMIT_MESSAGE = "Too many menu requests.";

export function catalogServerSignature(): string {
  return createHmac("sha256", getJwtSecret()).update(CATALOG_SERVER_CONTEXT).digest("hex");
}

function isTrustedCatalogServer(req: Request): boolean {
  const header = req.headers[CATALOG_SERVER_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) return false;
  return timingSafeEqual(Buffer.from(value.toLowerCase(), "hex"), Buffer.from(catalogServerSignature(), "hex"));
}

class MenuQueryDto {
  @IsString()
  location_id!: string;

  @IsIn(["PICKUP", "DELIVERY"])
  fulfillment_type!: "PICKUP" | "DELIVERY";

  @IsOptional()
  @IsString()
  scheduled_for?: string;
}

@Controller()
export class MenuController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  private async enforceMenuLimit(req: Request, endpoint: "menu" | "wing-flavours"): Promise<void> {
    if (isTrustedCatalogServer(req)) {
      await this.rateLimiter.enforce(
        `rl:menu:${endpoint}:server`,
        RATE_LIMITS.menuTrustedServer,
        MENU_LIMIT_MESSAGE,
      );
      return;
    }
    await this.rateLimiter.enforce(
      `rl:menu:${endpoint}:ip:${rateLimitKeyPart(`ip:${extractClientIp(req) || "unknown"}`)}`,
      RATE_LIMITS.menuIp,
      MENU_LIMIT_MESSAGE,
    );
  }

  @Get("menu")
  @Public()
  @UseGuards(LocationScopeGuard)
  async getMenu(@Query() query: MenuQueryDto, @Req() req: Request) {
    await this.enforceMenuLimit(req, "menu");
    const locationId = assertRequestLocationMatches(query.location_id, req);
    return this.catalogService.getMenu(
      locationId,
      query.fulfillment_type,
      query.scheduled_for,
      req.user?.userId,
    );
  }

  @Get("menu/wing-flavours")
  @Public()
  @UseGuards(LocationScopeGuard)
  async getWingFlavours(@Req() req: Request) {
    await this.enforceMenuLimit(req, "wing-flavours");
    return this.catalogService.getWingFlavours(req.locationId!);
  }
}
