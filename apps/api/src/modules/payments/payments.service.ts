import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  Prisma,
  type Order,
  type OrderPayment,
  type OrderPaymentStatusSummary,
  type PaymentMethod,
  type PaymentTransactionType,
  type PaymentTenderMethod,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { lockOrderForLocation } from "../../database/order-row-lock";
import {
  collectionPreferenceFromSnapshot,
  containsPossibleCardNumber,
  netCollectedCents,
  paymentBalance,
  rollupPaymentStatus,
  validateTerminalReference,
  type CollectionPreference,
} from "./payment-policy";
import {
  serializeCustomerPaymentRow,
  serializePaymentSummary,
  serializeStaffPaymentRow,
} from "./payment-collection-view";

export type PaymentActorRole = "ADMIN" | "STAFF" | "KDS_STATION";

export interface PaymentActor {
  userId: string | null;
  role: PaymentActorRole;
  employeeRole?: string | null;
  kdsStationSessionId?: string | null;
}

export type CollectionMethod = "CASH" | "CARD";
export type CollectionOutcome =
  | "SUCCESS"
  | "DECLINED"
  | "CANCELLED"
  | "FAILED"
  | "NOT_COLLECTED";
export type CollectedBy = "STORE" | "DRIVER";

export const CARD_TERMINAL_PROVIDER = "CARD_TERMINAL";

export interface RecordCollectionParams {
  orderId: string;
  locationId: string;
  method: CollectionMethod;
  outcome: CollectionOutcome;
  amountCents: number;
  collectedBy: CollectedBy;
  terminalReference?: string | null;
  referenceUnavailable?: boolean;
  note?: string | null;
  idempotencyKey: string;
  actor: PaymentActor;
}

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
  actorRole?: PaymentActorRole;
}

type PaymentViewer = {
  userId: string;
  role: "CUSTOMER" | "STAFF" | "ADMIN";
  locationId: string;
};

function tenderToOrderMethod(method: PaymentTenderMethod): PaymentMethod {
  if (method === "CASH") return "CASH";
  if (method === "STORE_CREDIT") return "STORE_CREDIT";
  if (method === "WAIVED") return "WAIVED";
  return "CARD";
}

