import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { Type } from "class-transformer";
import type { Request } from "express";
import { TicketResolutionType } from "@prisma/client";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { SUPPORT_TICKET_TYPES, type SupportTicketType } from "./support.constants";
import { SupportService } from "./support.service";

class CreateTicketDto {
  @IsIn([...SUPPORT_TICKET_TYPES])
  ticket_type!: SupportTicketType;

  @IsString()
  subject!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsUUID()
  order_id?: string;

  @IsOptional()
  @IsEnum(["LOW", "NORMAL", "HIGH", "URGENT"])
  priority?: string;
}

class AddMessageDto {
  @IsString()
  message_body!: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_internal_note?: boolean;
}

class UpdateStatusDto {
  @IsEnum(["OPEN", "IN_REVIEW", "WAITING_ON_CUSTOMER", "RESOLVED", "CLOSED"])
  status!: string;
}

class ResolveTicketDto {
  @IsEnum(TicketResolutionType)
  resolution_type!: TicketResolutionType;

  @IsString()
  notes!: string;
}

class ListTicketsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

@Controller("support/tickets")
@UseGuards(LocationScopeGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post()
  @Roles("CUSTOMER")
  async create(
    @Body() body: CreateTicketDto,
    @Req() req: Request,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.supportService.createTicket({
      locationId: req.locationId!,
      customerUserId: user.userId,
      ticketType: body.ticket_type,
      subject: body.subject,
      description: body.description,
      createdSource: "CUSTOMER_APP",
      orderId: body.order_id,
      priority: body.priority,
    });
  }

  @Get()
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async list(
    @Query() query: ListTicketsQueryDto,
    @Req() req: Request,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return this.supportService.listTickets({
      locationId: req.locationId,
      customerUserId: user.role === "CUSTOMER" ? user.userId : undefined,
      status: query.status,
      cursor: query.cursor,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  }

  @Get(":id")
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async getOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.supportService.getTicket(id, user.role, user.userId);
  }

  @Post(":id/messages")
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async addMessage(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: AddMessageDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    const isInternalNote =
      body.is_internal_note === true && user.role !== "CUSTOMER";
    return this.supportService.addMessage(
      id,
      user.userId,
      body.message_body,
      isInternalNote,
      user.role,
    );
  }

  @Post(":id/status")
  @Roles("STAFF", "ADMIN")
  async updateStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateStatusDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.supportService.updateStatus(id, user.userId, body.status);
  }

  @Post(":id/resolutions")
  @Roles("STAFF", "ADMIN")
  async resolve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ResolveTicketDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.supportService.resolve(
      id,
      user.userId,
      body.resolution_type,
      body.notes,
    );
  }
}
