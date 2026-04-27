import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { PromotionsService } from "./promotions.service";
import type { Request } from "express";
import { Public } from "../../common/decorators/roles.decorator";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";

@Controller("promotions")
@UseGuards(LocationScopeGuard)
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get("active")
  @Public()
  async getActivePromos(@Req() req: Request) {
    return this.promotionsService.getActivePromos(req.locationId!);
  }
}
