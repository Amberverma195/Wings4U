import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { IsInt, IsString, Min } from "class-validator";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RefundService } from "./refund.service";

class CreateRefundRequestDto {
  @IsInt()
  @Min(1)
  amount_cents!: number;

  @IsString()
  reason!: string;
}

@Controller("orders/:orderId/refund-request")
@UseGuards(LocationScopeGuard)
export class RefundController {
  constructor(private readonly refundService: RefundService) {}

  @Post()
  @Roles("CUSTOMER", "STAFF")
  async create(
    @Param("orderId") orderId: string,
    @Req() req: Request,
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Body() body: CreateRefundRequestDto,
  ) {
    const refund = await this.refundService.createRefundRequest({
      orderId,
      locationId: req.locationId!,
      requestedByUserId: user.userId,
      amountCents: body.amount_cents,
      reason: body.reason,
    });

    return {
      id: refund.id,
      order_id: refund.orderId,
      location_id: refund.locationId,
      requested_by_user_id: refund.requestedByUserId,
      amount_cents: refund.amountCents,
      reason_text: refund.reasonText,
      status: refund.status,
      created_at: refund.createdAt,
    };
  }
}
