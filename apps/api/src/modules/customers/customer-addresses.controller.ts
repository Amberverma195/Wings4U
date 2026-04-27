import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import type { Request } from "express";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CustomerAddressesService } from "./customer-addresses.service";

class CreateCustomerAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  line1!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  postal_code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string | null;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

class UpdateCustomerAddressDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  line1?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  postal_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string | null;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

/**
 * Persistent address book for signed-in customers. No location scope — a
 * user's saved addresses follow them across locations/devices. Admins can
 * read/write their own rows here too (useful when testing end-to-end), but
 * they cannot reach another user's rows: ownership is enforced in the
 * service via the current user id.
 */
@Controller("customer/addresses")
export class CustomerAddressesController {
  constructor(private readonly service: CustomerAddressesService) {}

  @Get()
  @Roles("CUSTOMER", "ADMIN")
  async list(@CurrentUser() user: NonNullable<Request["user"]>) {
    const items = await this.service.list(user.userId);
    return { items };
  }

  @Post()
  @Roles("CUSTOMER", "ADMIN")
  async create(
    @Body() body: CreateCustomerAddressDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.service.upsert(user.userId, {
      line1: body.line1,
      city: body.city,
      postalCode: body.postal_code,
      label: body.label ?? null,
      isDefault: body.is_default ?? false,
    });
  }

  @Patch(":id")
  @Roles("CUSTOMER", "ADMIN")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateCustomerAddressDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.service.update(user.userId, id, {
      line1: body.line1,
      city: body.city,
      postalCode: body.postal_code,
      label: body.label,
      isDefault: body.is_default,
    });
  }

  @Delete(":id")
  @Roles("CUSTOMER", "ADMIN")
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    await this.service.remove(user.userId, id);
    return { deleted: true };
  }
}
