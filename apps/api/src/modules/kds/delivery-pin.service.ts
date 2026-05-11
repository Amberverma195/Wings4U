import { createHash } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { DeliveryPinVerification, Prisma, PrismaClient } from "@prisma/client";
import { requireDeliveryPinFromPhone } from "../../common/utils/delivery-pin-phone";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

// Kept in lockstep with the KDS delivery PIN modal copy.
export const PIN_MAX_FAILED_ATTEMPTS = 3;
const NON_EXPIRING_PIN_EXPIRES_AT = new Date("9999-12-31T23:59:59.999Z");

type Tx = Prisma.TransactionClient;
type DeliveryPinOrderSnapshot = {
  id: string;
  customerUserId?: string | null;
  fulfillmentType: string;
  locationId: string;
  status: string;
  customerPhoneSnapshot: string;
};

function hashPin(pin: string): string {
  const salt = process.env.PIN_HASH_SECRET ?? process.env.JWT_SECRET ?? "dev-pin-secret";
  return createHash("sha256").update(`${salt}:${pin}`).digest("hex");
}

@Injectable()
export class DeliveryPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async ensurePinRecordIfNeeded(
    order: DeliveryPinOrderSnapshot,
    record: DeliveryPinVerification | null,
  ): Promise<{ record: DeliveryPinVerification | null; created: boolean }> {
    const isActiveDelivery =
      order.fulfillmentType === "DELIVERY" && order.status === "OUT_FOR_DELIVERY";
    if (!isActiveDelivery || record) {
      return { record, created: false };
    }

    await this.generateForOrder({
      orderId: order.id,
      locationId: order.locationId,
    });

    const createdRecord = await this.prisma.deliveryPinVerification.findUnique({
      where: { orderId: order.id },
    });

    this.realtime.emitOrderEvent(
      order.locationId,
      order.id,
      "order.status_changed",
      { order_id: order.id, pin_regenerated: true, automatic: true },
    );

    return { record: createdRecord, created: true };
  }

  async generateForOrder(
    params: {
      orderId: string;
      locationId: string;
    },
    client?: Tx | PrismaClient,
  ): Promise<{ plaintext: string; expiresAt: Date }> {
    const db = (client ?? this.prisma) as Tx;
    const order = await db.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        locationId: true,
        fulfillmentType: true,
        customerPhoneSnapshot: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== params.locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }
    if (order.fulfillmentType !== "DELIVERY") {
      throw new UnprocessableEntityException({
        message: "PIN is only available for delivery orders",
        field: "fulfillment_type",
      });
    }

    const pin = requireDeliveryPinFromPhone(order.customerPhoneSnapshot);
    const hash = hashPin(pin);

    await db.deliveryPinVerification.upsert({
      where: { orderId: params.orderId },
      create: {
        orderId: params.orderId,
        pinHash: hash,
        pinPlaintext: pin,
        expiresAt: NON_EXPIRING_PIN_EXPIRES_AT,
        failedAttempts: 0,
        verificationResult: "PENDING",
      },
      update: {
        pinHash: hash,
        pinPlaintext: pin,
        expiresAt: NON_EXPIRING_PIN_EXPIRES_AT,
        failedAttempts: 0,
        lockedAt: null,
        verifiedAt: null,
        verifiedByUserId: null,
        verificationResult: "PENDING",
        bypassReason: null,
        bypassByUserId: null,
      },
    });

    return { plaintext: pin, expiresAt: NON_EXPIRING_PIN_EXPIRES_AT };
  }

  async fetchForCustomer(orderId: string, customerUserId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerUserId: true,
        status: true,
        fulfillmentType: true,
        locationId: true,
        customerPhoneSnapshot: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.customerUserId !== customerUserId) {
      throw new ForbiddenException("You do not have access to this order");
    }
    if (order.fulfillmentType !== "DELIVERY") {
      throw new UnprocessableEntityException({
        message: "PIN is only available for delivery orders",
        field: "fulfillment_type",
      });
    }

    const current = await this.prisma.deliveryPinVerification.findUnique({
      where: { orderId },
    });
    const { record } = await this.ensurePinRecordIfNeeded(order, current);

    if (!record || !record.pinPlaintext) {
      return { pin: null, status: record?.verificationResult ?? "PENDING" };
    }
    return {
      pin: record.pinPlaintext,
      status: record.verificationResult,
    };
  }

  async statusForStaff(orderId: string, locationId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        locationId: true,
        fulfillmentType: true,
        status: true,
        customerPhoneSnapshot: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }
    if (order.fulfillmentType !== "DELIVERY") {
      throw new UnprocessableEntityException({
        message: "PIN is only available for delivery orders",
        field: "fulfillment_type",
      });
    }

    const current = await this.prisma.deliveryPinVerification.findUnique({
      where: { orderId },
    });
    const { record } = await this.ensurePinRecordIfNeeded(order, current);
    if (!record) {
      return {
        exists: false,
        verified: false,
        locked: false,
        failed_attempts: 0,
        max_attempts: PIN_MAX_FAILED_ATTEMPTS,
        remaining_attempts: PIN_MAX_FAILED_ATTEMPTS,
        verification_result: null,
      };
    }

    const isLocked =
      record.verificationResult === "LOCKED" ||
      Boolean(record.lockedAt) ||
      record.failedAttempts >= PIN_MAX_FAILED_ATTEMPTS;
    const verified =
      record.verificationResult === "VERIFIED" ||
      record.verificationResult === "BYPASSED";
    return {
      exists: true,
      verified,
      locked: isLocked,
      failed_attempts: record.failedAttempts,
      max_attempts: PIN_MAX_FAILED_ATTEMPTS,
      remaining_attempts: isLocked
        ? 0
        : Math.max(0, PIN_MAX_FAILED_ATTEMPTS - record.failedAttempts),
      verification_result: record.verificationResult,
    };
  }

  async verify(params: {
    orderId: string;
    locationId: string;
    actorUserId: string | null;
    driverUserId: string | null;
    pin: string;
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        reason: "LOCKED" | "MISMATCH";
        remaining_attempts?: number;
      }
  > {
    if (!/^\d{4}$/.test(params.pin)) {
      throw new BadRequestException("PIN must be a 4-digit string");
    }

    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        fulfillmentType: true,
        locationId: true,
        status: true,
        customerPhoneSnapshot: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.locationId !== params.locationId) {
      throw new UnprocessableEntityException({
        message: "Order does not belong to this location",
        field: "location_id",
      });
    }

    const current = await this.prisma.deliveryPinVerification.findUnique({
      where: { orderId: params.orderId },
    });
    const { record } = await this.ensurePinRecordIfNeeded(order, current);
    if (!record) {
      return {
        ok: false,
        reason: "MISMATCH",
        remaining_attempts: PIN_MAX_FAILED_ATTEMPTS,
      };
    }
    if (record.verificationResult === "VERIFIED" || record.verificationResult === "BYPASSED") {
      return { ok: true };
    }
    if (record.verificationResult === "LOCKED" || record.lockedAt) {
      await this.logPinEvent(params, "PIN_FAIL_LOCKED");
      return { ok: false, reason: "LOCKED" };
    }

    const candidateHash = hashPin(params.pin);
    if (candidateHash !== record.pinHash) {
      const nextAttempts = record.failedAttempts + 1;
      const shouldLock = nextAttempts >= PIN_MAX_FAILED_ATTEMPTS;
      await this.prisma.deliveryPinVerification.update({
        where: { orderId: params.orderId },
        data: {
          failedAttempts: nextAttempts,
          lockedAt: shouldLock ? new Date() : null,
          verificationResult: shouldLock ? "LOCKED" : "PENDING",
          pinPlaintext: shouldLock ? null : record.pinPlaintext,
        },
      });
      await this.logPinEvent(params, shouldLock ? "PIN_FAIL_LOCK" : "PIN_FAIL");
      return {
        ok: false,
        reason: shouldLock ? "LOCKED" : "MISMATCH",
        remaining_attempts: Math.max(0, PIN_MAX_FAILED_ATTEMPTS - nextAttempts),
      };
    }

    await this.prisma.deliveryPinVerification.update({
      where: { orderId: params.orderId },
      data: {
        verificationResult: "VERIFIED",
        verifiedAt: new Date(),
        verifiedByUserId: params.actorUserId,
        pinPlaintext: null,
      },
    });
    return { ok: true };
  }

  async bypass(params: {
    orderId: string;
    locationId: string;
    actorUserId: string | null;
    driverUserId: string | null;
    reason: string;
  }) {
    if (!params.reason || params.reason.trim().length === 0) {
      throw new BadRequestException("Bypass reason is required");
    }
    const record = await this.prisma.deliveryPinVerification.findUnique({
      where: { orderId: params.orderId },
    });
    if (!record) {
      throw new NotFoundException("Delivery PIN not set up for this order");
    }
    await this.prisma.deliveryPinVerification.update({
      where: { orderId: params.orderId },
      data: {
        verificationResult: "BYPASSED",
        bypassReason: params.reason,
        bypassByUserId: params.actorUserId,
        verifiedAt: new Date(),
        pinPlaintext: null,
      },
    });
    await this.logPinEvent(params, "PIN_BYPASS", params.reason);
  }

  async regenerate(params: {
    orderId: string;
    locationId: string;
    actorUserId: string | null;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        status: true,
        fulfillmentType: true,
        locationId: true,
        customerPhoneSnapshot: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.fulfillmentType !== "DELIVERY") {
      throw new UnprocessableEntityException({
        message: "PIN is only available for delivery orders",
        field: "fulfillment_type",
      });
    }
    if (order.status !== "OUT_FOR_DELIVERY" && order.status !== "READY") {
      throw new UnprocessableEntityException({
        message: `Cannot regenerate PIN for order in status "${order.status}"`,
        field: "status",
      });
    }

    const { plaintext } = await this.generateForOrder({
      orderId: params.orderId,
      locationId: params.locationId,
    });

    this.realtime.emitOrderEvent(
      params.locationId,
      params.orderId,
      "order.status_changed",
      { order_id: params.orderId, pin_regenerated: true },
    );

    return { pin: plaintext };
  }

  private async logPinEvent(
    params: { orderId: string; locationId: string; actorUserId: string | null; driverUserId: string | null },
    eventType: string,
    note?: string,
  ) {
    await this.prisma.orderDriverEvent.create({
      data: {
        orderId: params.orderId,
        locationId: params.locationId,
        driverUserId: params.driverUserId,
        actorUserId: params.actorUserId,
        eventType,
        noteText: note ?? null,
      },
    });

    const AUDITABLE = new Set([
      "PIN_FAIL",
      "PIN_FAIL_LOCK",
      "PIN_FAIL_LOCKED",
      "PIN_BYPASS",
    ]);
    if (AUDITABLE.has(eventType)) {
      await this.prisma.adminAuditLog.create({
        data: {
          locationId: params.locationId,
          actorUserId: params.actorUserId,
          actorRoleSnapshot: "STAFF",
          actionKey: `delivery_pin.${eventType.toLowerCase()}`,
          entityType: "Order",
          entityId: params.orderId,
          reasonText: note ?? null,
          payloadJson: {
            driver_user_id: params.driverUserId,
            event_type: eventType,
          },
        },
      });
    }
  }
}
