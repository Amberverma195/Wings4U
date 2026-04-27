import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ReviewsService } from "./reviews.service";

class CreateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  review_body?: string;
}

class AdminReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reply!: string;
}

class SetPublishDto {
  @IsBoolean()
  publish!: boolean;
}

class AdminListQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  has_reply?: string;
}

@Controller()
@UseGuards(LocationScopeGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post("orders/:orderId/order-items/:orderItemId/reviews")
  @Roles("CUSTOMER")
  async create(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Param("orderItemId", ParseUUIDPipe) orderItemId: string,
    @Body() body: CreateReviewDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.reviewsService.createReview({
      orderId,
      orderItemId,
      customerUserId: user.userId,
      rating: body.rating,
      reviewBody: body.review_body ?? null,
    });
  }

  @Get("orders/:orderId/reviews")
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async listForOrder(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.reviewsService.listByOrder(orderId, user.role, user.userId);
  }

  @Get("admin/reviews")
  @Roles("ADMIN")
  async adminList(@Query() query: AdminListQueryDto) {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const hasReply =
      query.has_reply === undefined
        ? undefined
        : query.has_reply === "true";
    return this.reviewsService.listAllForAdmin({
      limit: Number.isFinite(limit) ? limit : undefined,
      cursor: query.cursor,
      hasReply,
    });
  }

  @Post("admin/reviews/:id/reply")
  @Roles("ADMIN")
  async reply(
    @Param("id", ParseUUIDPipe) reviewId: string,
    @Body() body: AdminReplyDto,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.reviewsService.adminReply({
      reviewId,
      adminUserId: user.userId,
      reply: body.reply,
    });
  }

  @Post("admin/reviews/:id/publish")
  @Roles("ADMIN")
  async setPublish(
    @Param("id", ParseUUIDPipe) reviewId: string,
    @Body() body: SetPublishDto,
  ) {
    return this.reviewsService.setPublish({
      reviewId,
      publish: body.publish,
    });
  }
}
