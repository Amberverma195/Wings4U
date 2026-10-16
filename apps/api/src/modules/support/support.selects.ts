import type { Prisma } from "@prisma/client";
import { primaryContacts, primaryIdentityOrder } from "../../common/utils/primary-identity";

export const ticketSelect = {
  id: true, locationId: true, orderId: true, customerUserId: true, assignedAdminUserId: true,
  ticketType: true, status: true, priority: true, createdSource: true, resolutionType: true,
  subject: true, description: true, resolvedByUserId: true, resolvedAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.SupportTicketSelect;

export const actorSelect = {
  id: true, displayName: true, firstName: true, lastName: true, role: true, archivedAt: true,
} satisfies Prisma.UserSelect;

export const orderContextSelect = {
  id: true, locationId: true, customerUserId: true, orderNumber: true, status: true,
  fulfillmentType: true, placedAt: true, finalPayableCents: true,
  customerNameSnapshot: true, customerPhoneSnapshot: true, customerEmailSnapshot: true,
} satisfies Prisma.OrderSelect;

export const messageSelect = {
  id: true, supportTicketId: true, authorUserId: true, messageBody: true, isInternalNote: true, createdAt: true,
} satisfies Prisma.SupportTicketMessageSelect;
export const eventSelect = {
  id: true, ticketId: true, performedByUserId: true, eventType: true, fromValue: true,
  toValue: true, note: true, payloadJson: true, createdAt: true,
} satisfies Prisma.SupportTicketEventSelect;
export const resolutionSelect = {
  id: true, ticketId: true, createdByUserId: true, resolutionType: true, refundRequestId: true,
  replacementOrderId: true, creditAmountCents: true, note: true, createdAt: true,
} satisfies Prisma.SupportTicketResolutionSelect;

export const adminContextSelect = {
  customer: { select: { ...actorSelect, identities: {
    orderBy: primaryIdentityOrder, select: { phoneE164: true, emailNormalized: true },
  } } },
  order: { select: orderContextSelect }, assignedAdmin: { select: actorSelect },
} satisfies Prisma.SupportTicketSelect;


type Actor = Prisma.UserGetPayload<{ select: typeof actorSelect }>;
export function serializeActor(actor: Actor | null | undefined, userId: string | null) {
  return {
    user_id: userId, display_name: actor && !actor.archivedAt
      ? actor.displayName.trim() || [actor.firstName, actor.lastName].filter(Boolean).join(" ") || "Unnamed account"
      : "Account unavailable",
    role: actor?.role ?? null, account_available: Boolean(actor && !actor.archivedAt),
  };
}

export function serializeCreator(
  created: { performedByUserId: string | null; performedBy?: Actor | null } | undefined,
  source: string,
) {
  if (!created) return null;
  return created.performedByUserId ? serializeActor(created.performedBy, created.performedByUserId)
    : { user_id: null, display_name: source.startsWith("SYSTEM_") ? "System" : "Creator not recorded",
      role: null, account_available: false };
}

type Order = Prisma.OrderGetPayload<{ select: typeof orderContextSelect }>;
export function serializeOrderContext(order: Order) {
  return {
    id: order.id, order_number: order.orderNumber.toString(), status: order.status,
    fulfillment_type: order.fulfillmentType, placed_at: order.placedAt, final_payable_cents: order.finalPayableCents,
    customer_name_snapshot: order.customerNameSnapshot, customer_phone_snapshot: order.customerPhoneSnapshot,
    customer_email_snapshot: order.customerEmailSnapshot,
  };
}

export type AdminTicketContext = Prisma.SupportTicketGetPayload<{ select: typeof ticketSelect & typeof adminContextSelect }>;
type Context = AdminTicketContext;
export function serializeAdminContext(ticket: Context) {
  const customer = ticket.customer;
  const available = Boolean(customer && !customer.archivedAt && customer.role === "CUSTOMER");
  // Legacy inconsistent relations must never expose another restaurant's or customer's order.
  const order = ticket.order && ticket.order.locationId === ticket.locationId &&
    ticket.order.customerUserId === ticket.customerUserId ? ticket.order : null;
  return {
    description: ticket.description,
    customer: {
      ...serializeActor(available ? customer : null, ticket.customerUserId),
      first_name: available ? customer!.firstName : null, last_name: available ? customer!.lastName : null,
      ...primaryContacts(available ? customer!.identities : []),
    },
    order: order ? serializeOrderContext(order) : null,
    assigned_admin: ticket.assignedAdminUserId ? serializeActor(ticket.assignedAdmin, ticket.assignedAdminUserId) : null,
  };
}
