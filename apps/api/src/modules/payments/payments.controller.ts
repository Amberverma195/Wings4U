import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
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
}

export class RecordCollectionDto {
  @IsIn(["CASH", "CARD"])
  method!: "CASH" | "CARD";

  @IsIn(["SUCCESS", "DECLINED", "CANCELLED", "FAILED", "NOT_COLLECTED"])
  outcome!: "SUCCESS" | "DECLINED" | "CANCELLED" | "FAILED" | "NOT_COLLECTED";

  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amount_cents!: number;

  @IsIn(["STORE", "DRIVER"])
  collected_by!: "STORE" | "DRIVER";

  @IsOptional()
  @IsString()
  @MaxLength(64)
  terminal_reference?: string;

  @IsOptional()
  @IsBoolean()
  reference_unavailable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsString()
  @Length(8, 100)
  idempotency_key!: string;
}

@Controller("orders/:orderId/payments")
@UseGuards(LocationScopeGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /** Manual ledger corrections. Refunds go through the refund request flow. */
  @Post()
  @Roles("ADMIN")
  async create(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Req() req: Request,
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Body() body: CreatePaymentDto,
  ) {
    if (body.transaction_type === "REFUND") {
      throw new UnprocessableEntityException({
        message: "Refunds must be issued through a refund request.",
        field: "transaction_type",
      });
    }

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
      initiatedByUserId: user.userId,
      createdByUserId: user.userId,
      actorRole: "ADMIN",
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

  @Post("collect")
  @Roles(
    { userRoles: ["STAFF"], employeeRoles: ["MANAGER", "CASHIER", "DRIVER"] },
    "ADMIN",
  )
  async collect(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Req() req: Request,
    @CurrentUser() user: NonNullable<Request["user"]>,
    @Body() body: RecordCollectionDto,
  ) {
    const result = await this.paymentsService.recordCollection({
      orderId,
      locationId: req.locationId!,
      method: body.method,
      outcome: body.outcome,
      amountCents: body.amount_cents,
      collectedBy: body.collected_by,
      terminalReference: body.terminal_reference,
      referenceUnavailable: body.reference_unavailable,
      note: body.note,
      idempotencyKey: body.idempotency_key,
      actor: {
        userId: user.userId,
        role: user.role === "ADMIN" ? "ADMIN" : "STAFF",
        employeeRole: user.role === "STAFF" ? user.employeeRole ?? null : null,
      },
    });
    const view = await this.paymentsService.getStaffPaymentView(
      orderId,
      req.locationId!,
    );
    return { ...view, replayed: result.replayed };
  }

  @Get()
  @Roles("CUSTOMER", "STAFF", "ADMIN")
  async list(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Req() req: Request,
    @CurrentUser() user: NonNullable<Request["user"]>,
  ) {
    return this.paymentsService.getPaymentsForViewer(orderId, {
      userId: user.userId,
      role: user.role,
      locationId: req.locationId!,
    });
  }
}
