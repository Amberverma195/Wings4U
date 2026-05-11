import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { AdminMenuService } from "./admin-menu.service";

// ── Wing Flavours DTO ──

class CreateUpdateWingFlavourDto {
  @IsString()
  name!: string;

  @IsIn(["MILD", "MEDIUM", "HOT", "DRY_RUB"])
  category!: "MILD" | "MEDIUM" | "HOT" | "DRY_RUB";

  @IsInt()
  sort_order!: number;

  @IsBoolean()
  is_active!: boolean;
}

// ── Nested DTOs ──

class ModifierGroupRefDto {
  @IsString()
  id!: string;
}

class RemovableIngredientDto {
  @IsString()
  name!: string;

  @IsInt()
  sortOrder!: number;
}

class ScheduleWindowDto {
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week!: number;

  @IsString()
  time_from!: string;

  @IsString()
  time_to!: string;
}

// ── Item DTO ──

class CreateUpdateItemDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(0)
  base_price_cents!: number;

  @IsString()
  category_id!: string;

  @IsIn(["NORMAL", "LOW_STOCK", "UNAVAILABLE"])
  stock_status!: "NORMAL" | "LOW_STOCK" | "UNAVAILABLE";

  @IsBoolean()
  is_hidden!: boolean;

  @IsIn(["BOTH", "PICKUP", "DELIVERY"])
  allowed_fulfillment_type!: "BOTH" | "PICKUP" | "DELIVERY";

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModifierGroupRefDto)
  modifier_groups?: ModifierGroupRefDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RemovableIngredientDto)
  removable_ingredients?: RemovableIngredientDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleWindowDto)
  schedules?: ScheduleWindowDto[];
}

// ── Category DTO ──

class CreateUpdateCategoryDto {
  @IsString()
  name!: string;

  @IsInt()
  sort_order!: number;

  @IsBoolean()
  is_active!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  available_from_minutes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  available_until_minutes?: number | null;
}

// ── Controller ──

@Controller("admin/menu")
@UseGuards(LocationScopeGuard)
@Roles("ADMIN")
export class AdminMenuController {
  constructor(private readonly adminMenuService: AdminMenuService) {}

  // ── Categories ──

  @Get("categories")
  async listCategories(@Req() req: Request) {
    return this.adminMenuService.listCategories(req.locationId!);
  }

  @Post("categories")
  async createCategory(
    @Body() body: CreateUpdateCategoryDto,
    @Req() req: Request,
  ) {
    return this.adminMenuService.createCategory(req.locationId!, body);
  }

  @Put("categories/:id")
  async updateCategory(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreateUpdateCategoryDto,
    @Req() req: Request,
  ) {
    return this.adminMenuService.updateCategory(req.locationId!, id, body);
  }

  @Delete("categories/:id")
  async archiveCategory(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.adminMenuService.archiveCategory(req.locationId!, id);
  }

  // ── Modifier Groups (read-only for link/unlink) ──

  @Get("modifier-groups")
  async listModifierGroups(@Req() req: Request) {
    return this.adminMenuService.listModifierGroups(req.locationId!);
  }

  // ── Wing Flavours (Sauces) ──

  @Get("wing-flavours")
  async listWingFlavours(@Req() req: Request) {
    return this.adminMenuService.listWingFlavours(req.locationId!);
  }

  @Post("wing-flavours")
  async createWingFlavour(
    @Body() body: CreateUpdateWingFlavourDto,
    @Req() req: Request,
  ) {
    return this.adminMenuService.createWingFlavour(req.locationId!, body);
  }

  @Put("wing-flavours/:id")
  async updateWingFlavour(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreateUpdateWingFlavourDto,
    @Req() req: Request,
  ) {
    return this.adminMenuService.updateWingFlavour(req.locationId!, id, body);
  }

  @Delete("wing-flavours/:id")
  async archiveWingFlavour(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.adminMenuService.archiveWingFlavour(req.locationId!, id);
  }

  // ── Items ──

  @Get("items")
  async listItems(
    @Query("categoryId") categoryId: string,
    @Query("q") query: string,
    @Req() req: Request,
  ) {
    return this.adminMenuService.listItems(
      req.locationId!,
      categoryId,
      query,
    );
  }

  @Get("items/:id")
  async getItem(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.adminMenuService.getItem(req.locationId!, id);
  }

  @Post("items")
  async createItem(
    @Body() body: CreateUpdateItemDto,
    @Req() req: Request,
  ) {
    return this.adminMenuService.createItem(req.locationId!, body);
  }

  @Put("items/:id")
  async updateItem(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreateUpdateItemDto,
    @Req() req: Request,
  ) {
    return this.adminMenuService.updateItem(req.locationId!, id, body);
  }

  @Delete("items/:id")
  async deleteItem(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.adminMenuService.deleteItem(req.locationId!, id);
  }

  // ── Item Images ──

  @Post("items/:id/image")
  @UseInterceptors(FileInterceptor("image"))
  async uploadImage(
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: any,
    @Req() req: Request,
  ) {
    return this.adminMenuService.uploadImage(req.locationId!, id, file);
  }

  @Post("categories/:id/builder-image")
  @UseInterceptors(FileInterceptor("image"))
  async uploadBuilderCategoryImage(
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: any,
    @Req() req: Request,
  ) {
    return this.adminMenuService.uploadBuilderCategoryImage(
      req.locationId!,
      id,
      file,
    );
  }

  @Delete("items/:id/image")
  async deleteImage(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.adminMenuService.deleteImage(req.locationId!, id);
  }
}
