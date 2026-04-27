import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from "class-validator";
import type { Request } from "express";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { PaymentsService } from "./payments.service";

class CreatePaymentDto {
  @IsIn(["AUTH", "CAPTURE", "VOID", "REFUND", "ADJUSTMENT"])
  transaction_type!: string;

  @IsIn(["CASH", "CARD", "STORE_CREDIT", "WAIVED"])
  payment_method!: string;

  @IsInt()
  @Min(1)
  signed_amount_cents!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  provider_transaction_id?: string;

  @IsOptional()
  processor_payload_json?: unknown;

  @IsOptional()
  @IsUUID()
  initiated_by_user_id?: string;
}

@Controller("orders/:orderId/payments")
@UseGuards(LocationScopeGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @Roles("STAFF", "ADMIN")
  async create(
    @Param("orderId") orderId: string,
    @Req() req: Request,
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Body() body: CreatePaymentDto,
  ) {
    const payment = await this.paymentsService.createPayment({
      orderId,
      locationId: req.locationId!,
      transactionType: body.transaction_type as never,
      paymentMethod: body.payment_method as never,
      signedAmountCents: body.signed_amount_cents,
      currency: body.currency,
      provider: body.provider,
      providerTransactionId: body.provider_transaction_id,
      processorPayloadJson: body.processor_payload_json,
      initiatedByUserId: body.initiated_by_user_id ?? user.userId,
      createdByUserId: user.userId,
    });

    return {
      id: payment.id,
      order_id: payment.orderId,
      location_id: payment.locationId,
      transaction_type: payment.transactionType,
      transaction_status: payment.transactionStatus,
      payment_method: payment.paymentMethod,
      signed_amount_cents: payment.signedAmountCents,
      currency: payment.currency,
      provider: payment.provider,
      provider_transaction_id: payment.providerTransactionId,
      created_at: payment.createdAt,
    };
  }

  @Get()
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async list(@Param("orderId") orderId: string) {
    const payments = await this.paymentsService.getPaymentsForOrder(orderId);

    return {
      payments: payments.map((p) => ({
        id: p.id,
        order_id: p.orderId,
        location_id: p.locationId,
        transaction_type: p.transactionType,
        transaction_status: p.transactionStatus,
        payment_method: p.paymentMethod,
        signed_amount_cents: p.signedAmountCents,
        currency: p.currency,
        provider: p.provider,
        provider_transaction_id: p.providerTransactionId,
        created_at: p.createdAt,
      })),
    };
  }
}
