import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString } from "class-validator";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Public } from "../../common/decorators/roles.decorator";
import { assertRequestLocationMatches } from "../../common/utils/location-ref";
import { CatalogService } from "./catalog.service";

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
  constructor(private readonly catalogService: CatalogService) {}

  @Get("menu")
  @Public()
  @UseGuards(LocationScopeGuard)
  async getMenu(@Query() query: MenuQueryDto, @Req() req: Request) {
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
    return this.catalogService.getWingFlavours(req.locationId!);
  }
}
