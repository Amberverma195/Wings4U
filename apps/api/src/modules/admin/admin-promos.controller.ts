import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { AdminPromosService } from "./admin-promos.service";

class BxgyRuleDto {
  @IsOptional()
  @IsString()
  qualifyingProductId?: string;

  @IsOptional()
  @IsString()
  qualifyingCategoryId?: string;

  @IsNumber()
  requiredQty!: number;

  @IsOptional()
  @IsString()
  rewardProductId?: string;

  @IsOptional()
  @IsString()
  rewardCategoryId?: string;

  @IsNumber()
  rewardQty!: number;

  @IsString()
  rewardRule!: string;
}

class CreateUpdatePromoDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsIn(["PERCENT", "FIXED_AMOUNT", "BXGY", "FREE_DELIVERY"])
  discountType!: "PERCENT" | "FIXED_AMOUNT" | "BXGY" | "FREE_DELIVERY";

  @IsNumber()
  discountValue!: number;

  @IsNumber()
  minSubtotalCents!: number;

  @IsOptional()
  startsAt?: Date;

  @IsOptional()
  endsAt?: Date;

  @IsBoolean()
  isOneTimePerCustomer!: boolean;

  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => BxgyRuleDto)
  bxgyRule?: BxgyRuleDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productTargets?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryTargets?: string[];
}

class FirstOrderDealDto {
  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  freeDelivery!: boolean;

  @IsOptional()
  @IsNumber()
  percentOff?: number | null;

  @IsOptional()
  @IsNumber()
  fixedAmountCents?: number | null;
}

@Controller("admin/promos")
@UseGuards(LocationScopeGuard)
@Roles("ADMIN")
export class AdminPromosController {
  constructor(private readonly adminPromosService: AdminPromosService) {}

  @Get("first-order-deal")
  async getFirstOrderDeal(@Req() req: Request) {
    return this.adminPromosService.getFirstOrderDeal(req.locationId!);
  }

  @Put("first-order-deal")
  async updateFirstOrderDeal(
    @Body() body: FirstOrderDealDto,
    @Req() req: Request,
  ) {
    return this.adminPromosService.updateFirstOrderDeal(req.locationId!, body);
  }

  @Get()
  async listPromos(@Req() req: Request) {
    return this.adminPromosService.listPromos(req.locationId!);
  }

  @Get(":id")
  async getPromo(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.adminPromosService.getPromo(req.locationId!, id);
  }

  @Post()
  async createPromo(@Body() body: CreateUpdatePromoDto, @Req() req: Request) {
    return this.adminPromosService.createPromo(req.locationId!, body);
  }

  @Put(":id")
  async updatePromo(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreateUpdatePromoDto,
    @Req() req: Request,
  ) {
    return this.adminPromosService.updatePromo(req.locationId!, id, body);
  }

  @Delete(":id")
  async deletePromo(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.adminPromosService.deletePromo(req.locationId!, id);
  }
}
