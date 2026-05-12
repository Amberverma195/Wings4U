import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsEnum, IsOptional, IsString } from "class-validator";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { PrismaService } from "../../database/prisma.service";
import { ChatService } from "./chat.service";

class SendMessageDto {
  @IsString()
  message_body!: string;

  @IsOptional()
  @IsEnum(["BOTH", "STAFF_ONLY"])
  visibility?: "BOTH" | "STAFF_ONLY";
}

class ChatMessagesQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

@Controller("orders/:orderId/chat")
@UseGuards(LocationScopeGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async getMessages(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Query() query: ChatMessagesQueryDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    await this.verifyOrderAccess(orderId, user);
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return this.chatService.getMessages(
      orderId,
      user.role,
      user.userId,
      query.cursor,
      Number.isFinite(limit) ? limit : undefined,
    );
  }

  @Post()
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async sendMessage(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: SendMessageDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    await this.verifyOrderAccess(orderId, user);
    const senderSurface = this.chatService.deriveSenderSurface(
      user.role,
      user.employeeRole,
    );
    return this.chatService.sendMessage(
      orderId,
      user.userId,
      senderSurface,
      body.message_body,
      body.visibility ?? "BOTH",
    );
  }

  @Post("read")
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async markRead(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    await this.verifyOrderAccess(orderId, user);
    return this.chatService.markRead(orderId, user.userId, user.role);
  }

  private async verifyOrderAccess(
    orderId: string,
    user: NonNullable<Request["user"]>,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { customerUserId: true, assignedDriverUserId: true },
    });

    if (!order) {
      throw new ForbiddenException("You do not have access to this order");
    }

    if (user.role === "CUSTOMER") {
      if (order.customerUserId !== user.userId) {
        throw new ForbiddenException("You do not have access to this order");
      }
      return;
    }

    if (
      user.role === "STAFF" &&
      user.employeeRole === "DRIVER" &&
      order.assignedDriverUserId !== user.userId
    ) {
      throw new ForbiddenException("You do not have access to this order");
    }
  }
}
