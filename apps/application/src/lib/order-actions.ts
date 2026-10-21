import { ACTIVE_STATUSES, type OrderDetail } from './types';

/** The server owns the deadline; opening the screen never extends it. */
export function canCancelOrder(order: Pick<OrderDetail, 'status' | 'cancel_allowed_until'>, now = Date.now()): boolean {
  return (order.status === 'PLACED' || order.status === 'ACCEPTED') &&
    Boolean(order.cancel_allowed_until) && Date.parse(order.cancel_allowed_until!) > now;
}

/** Mirrors the website status-row guard, including its required deadline. */
export function canShowOrderAssistance(order: Pick<OrderDetail, 'status' | 'cancel_allowed_until'>, now = Date.now()): boolean {
  return ACTIVE_STATUSES.has(order.status) && Boolean(order.cancel_allowed_until) && !canCancelOrder(order, now);
}

export function storeTelephoneUri(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 ? `tel:${phone.trim().startsWith('+') ? '+' : ''}${digits}` : null;
}

export const ORDER_CHAT_SUGGESTIONS = [
  'Where is my order?',
  'I want to cancel my order',
  'I want to change my delivery address',
  'Something is missing from my order',
  'Other issue',
] as const;
