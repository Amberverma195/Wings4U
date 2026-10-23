import type { OrderStatus, Prisma } from "@prisma/client";

export const DRIVER_ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY",
];

/** Called after the guarded terminal write, in the same transaction. */
export async function releaseClosedOrderDriver(
  tx: Prisma.TransactionClient,
  order: { id: string; locationId: string; assignedDriverUserId: string | null },
  actorUserId: string | null,
  now: Date,
  eventType: "DELIVERY_NO_SHOW" | "ORDER_CANCELLED",
  reason?: string | null,
) {
  const driverUserId = order.assignedDriverUserId;
  if (!driverUserId) return null;
  const remainingAssignments = await tx.order.count({ where: {
    assignedDriverUserId: driverUserId, id: { not: order.id },
    status: { in: DRIVER_ACTIVE_ORDER_STATUSES },
  } });
  const released = { driverUserId, isOnDelivery: remainingAssignments > 0,
    availabilityStatus: remainingAssignments > 0 ? "ON_DELIVERY" as const : "AVAILABLE" as const };
  await tx.orderDriverEvent.create({ data: {
    orderId: order.id, locationId: order.locationId, driverUserId,
    eventType, actorUserId, noteText: reason,
  } });
  await tx.driverProfile.update({ where: { userId: driverUserId }, data: {
    isOnDelivery: released.isOnDelivery, availabilityStatus: released.availabilityStatus,
    // Release is not a successful handoff. Successful completion paths own
    // lastDeliveryCompletedAt and totalDeliveriesCompleted.
  } });
  return released;
}
