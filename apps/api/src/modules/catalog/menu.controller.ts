import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import { UnprocessableEntityException } from "@nestjs/common";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Public } from "../../common/decorators/roles.decorator";
import { CatalogService } from "./catalog.service";

class MenuQueryDto {
  @IsUUID()
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
    if (query.location_id !== req.locationId) {
      throw new UnprocessableEntityException({
        message: "location_id must match X-Location-Id",
        field: "location_id",
      });
    }
    return this.catalogService.getMenu(
      query.location_id,
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
