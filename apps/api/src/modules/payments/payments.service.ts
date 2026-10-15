import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  type OrderPaymentStatusSummary,
  type PaymentMethod,
  type PaymentTransactionType,
  type PaymentTenderMethod,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import {
  capturedCents,
  isAlreadyFullyCaptured,
  netCollectedCents,
} from "./payment-policy";

interface CreatePaymentParams {
  orderId: string;
  locationId: string;
  transactionType: PaymentTransactionType;
  paymentMethod: PaymentTenderMethod;
  signedAmountCents: number;
  currency?: string;
  provider?: string;
  providerTransactionId?: string;
  processorPayloadJson?: unknown;
  initiatedByUserId?: string;
  createdByUserId?: string;
}

function tenderToOrderMethod(method: PaymentTenderMethod): PaymentMethod {
  if (method === "CASH") return "CASH";
  if (method === "STORE_CREDIT") return "STORE_CREDIT";
  if (method === "WAIVED") return "WAIVED";
  return "CARD";
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createPayment(params: CreatePaymentParams) {
    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
    });
    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (params.signedAmountCents <= 0 && params.transactionType !== "REFUND") {
      throw new BadRequestException("Amount must be positive for non-refund transactions");
    }

    if (params.transactionType === "CAPTURE") {
      const existing = await this.prisma.orderPayment.findMany({
        where: { orderId: params.orderId, transactionStatus: "SUCCESS" },
      });
      if (isAlreadyFullyCaptured(capturedCents(existing), order.finalPayableCents)) {
        throw new BadRequestException("This order is already paid.");
      }
    }

    const payment = await this.prisma.orderPayment.create({
      data: {
        orderId: params.orderId,
        locationId: params.locationId,
        transactionType: params.transactionType,
        transactionStatus: "SUCCESS",
        paymentMethod: params.paymentMethod,
        signedAmountCents: params.signedAmountCents,
        currency: params.currency ?? "CAD",
        provider: params.provider,
        providerTransactionId: params.providerTransactionId,
        processorPayloadJson: (params.processorPayloadJson as object) ?? {},
        initiatedByUserId: params.initiatedByUserId,
        createdByUserId: params.createdByUserId,
      },
    });

    const summary = await this.recalculatePaymentStatus(params.orderId);
    const recorded = await this.prisma.orderPayment.findMany({
      where: { orderId: params.orderId, transactionStatus: "SUCCESS" },
    });
    const netPaid = netCollectedCents(recorded);

    await this.prisma.order.update({
      where: { id: params.orderId },
      data: {
        paymentStatusSummary: summary,
        netPaidAmountCents: netPaid,
        remainingRefundableCents: netPaid,
        ...(summary === "PAID" &&
        !order.paymentMethod &&
        params.transactionType === "CAPTURE"
          ? { paymentMethod: tenderToOrderMethod(params.paymentMethod) }
          : {}),
      },
    });

    return payment;
  }

  async getPaymentsForOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException("Order not found");
    }

    return this.prisma.orderPayment.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    });
  }

  async recalculatePaymentStatus(
    orderId: string,
  ): Promise<OrderPaymentStatusSummary> {
    const [order, payments] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      this.prisma.orderPayment.findMany({
        where: { orderId, transactionStatus: "SUCCESS" },
      }),
    ]);

    if (payments.length === 0) return "UNPAID";

    let authTotal = 0;
    let captureTotal = 0;
    let refundTotal = 0;
    let voidTotal = 0;

    for (const p of payments) {
      switch (p.transactionType) {
        case "AUTH":
          authTotal += p.signedAmountCents;
          break;
        case "CAPTURE":
          captureTotal += p.signedAmountCents;
          break;
        case "REFUND":
          refundTotal += Math.abs(p.signedAmountCents);
          break;
        case "VOID":
          voidTotal += Math.abs(p.signedAmountCents);
          break;
        case "ADJUSTMENT":
          // Adjustments are net corrections (positive = additional charge,
          // negative = partial credit). They modify the effective captured total.
          captureTotal += p.signedAmountCents;
          break;
      }
    }

    if (voidTotal > 0 && captureTotal === 0) return "VOIDED";

    if (refundTotal > 0 && refundTotal >= captureTotal) return "REFUNDED";
    if (refundTotal > 0 && refundTotal < captureTotal) return "PARTIALLY_REFUNDED";

    if (captureTotal >= order.finalPayableCents) return "PAID";
    if (captureTotal > 0) return "PARTIALLY_PAID";

    if (authTotal > 0) return "PENDING";

    return "UNPAID";
  }
}
