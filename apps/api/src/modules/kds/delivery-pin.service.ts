import { createHash, randomInt } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { DeliveryPinVerification, Prisma, PrismaClient } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

// PRD §7.8.5 — the customer-facing flow promises "You have N attempts left"
// after the first wrong PIN, so the UI copy is pinned to 3 total attempts
// (i.e. "2 left" after the 1st mismatch, "1 left" after the 2nd, then the
// driver is offered a manual `NO_PIN_DELIVERY` completion). Changing this
// constant will also change the copy in `pin-entry-modal` on the KDS.
export const PIN_MAX_FAILED_ATTEMPTS = 3;
const DEFAULT_PIN_EXPIRY_MINUTES = 240;

type Tx = Prisma.TransactionClient;
type DeliveryPinOrderSnapshot = {
  id: string;
  customerUserId?: string | null;
  fulfillmentType: string;
  locationId: string;
  status: string;
};

function generatePin(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

function hashPin(pin: string): string {
  // 4-digit PIN is low-entropy — we combine with a per-install secret so the
  // stored hash isn't a lookup table for 10 000 values. The secret mirrors
  // whatever JWT_SECRET the deployment uses (set via env).
  const salt = process.env.PIN_HASH_SECRET ?? process.env.JWT_SECRET ?? "dev-pin-secret";
  return createHash("sha256").update(`${salt}:${pin}`).digest("hex");
}

@Injectable()
export class DeliveryPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async getExpiryMinutes(locationId: string): Promise<number> {
    const settings = await this.prisma.locationSettings.findUnique({
      where: { locationId },
      select: { deliveryPinExpiryMinutes: true },
    });
    return settings?.deliveryPinExpiryMinutes ?? DEFAULT_PIN_EXPIRY_MINUTES;
  }

  private async autoRenewExpiredPinIfNeeded(
    order: DeliveryPinOrderSnapshot,
    record: DeliveryPinVerification | null,
  ): Promise<{
    record: DeliveryPinVerification | null;
    renewed: boolean;
  }> {
    const isActiveDelivery =
      order.fulfillmentType === "DELIVERY" && order.status === "OUT_FOR_DELIVERY";
    const needsRenewal =
      !record ||
      record.verificationResult === "EXPIRED" ||
      (record.verificationResult !== "VERIFIED" &&
        record.verificationResult !== "BYPASSED" &&
        record.verificationResult !== "LOCKED" &&
        record.expiresAt <= new Date());

    if (!isActiveDelivery || !needsRenewal) {
      return { record, renewed: false };
    }

    const expiryMinutes = await this.getExpiryMinutes(order.locationId);
    await this.generateForOrder({
      orderId: order.id,
      locationId: order.locationId,
      expiryMinutes,
    });

    const renewedRecord = await this.prisma.deliveryPinVerification.findUnique({
      where: { orderId: order.id },
    });

    this.realtime.emitOrderEvent(
      order.locationId,
      order.id,
      "order.status_changed",
      { order_id: order.id, pin_regenerated: true, automatic: true },
    );

    return { record: renewedRecord, renewed: true };
  }

  // Called inside KdsService.startDelivery — accepts an optional tx client so
  // PIN generation participates in the same transaction as the status flip.
  async generateForOrder(
    params: {
      orderId: string;
      locationId: string;
      expiryMinutes: number;
    },
    client?: Tx | PrismaClient,
  ): Promise<{ plaintext: string; expiresAt: Date }> {
    const db = (client ?? this.prisma) as Tx;
    const pin = generatePin();
    const hash = hashPin(pin);
    const expiresAt = new Date(Date.now() + params.expiryMinutes * 60_000);

    await db.deliveryPinVerification.upsert({
      where: { orderId: params.orderId },
      create: {
        orderId: params.orderId,
        pinHash: hash,
        pinPlaintext: pin,
        expiresAt,
        failedAttempts: 0,
        verificationResult: "PENDING",
      },
      update: {
        pinHash: hash,
        pinPlaintext: pin,
        expiresAt,
        failedAttempts: 0,
        lockedAt: null,
        verifiedAt: null,
        verifiedByUserId: null,
        verificationResult: "PENDING",
        bypassReason: null,
        bypassByUserId: null,
      },
    });

    return { plaintext: pin, expiresAt };
  }

  // Customer-facing read. Returns plaintext only while the PIN is active —
  // i.e., the order is OUT_FOR_DELIVERY and the PIN hasn't been used up.
  async fetchForCustomer(orderId: string, customerUserId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerUserId: true,
        status: true,
        fulfillmentType: true,
        locationId: true,
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
    const { record } = await this.autoRenewExpiredPinIfNeeded(order, current);

    if (!record || !record.pinPlaintext) {
      return { pin: null, status: record?.verificationResult ?? "PENDING" };
    }
    return {
      pin: record.pinPlaintext,
      expires_at: record.expiresAt,
      status: record.verificationResult,
    };
  }

  // KDS-facing read used by the PIN modal on open. Lets the UI restore its
  // "locked / X attempts remaining" state after a page refresh or after the
  // staff closed & reopened the modal — otherwise the client would show a
  // fresh PIN input every time even though the backend record is already
  // locked from previous failed attempts.
  async statusForStaff(orderId: string, locationId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, locationId: true, fulfillmentType: true, status: true },
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
    const { record } = await this.autoRenewExpiredPinIfNeeded(order, current);
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
    actorUserId: string;
    driverUserId: string;
    pin: string;
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        reason: "LOCKED" | "EXPIRED" | "MISMATCH";
        remaining_attempts?: number;
        renewed?: boolean;
      }
  > {
    if (!/^\d{4}$/.test(params.pin)) {
      throw new BadRequestException("PIN must be a 4-digit string");
    }

    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      select: { id: true, fulfillmentType: true, locationId: true, status: true },
    });
    if (!order) {
      throw new NotFoundException("Order not found");
    }

    const record = await this.prisma.deliveryPinVerification.findUnique({
      where: { orderId: params.orderId },
    });
    if (!record) {
      const { renewed } = await this.autoRenewExpiredPinIfNeeded(order, null);
      return { ok: false, reason: "EXPIRED", renewed };
    }
    if (record.verificationResult === "VERIFIED" || record.verificationResult === "BYPASSED") {
      return { ok: true };
    }
    if (record.verificationResult === "LOCKED" || record.lockedAt) {
      await this.logPinEvent(params, "PIN_FAIL_LOCKED");
      return { ok: false, reason: "LOCKED" };
    }
    if (record.expiresAt <= new Date()) {
      await this.prisma.deliveryPinVerification.update({
        where: { orderId: params.orderId },
        data: { verificationResult: "EXPIRED", pinPlaintext: null },
      });
      await this.logPinEvent(params, "PIN_FAIL_EXPIRED");
      const { renewed } = await this.autoRenewExpiredPinIfNeeded(order, {
        ...record,
        verificationResult: "EXPIRED",
        pinPlaintext: null,
      });
      return { ok: false, reason: "EXPIRED", renewed };
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
    actorUserId: string;
    driverUserId: string;
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
    actorUserId: string;
    expiryMinutes: number;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      select: { id: true, status: true, fulfillmentType: true, locationId: true },
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

    const { plaintext, expiresAt } = await this.generateForOrder({
      orderId: params.orderId,
      locationId: params.locationId,
      expiryMinutes: params.expiryMinutes,
    });

    this.realtime.emitOrderEvent(
      params.locationId,
      params.orderId,
      "order.status_changed",
      { order_id: params.orderId, pin_regenerated: true },
    );

    return { pin: plaintext, expires_at: expiresAt };
  }

  private async logPinEvent(
    params: { orderId: string; locationId: string; actorUserId: string; driverUserId: string },
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

    // PRD §7.8.5 / §8: PIN failures and bypasses must also be visible to ops
    // via the admin audit log, not just driver events. Success verifications
    // stay out of admin audit to keep the feed signal-heavy.
    const AUDITABLE = new Set([
      "PIN_FAIL",
      "PIN_FAIL_LOCK",
      "PIN_FAIL_LOCKED",
      "PIN_FAIL_EXPIRED",
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