function payloadOf(payment: OrderPayment): Record<string, unknown> {
  const payload = payment.processorPayloadJson;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function methodMatchesPreference(
  preference: CollectionPreference | null,
  method: CollectionMethod,
): boolean | null {
  if (!preference) return null;
  if (preference === "PAY_AT_STORE") return true;
  return preference === (method === "CASH" ? "CASH_ON_DELIVERY" : "CARD_ON_DELIVERY");
}

function transactionStatusFor(outcome: CollectionOutcome) {
  if (outcome === "SUCCESS") return "SUCCESS" as const;
  if (outcome === "CANCELLED") return "CANCELLED" as const;
  return "FAILED" as const;
}

const OUTCOME_FAILURE_TEXT: Record<Exclude<CollectionOutcome, "SUCCESS">, string> = {
  DECLINED: "Terminal declined",
  CANCELLED: "Terminal transaction cancelled",
  FAILED: "Terminal error",
  NOT_COLLECTED: "Payment not collected",
};

function invalid(message: string, field: string): never {
  throw new UnprocessableEntityException({ message, field });
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Low-level ledger write used by refunds and admin corrections. Runs under
   * an order row lock so balance checks and the insert cannot interleave.
   */
  async createPayment(params: CreatePaymentParams) {
    const isRefund = params.transactionType === "REFUND";
    const amount = isRefund
      ? -Math.abs(params.signedAmountCents)
      : params.signedAmountCents;
    if (isRefund ? amount === 0 : amount <= 0) {
      throw new BadRequestException("Amount must be greater than zero");
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, params.orderId, params.locationId);
      const successful = await tx.orderPayment.findMany({
        where: { orderId: params.orderId, transactionStatus: "SUCCESS" },
      });
      const balance = paymentBalance(
        order.finalPayableCents,
        successful,
        order.status,
      );

      if (
        params.transactionType === "CAPTURE" ||
        params.transactionType === "ADJUSTMENT"
      ) {
        if (balance.outstanding_cents <= 0) {
          throw new ConflictException("This order has no outstanding balance.");
        }
        if (amount > balance.outstanding_cents) {
          invalid(
            `Amount exceeds the outstanding balance of ${balance.outstanding_cents} cents.`,
            "signed_amount_cents",
          );
        }
      }
      if (isRefund && Math.abs(amount) > balance.collected_cents) {
        throw new BadRequestException(
          `Refund exceeds the amount collected (${balance.collected_cents} cents).`,
        );
      }

      let payment: OrderPayment;
      try {
        payment = await tx.orderPayment.create({
          data: {
            orderId: params.orderId,
            locationId: params.locationId,
            transactionType: params.transactionType,
            transactionStatus: "SUCCESS",
            paymentMethod: params.paymentMethod,
            signedAmountCents: amount,
            currency: params.currency ?? "CAD",
            provider: params.provider,
            providerTransactionId: params.providerTransactionId,
            processorPayloadJson: (params.processorPayloadJson as object) ?? {},
            initiatedByUserId: params.initiatedByUserId,
            createdByUserId: params.createdByUserId,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            "This provider transaction is already recorded.",
          );
        }
        throw error;
      }

      await this.applyRollup(tx, order, [...successful, payment]);
      await tx.adminAuditLog.create({
        data: {
          locationId: params.locationId,
          actorUserId: params.createdByUserId ?? null,
          actorRoleSnapshot: params.actorRole ?? "ADMIN",
          actionKey: `payment.${params.transactionType.toLowerCase()}_recorded`,
          entityType: "Order",
          entityId: params.orderId,
          payloadJson: {
            payment_id: payment.id,
            transaction_type: params.transactionType,
            payment_method: params.paymentMethod,
            signed_amount_cents: amount,
            outstanding_before_cents: balance.outstanding_cents,
          },
        },
      });
      return payment;
    });
  }

  /**
   * Records a staff-confirmed in-person collection (cash or card terminal).
   * Only SUCCESS outcomes change the balance; other outcomes are kept as
   * FAILED/CANCELLED attempts for the audit trail.
   */
  async recordCollection(params: RecordCollectionParams) {
    const idempotencyKey = params.idempotencyKey.trim();
    if (!idempotencyKey) invalid("Idempotency key is required", "idempotency_key");
    if (!Number.isInteger(params.amountCents) || params.amountCents < 1) {
      invalid("Amount must be at least 1 cent", "amount_cents");
    }

    const note = params.note?.trim() || null;
    if (note && containsPossibleCardNumber(note)) {
      invalid("Notes must not contain card numbers.", "note");
    }

    let reference: string | null = null;
    if (params.terminalReference?.trim()) {
      if (params.method !== "CARD") {
        invalid("A terminal reference only applies to card collections.", "terminal_reference");
      }
      const checked = validateTerminalReference(params.terminalReference);
      if (!checked.ok) invalid(checked.message, "terminal_reference");
      reference = checked.reference;
    }

    if (
      params.method === "CASH" &&
      params.outcome !== "SUCCESS" &&
      params.outcome !== "NOT_COLLECTED"
    ) {
      invalid("Cash can only be recorded as collected or not collected.", "outcome");
    }
    if (params.method === "CARD" && params.outcome === "SUCCESS" && !reference) {
      if (!params.referenceUnavailable) {
        invalid(
          "Enter the terminal approval or reference code for card payments.",
          "terminal_reference",
        );
      }
      if (!note) {
        invalid("Explain why the terminal reference is unavailable.", "note");
      }
    }
    if (params.outcome === "NOT_COLLECTED" && !note) {
      invalid("Add a reason when payment was not collected.", "note");
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, params.orderId, params.locationId);
      const allPayments = await tx.orderPayment.findMany({
        where: { orderId: params.orderId },
        orderBy: { createdAt: "asc" },
      });

      const replay = allPayments.find(
        (payment) => payloadOf(payment).idempotency_key === idempotencyKey,
      );
      if (replay) {
        const payload = payloadOf(replay);
        const sameRequest =
          payload.outcome === params.outcome &&
          payload.collected_by === params.collectedBy &&
          replay.paymentMethod === params.method &&
          replay.signedAmountCents === params.amountCents;
        if (!sameRequest) {
          throw new ConflictException(
            "This confirmation was already submitted with different details.",
          );
        }
        return { payment: replay, replayed: true };
      }

      if (order.status === "CANCELLED") {
        invalid("Cancelled orders cannot take a payment collection.", "status");
      }
      if (
        params.actor.employeeRole === "DRIVER" &&
        order.assignedDriverUserId !== params.actor.userId
      ) {
        throw new ForbiddenException(
          "Drivers can only record collections for their own deliveries.",
        );
      }
      if (params.collectedBy === "DRIVER") {
        if (order.fulfillmentType !== "DELIVERY") {
          invalid("Driver collections apply to delivery orders only.", "collected_by");
        }
        if (!order.assignedDriverUserId) {
          invalid("Assign a driver before recording a driver collection.", "collected_by");
        }
      }

      const successful = allPayments.filter(
        (payment) => payment.transactionStatus === "SUCCESS",
      );
      const before = paymentBalance(order.finalPayableCents, successful, order.status);
      const isSuccess = params.outcome === "SUCCESS";
      if (isSuccess) {
        if (before.outstanding_cents <= 0) {
          throw new ConflictException("This order has no outstanding balance.");
        }
        if (params.amountCents > before.outstanding_cents) {
          invalid(
            `Amount exceeds the outstanding balance of ${before.outstanding_cents} cents.`,
            "amount_cents",
          );
        }
      }

      const preference = collectionPreferenceFromSnapshot(order.pricingSnapshotJson);
      const driverUserId =
        params.collectedBy === "DRIVER" ? order.assignedDriverUserId : null;

      let payment: OrderPayment;
      try {
        payment = await tx.orderPayment.create({
          data: {
            orderId: params.orderId,
            locationId: params.locationId,
            transactionType: "CAPTURE",
            transactionStatus: transactionStatusFor(params.outcome),
            paymentMethod: params.method,
            signedAmountCents: params.amountCents,
            currency: "CAD",
            provider: params.method === "CARD" ? CARD_TERMINAL_PROVIDER : null,
            providerTransactionId: isSuccess ? reference : null,
            processorPayloadJson: {
              source: "STAFF_COLLECTION",
              idempotency_key: idempotencyKey,
              outcome: params.outcome,
              collected_by: params.collectedBy,
              collection_preference: preference,
              terminal_reference: reference,
              reference_unavailable: params.referenceUnavailable === true,
              note,
              actor_role: params.actor.role,
              kds_station_session_id: params.actor.kdsStationSessionId ?? null,
            },
            initiatedByUserId: driverUserId ?? params.actor.userId,
            createdByUserId: params.actor.userId,
            failureReason: isSuccess
              ? null
              : note ?? OUTCOME_FAILURE_TEXT[params.outcome as Exclude<CollectionOutcome, "SUCCESS">],
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            "This terminal reference is already recorded on another payment.",
          );
        }
        throw error;
      }

      const nextSuccessful = isSuccess ? [...successful, payment] : successful;
      if (isSuccess) await this.applyRollup(tx, order, nextSuccessful);
      const after = paymentBalance(order.finalPayableCents, nextSuccessful, order.status);

      await tx.adminAuditLog.create({
        data: {
          locationId: params.locationId,
          actorUserId: params.actor.userId,
          actorRoleSnapshot: params.actor.role,
          actionKey: isSuccess
            ? "payment.collection_recorded"
            : "payment.collection_failed",
          entityType: "Order",
          entityId: params.orderId,
          reasonText: note,
          payloadJson: {
            payment_id: payment.id,
            method: params.method,
            outcome: params.outcome,
            amount_cents: params.amountCents,
            collected_by: params.collectedBy,
            driver_user_id: driverUserId,
            collection_preference: preference,
            method_matches_preference: methodMatchesPreference(preference, params.method),
            terminal_reference: reference,
            reference_unavailable: params.referenceUnavailable === true,
            outstanding_before_cents: before.outstanding_cents,
            outstanding_after_cents: after.outstanding_cents,
            kds_station_session_id: params.actor.kdsStationSessionId ?? null,
          },
        },
      });

      return { payment, replayed: false };
    });
  }

  /** Full payment view for staff at the order's location. */
  async getStaffPaymentView(orderId: string, locationId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, locationId },
      include: {
        payments: { orderBy: { createdAt: "asc" } },
        assignedDriver: {
          select: {
            userId: true,
            employeeProfile: {
              select: { user: { select: { displayName: true } } },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException("Order not found");

    const successful = order.payments.filter(
      (payment) => payment.transactionStatus === "SUCCESS",
    );
    return {
      order_id: order.id,
      order_status: order.status,
      fulfillment_type: order.fulfillmentType,
      assigned_driver_user_id: order.assignedDriverUserId,
      assigned_driver_name:
        order.assignedDriver?.employeeProfile?.user?.displayName ?? null,
      ...serializePaymentSummary(order, successful),
      payments: order.payments.map(serializeStaffPaymentRow),
    };
  }

  /**
   * Customers see only their own order's settled payments. Staff and admins
   * are limited to the location in X-Location-Id.
   */
  async getPaymentsForViewer(orderId: string, viewer: PaymentViewer) {
    if (viewer.role !== "CUSTOMER") {
      return this.getStaffPaymentView(orderId, viewer.locationId);
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerUserId: viewer.userId },
      include: {
        payments: {
          where: { transactionStatus: "SUCCESS" },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!order) throw new NotFoundException("Order not found");

    return {
      order_id: order.id,
      ...serializePaymentSummary(order, order.payments),
      payments: order.payments.map(serializeCustomerPaymentRow),
    };
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
    return rollupPaymentStatus(payments, order.finalPayableCents);
  }

  private async lockOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    locationId: string,
  ): Promise<Order> {
    const locked = await lockOrderForLocation(tx, orderId, locationId);
    if (!locked) throw new NotFoundException("Order not found");
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  }

  private async applyRollup(
    tx: Prisma.TransactionClient,
    order: Order,
    successful: OrderPayment[],
  ) {
    const netPaid = netCollectedCents(successful);
    const captureMethods = new Set(
      successful
        .filter((payment) => payment.transactionType === "CAPTURE")
        .map((payment) => payment.paymentMethod),
    );
    const paymentMethod: PaymentMethod | null =
      captureMethods.size === 0
        ? order.paymentMethod
        : captureMethods.size === 1
          ? tenderToOrderMethod([...captureMethods][0])
          : "SPLIT";

    return tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatusSummary: rollupPaymentStatus(successful, order.finalPayableCents),
        netPaidAmountCents: netPaid,
        remainingRefundableCents: netPaid,
        paymentMethod,
      },
    });
  }
}
