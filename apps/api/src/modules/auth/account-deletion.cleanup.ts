import { Prisma } from "@prisma/client";
import { minimizeAuditPayload, minimizePayment, minimizePricing } from "./account-deletion.policy";

const REMOVED = "Personal information removed";

/** Must run under the user FOR UPDATE lock and in the final serializable transaction. */
export async function eraseCustomerData(tx: Prisma.TransactionClient, userId: string, now: Date): Promise<void> {
  const orders = await tx.order.findMany({ where: { customerUserId: userId }, select: { id: true, pricingSnapshotJson: true } });
  const orderIds = orders.map(row => row.id);
  const ownedOrder = { in: orderIds };
  const tickets = await tx.supportTicket.findMany({ where: { OR: [{ customerUserId: userId }, { orderId: ownedOrder }] }, select: { id: true } });
  const ticketIds = tickets.map(row => row.id);
  const ownedTicket = { in: ticketIds };
  const payments = await tx.orderPayment.findMany({ where: { orderId: ownedOrder }, select: { id: true, processorPayloadJson: true } });
  // IDs also locate audit payload copies created by staff on the customer's behalf.
  const related = await Promise.all([
    tx.refundRequest.findMany({ where: { OR: [{ orderId: ownedOrder }, { requestedByUserId: userId }] }, select: { id: true } }),
    tx.customerCreditLedger.findMany({ where: { customerUserId: userId }, select: { id: true } }),
    tx.customerWingsStampLedger.findMany({ where: { customerUserId: userId }, select: { id: true } }),
    tx.customerAddress.findMany({ where: { userId }, select: { id: true } }),
    tx.savedCart.findMany({ where: { userId }, select: { id: true } }),
    tx.orderMessage.findMany({ where: { OR: [{ orderId: ownedOrder }, { senderUserId: userId }] }, select: { id: true } }),
  ]);
  const entityIds = [userId, ...orderIds, ...ticketIds, ...payments.map(row => row.id), ...related.flat().map(row => row.id)];

  await tx.authOtpCode.deleteMany({ where: { userIdentity: { userId } } });
  await tx.userIdentity.deleteMany({ where: { userId } });
  await tx.authSession.deleteMany({ where: { userId } });
  await tx.customerProfile.deleteMany({ where: { userId } });
  await tx.customerAddress.deleteMany({ where: { userId } });
  await tx.savedCart.deleteMany({ where: { userId } }); // Only saved-cart items cascade.
  await tx.checkoutIdempotencyKey.deleteMany({ where: { userId } });
  await tx.customerWallet.deleteMany({ where: { customerUserId: userId, balanceCents: 0 } });
  await tx.customerWingsRewards.deleteMany({ where: { customerUserId: userId } });
  await tx.wingsStampGrantEmail.deleteMany({ where: { grant: { customerUserId: userId } } });
  await tx.customerCreditLedger.updateMany({ where: { customerUserId: userId }, data: { reasonText: REMOVED } });
  await tx.customerWingsStampLedger.updateMany({ where: { customerUserId: userId }, data: { reasonText: REMOVED } });
  await tx.promoRedemption.updateMany({ where: { OR: [{ customerUserId: userId }, { orderId: ownedOrder }] }, data: { metadataJson: {} } });
  await tx.itemReview.deleteMany({ where: { OR: [{ customerUserId: userId }, { orderId: ownedOrder }] } });
  await tx.driverDeliveryReview.deleteMany({ where: { OR: [{ customerUserId: userId }, { orderId: ownedOrder }] } });
  await tx.cateringInquiry.deleteMany({ where: { customerUserId: userId } });
  await tx.chatReadState.deleteMany({ where: { OR: [{ userId }, { orderId: ownedOrder }] } });
  await tx.chatSideReadState.deleteMany({ where: { orderId: ownedOrder } });
  await tx.deliveryPinVerification.deleteMany({ where: { orderId: ownedOrder } });
  // Preserve message IDs referenced by cancellation pointers and other read states.
  await tx.orderMessage.updateMany({ where: { OR: [{ orderId: ownedOrder }, { senderUserId: userId }] },
    data: { messageBody: REMOVED, deletedAt: now } });
  await tx.supportTicketMessage.updateMany({ where: { OR: [{ supportTicketId: ownedTicket }, { authorUserId: userId }] }, data: { messageBody: REMOVED } });
  await tx.supportTicketEvent.updateMany({ where: { OR: [{ ticketId: ownedTicket }, { performedByUserId: userId }] },
    data: { fromValue: null, toValue: null, note: null, payloadJson: {} } });
  await tx.supportTicketResolution.updateMany({ where: { OR: [{ ticketId: ownedTicket }, { createdByUserId: userId }] }, data: { note: null } });
  await tx.supportTicket.updateMany({ where: { id: ownedTicket }, data: { subject: REMOVED, description: REMOVED } });
  await tx.refundRequest.updateMany({ where: { OR: [{ orderId: ownedOrder }, { requestedByUserId: userId }] }, data: { reasonText: REMOVED } });
  await tx.orderItem.updateMany({ where: { orderId: ownedOrder }, data: { specialInstructions: null, builderPayloadJson: Prisma.DbNull } });
  await tx.orderDiscount.updateMany({ where: { orderId: ownedOrder }, data: { reasonText: null, description: null } });
  await tx.orderStatusEvent.updateMany({ where: { OR: [{ orderId: ownedOrder }, { actorUserId: userId }] }, data: { reasonText: null, payloadJson: {} } });
  await tx.orderEtaEvent.updateMany({ where: { OR: [{ orderId: ownedOrder }, { changedByUserId: userId }] }, data: { reason: null } });
  await tx.orderDriverEvent.updateMany({ where: { OR: [{ orderId: ownedOrder }, { actorUserId: userId }] }, data: { noteText: null } });
  await tx.cancellationRequest.updateMany({ where: { OR: [{ orderId: ownedOrder }, { requestedByUserId: userId }] }, data: { reasonText: REMOVED, decisionNote: null } });
  for (const payment of payments) {
    await tx.orderPayment.update({ where: { id: payment.id }, data: { processorPayloadJson: minimizePayment(payment.processorPayloadJson), failureReason: null } });
  }
  for (const order of orders) {
    await tx.order.update({ where: { id: order.id }, data: {
      customerNameSnapshot: "Deleted customer", customerPhoneSnapshot: "", customerEmailSnapshot: null,
      deliveryPhoneSnapshot: null, addressSnapshotJson: Prisma.DbNull, customerOrderNotes: null,
      cancellationReason: null, revalidationDiffJson: Prisma.DbNull, pricingSnapshotJson: minimizePricing(order.pricingSnapshotJson),
    } });
  }
  const audits = await tx.adminAuditLog.findMany({ where: { OR: [{ actorUserId: userId }, { entityId: { in: entityIds } },
    { payloadJson: { path: ["customer_user_id"], equals: userId } }, { payloadJson: { path: ["user_id"], equals: userId } }] },
    select: { id: true, payloadJson: true } });
  for (const audit of audits) {
    await tx.adminAuditLog.update({ where: { id: audit.id },
      data: { reasonText: null, payloadJson: minimizeAuditPayload(audit.payloadJson) ?? {} } });
  }
  await tx.accountDeletionAuthorization.deleteMany({ where: { userId } });
  // Last write: triggers allow cleanup while active and then seal the tombstone.
  await tx.user.update({ where: { id: userId }, data: {
    displayName: "Deleted customer", firstName: null, lastName: null, passwordHash: null,
    isActive: false, archivedAt: now, accountDeletedAt: now, lastProfileIdentityChangeAt: null,
  } });
}
