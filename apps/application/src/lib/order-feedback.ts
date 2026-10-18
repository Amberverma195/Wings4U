import type { SessionState } from '../context/session';
import type { OrderDetail, OrderItem, SupportTicketType } from './types';
import { cents } from './format';

export const ORDER_ISSUES: ReadonlyArray<{ value: SupportTicketType; label: string; subjectLabel: string }> = [
  { value: 'WRONG_ITEM', label: 'Wrong Item', subjectLabel: 'Wrong item' },
  { value: 'MISSING_ITEM', label: 'Missing Item', subjectLabel: 'Missing item' },
  { value: 'COLD_FOOD', label: 'Cold Food', subjectLabel: 'Cold food' },
  { value: 'BURNT_FOOD', label: 'Burnt Food', subjectLabel: 'Burnt food' },
  { value: 'OTHER', label: 'Other', subjectLabel: 'Other' },
];

export function canUseOrderFeedback(order: OrderDetail, session: SessionState): boolean {
  // Admins can also be the purchasing customer. RolesGuard permits this, while
  // the support/review services still require the authenticated order owner.
  return session.loaded && session.authenticated && Boolean(session.user && ['CUSTOMER', 'ADMIN'].includes(session.user.role)) &&
    session.user?.id === order.customer_user_id &&
    (order.status === 'PICKED_UP' || order.status === 'DELIVERED');
}

export function feedbackItemSummary(item: OrderItem): string {
  const flavours = item.flavours.map(row => row.flavour_name_snapshot).filter(Boolean);
  const modifiers = item.modifiers.map(row => row.modifier_name_snapshot).filter(Boolean);
  return [item.category_name_snapshot, flavours.length ? `Flavours: ${flavours.join(', ')}` : null,
    modifiers.length ? `Options: ${modifiers.join(', ')}` : null].filter(Boolean).join(' / ');
}

export function feedbackItemTitle(item: OrderItem): string {
  return `${item.product_name_snapshot}${item.quantity > 1 ? ` x${item.quantity}` : ''}`;
}

// Keep the website's support description format: the backend uses these line IDs.
export function ticketPayload(order: OrderDetail, selectedIds: string[], type: SupportTicketType, description: string) {
  const selected = (order.items ?? []).filter(item => selectedIds.includes(item.id));
  const issue = ORDER_ISSUES.find(row => row.value === type);
  if (!selected.length || !issue || !description.trim()) throw new Error('Select an item and explain the issue.');
  return {
    ticket_type: type,
    subject: `${issue.subjectLabel} - ${selected.map(item => item.product_name_snapshot).join(', ')}${order.order_number ? ` (#${order.order_number})` : ''}`,
    description: [`Issue type: ${issue.subjectLabel}`, 'Selected item(s):', selected.map(item => {
      const summary = feedbackItemSummary(item);
      return `- ${feedbackItemTitle(item)} - ${cents(item.line_total_cents)}${summary ? ` (${summary})` : ''} [order_item_id: ${item.id}]`;
    }).join('\n'), '', 'Customer description:', description.trim()].join('\n'),
    order_id: order.id,
  };
}

export type OrderItemReview = {
  id: string;
  order_id: string;
  order_item_id: string;
  customer_user_id: string;
  rating: number;
  review_body: string | null;
  is_approved_public: boolean;
  admin_reply: string | null;
};

export function validReview(rating: number, body: string): boolean {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 && body.length <= 2000;
}

export function confirmedReview(value: unknown, order: OrderDetail): OrderItemReview {
  const row = value as OrderItemReview | null;
  if (!row?.id || row.order_id !== order.id || row.customer_user_id !== order.customer_user_id ||
      !order.items.some(item => item.id === row.order_item_id) || !validReview(row.rating, row.review_body ?? '')) {
    throw new Error('Unable to confirm the saved review. Please reload reviews.');
  }
  return row;
}
