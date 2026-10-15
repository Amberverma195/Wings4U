import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { RefundMethod } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { WalletsService } from "../wallets/wallets.service";
import { PaymentsService } from "../payments/payments.service";
import { netCollectedCents } from "../payments/payment-policy";

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
  requesterRole: "CUSTOMER" | "STAFF" | "ADMIN";
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

    if (order.locationId !== params.locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }

    if (
      params.requesterRole === "CUSTOMER" &&
      order.customerUserId !== params.requestedByUserId
    ) {
      throw new ForbiddenException("You do not have access to this order");
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
    const returnsCollectedFunds =
      params.refundMethod === "ORIGINAL_PAYMENT" || params.refundMethod === "CASH";

    // The status transition, wallet credit and payment-ledger row all commit
    // together. If any accounting write fails the ISSUED transition rolls back
    // too, so a refund request can never show ISSUED without its matching
    // ledger entry. The transition itself is claimed with a guarded
    // updateMany so two concurrent approvals cannot both issue (double-refund).
    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refundRequest.findUnique({
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

      // Store credit lands in a customer's wallet, so it requires a real
      // account. Guest orders (e.g. anonymous walk-in POS) have no
      // `customer_user_id`; those must be refunded as cash / original payment.
      if (params.refundMethod === "STORE_CREDIT" && !refund.order.customerUserId) {
        throw new BadRequestException(
          "Store credit requires a registered customer. Refund this guest order as cash or to the original payment method.",
        );
      }

      if (returnsCollectedFunds) {
        const successful = await tx.orderPayment.findMany({
          where: { orderId: refund.orderId, transactionStatus: "SUCCESS" },
          select: { transactionType: true, signedAmountCents: true },
        });
        const collected = netCollectedCents(successful);
        if (refund.amountCents > collected) {
          throw new BadRequestException(
            `Only ${collected} cents has been collected for this order. Record the collection first or refund as store credit.`,
          );
        }
      }

      const now = new Date();

      // Atomic claim: only the transaction that flips PENDING→ISSUED proceeds.
      const claimed = await tx.refundRequest.updateMany({
        where: { id: params.refundRequestId, status: "PENDING" },
        data: {
          status: "ISSUED",
          refundMethod: params.refundMethod,
          approvedByUserId: params.approvedByUserId,
          approvedAt: now,
          issuedByUserId: params.approvedByUserId,
          issuedAt: now,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException(
          "Refund request was already decided by another request",
        );
      }

      if (params.refundMethod === "STORE_CREDIT" && refund.order.customerUserId) {
        await this.walletsService.creditInTransaction(tx, {
          userId: refund.order.customerUserId,
          amountCents: refund.amountCents,
          reason: `Refund for order #${refund.order.orderNumber}`,
          entryType: "REFUND",
          orderId: refund.orderId,
          refundRequestId: refund.id,
          createdByUserId: params.approvedByUserId,
        });
      }

      if (returnsCollectedFunds) {
        await this.paymentsService.createPaymentInTransaction(tx, {
          orderId: refund.orderId,
          locationId: refund.locationId,
          transactionType: "REFUND",
          paymentMethod: params.refundMethod === "CASH" ? "CASH" : "CARD",
          signedAmountCents: -refund.amountCents,
          initiatedByUserId: params.approvedByUserId,
          createdByUserId: params.approvedByUserId,
          actorRole: "ADMIN",
        });
      }

      return tx.refundRequest.findUniqueOrThrow({
        where: { id: params.refundRequestId },
      });
    });
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

    // Conditional update so a concurrent approval that already left PENDING
    // cannot be overwritten by this rejection.
    const rejected = await this.prisma.refundRequest.updateMany({
      where: { id: params.refundRequestId, status: "PENDING" },
      data: {
        status: "REJECTED",
        rejectedByUserId: params.rejectedByUserId,
        rejectedAt: new Date(),
      },
    });
    if (rejected.count !== 1) {
      throw new ConflictException(
        "Refund request was already decided by another request",
      );
    }

    return this.prisma.refundRequest.findUniqueOrThrow({
      where: { id: params.refundRequestId },
    });
  }
}
