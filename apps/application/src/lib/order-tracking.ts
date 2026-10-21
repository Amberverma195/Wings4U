import { TERMINAL_STATUSES, type OrderDetail, type OrderStatusEvent } from './types';
import { cents, orderStatusCustomerLabel } from './format';

export function deliveryAddress(address: OrderDetail['address_snapshot_json']): string | null {
  if (!address || typeof address !== 'object') return null;
  const parts = [address.line1, address.line2, address.city, address.province, address.postal_code ?? address.postalCode]
    .filter(part => typeof part === 'string' && part.trim().length > 0);
  return parts.length ? parts.join(', ') : null;
}

export function deliveryPreference(value: string | null): string | null {
  return ({ HAND_TO_ME: 'Hand it to me', LEAVE_AT_DOOR: 'Leave at door', CALL_ON_ARRIVAL: 'Call on arrival', TEXT_ON_ARRIVAL: 'Text on arrival' } as Record<string, string>)[value ?? ''] ?? null;
}

export function driverPhoneLabel(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone.trim() || null;
}

export function showDeliveryDetails(order: OrderDetail): boolean {
  const started = Boolean(order.delivery_started_at) || ['OUT_FOR_DELIVERY', 'DELIVERED', 'NO_PIN_DELIVERY', 'NO_SHOW_DELIVERY'].includes(order.status);
  return order.fulfillment_type === 'DELIVERY' && started && Boolean(order.assigned_driver || deliveryAddress(order.address_snapshot_json) || deliveryPreference(order.contactless_pref));
}

export function sortedStatusHistory(order: OrderDetail): OrderStatusEvent[] {
  return [...(order.status_events ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function statusEventCopy(event: OrderStatusEvent, order: OrderDetail): { title: string; detail: string | null } {
  const added = event.event_type === 'CHANGE_REQUEST_APPROVED';
  const legacy = added ? event.reason_text?.trim().match(/^Add-items request .+ approved \(\+(\d+).+\)$/i) : null;
  return { title: added ? 'Item added' : orderStatusCustomerLabel(event.to_status, order.fulfillment_type),
    detail: legacy ? `Additional item - ${cents(Number.parseInt(legacy[1], 10))}` : event.reason_text?.trim() || null };
}

export function isTerminalOrder(order: OrderDetail): boolean { return TERMINAL_STATUSES.has(order.status); }
