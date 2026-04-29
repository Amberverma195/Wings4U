import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import type { RefundMethod } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { WalletsService } from "../wallets/wallets.service";
import { PaymentsService } from "../payments/payments.service";

const REFUNDABLE_STATUSES = new Set([
  "COMPLETED",
  "DELIVERED",
  "PICKED_UP",
  "CANCELLED",
]);

interface CreateRefundRequestParams {
  orderId: string;
  locationId: string;
  requestedByUserId: string;
  amountCents: number;
  reason: string;
}

interface ApproveAndIssueParams {
  refundRequestId: string;
  approvedByUserId: string;
  refundMethod: RefundMethod;
  adminNotes?: string;
}

interface RejectRefundParams {
  refundRequestId: string;
  rejectedByUserId: string;
  adminNotes: string;
}

@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async createRefundRequest(params: CreateRefundRequestParams) {
    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
    });
    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (!REFUNDABLE_STATUSES.has(order.status)) {
      throw new BadRequestException(
        `Order status "${order.status}" is not eligible for a refund`,
      );
    }

    const existingRefunds = await this.prisma.refundRequest.findMany({
      where: {
        orderId: params.orderId,
        status: { in: ["PENDING", "APPROVED", "ISSUED"] },
      },
    });
    const alreadyRefundedOrPending = existingRefunds.reduce(
      (sum, r) => sum + r.amountCents,
      0,
    );

    const maxRefundable = order.finalPayableCents - alreadyRefundedOrPending;
    if (params.amountCents > maxRefundable) {
      throw new BadRequestException(
        `Requested amount (${params.amountCents}) exceeds refundable balance (${maxRefundable})`,
      );
    }

    if (params.amountCents <= 0) {
      throw new BadRequestException("Refund amount must be positive");
    }

    return this.prisma.refundRequest.create({
      data: {
        orderId: params.orderId,
        locationId: params.locationId,
        requestedByUserId: params.requestedByUserId,
        amountCents: params.amountCents,
        reasonText: params.reason,
        status: "PENDING",
      },
    });
  }

  async approveAndIssue(params: ApproveAndIssueParams) {
    const refund = await this.prisma.refundRequest.findUnique({
      where: { id: params.refundRequestId },
      include: { order: true },
    });
    if (!refund) {
      throw new NotFoundException("Refund request not found");
    }

    if (refund.status !== "PENDING") {
      throw new ConflictException(
        `Refund request is already "${refund.status}"`,
      );
    }

    const now = new Date();

    const issued = await this.prisma.refundRequest.update({
      where: { id: params.refundRequestId },
      data: {
        status: "ISSUED",
        refundMethod: params.refundMethod,
        approvedByUserId: params.approvedByUserId,
        approvedAt: now,
        issuedByUserId: params.approvedByUserId,
        issuedAt: now,
      },
    });

    if (params.refundMethod === "STORE_CREDIT") {
      await this.walletsService.credit({
        userId: refund.order.customerUserId,
        amountCents: refund.amountCents,
        reason: `Refund for order #${refund.order.orderNumber}`,
        entryType: "REFUND",
        orderId: refund.orderId,
        refundRequestId: refund.id,
        createdByUserId: params.approvedByUserId,
      });
    }

    if (
      params.refundMethod === "ORIGINAL_PAYMENT" ||
      params.refundMethod === "CASH"
    ) {
      await this.paymentsService.createPayment({
        orderId: refund.orderId,
        locationId: refund.locationId,
        transactionType: "REFUND",
        paymentMethod:
          params.refundMethod === "CASH" ? "CASH" : "CARD",
        signedAmountCents: -refund.amountCents,
        initiatedByUserId: params.approvedByUserId,
        createdByUserId: params.approvedByUserId,
      });
    }

    return issued;
  }

  // PRD §12.6: when a cancelled order has a remaining refundable balance
  // (net captured payments minus refunds > 0), open a PENDING refund_request
  // automatically. Idempotent: if one already exists (PENDING/APPROVED/ISSUED)
  // covering the remaining balance, no new row is created.
  async createForCancelledOrder(params: {
    orderId: string;
    locationId: string;
    initiatedByUserId: string | null;
    reasonText?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the order row for the duration of this transaction
      const order = await tx.order.findUniqueOrThrow({
        where: { id: params.orderId },
        select: { id: true },
      });

      const payments = await tx.orderPayment.findMany({
        where: {
          orderId: params.orderId,
          transactionStatus: "SUCCESS",
        },
        select: { signedAmountCents: true },
      });
      const netCapturedCents = payments.reduce(
        (sum, p) => sum + p.signedAmountCents,
        0,
      );
      if (netCapturedCents <= 0) return null;

      const existingRefunds = await tx.refundRequest.findMany({
        where: {
          orderId: params.orderId,
          status: { in: ["PENDING", "APPROVED", "ISSUED"] },
        },
        select: { amountCents: true },
      });
      const alreadyClaimedCents = existingRefunds.reduce(
        (sum, r) => sum + r.amountCents,
        0,
      );

      const remainingCents = netCapturedCents - alreadyClaimedCents;
      if (remainingCents <= 0) return null;

      return tx.refundRequest.create({
        data: {
          orderId: params.orderId,
          locationId: params.locationId,
          requestedByUserId: params.initiatedByUserId,
          amountCents: remainingCents,
          reasonText:
            params.reasonText ?? "Auto-created on order cancellation",
          status: "PENDING",
        },
      });
    });
  }

  async rejectRefund(params: RejectRefundParams) {
    const refund = await this.prisma.refundRequest.findUnique({
      where: { id: params.refundRequestId },
    });
    if (!refund) {
      throw new NotFoundException("Refund request not found");
    }

    if (refund.status !== "PENDING") {
      throw new ConflictException(
        `Refund request is already "${refund.status}"`,
      );
    }

    return this.prisma.refundRequest.update({
      where: { id: params.refundRequestId },
      data: {
        status: "REJECTED",
        rejectedByUserId: params.rejectedByUserId,
        rejectedAt: new Date(),
      },
    });
  }
}
