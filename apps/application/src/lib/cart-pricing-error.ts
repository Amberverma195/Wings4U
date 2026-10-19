import { getCartItemIssue } from './cart-validation';
import { isPromoRejectedQuoteError } from './promo-selection';

export type CartPricingRecovery = 'retry' | 'time' | 'delivery' | 'items' | 'coupon' | 'review';

/** Prefer the API envelope's field/code; support existing plain-message failures too. */
export function cartPricingRecovery(cause: unknown): CartPricingRecovery {
  const error = cause as { message?: string; status?: number; body?: { errors?: Array<{ field?: string }> } } | null;
  const message = error?.message ?? '';
  const field = error?.body?.errors?.[0]?.field;
  if (error?.status && (error.status >= 500 || [408, 429].includes(error.status))) return 'retry';
  if (field === 'scheduled_for' || /not open for (pickup|delivery)|selected order time (is unavailable|has expired)|scheduled time must/i.test(message)) return 'time';
  if (getCartItemIssue(cause) || field === 'items') return 'items';
  if (field === 'promo_code' || isPromoRejectedQuoteError(message)) return 'coupon';
  if (['fulfillment_type', 'address_snapshot_json', 'delivery_quote_token'].includes(field ?? '') || /minimum subtotal for delivery|delivery (address|eligibility)|outside.*delivery/i.test(message)) return 'delivery';
  if (error?.status && error.status >= 400 && error.status < 500) return 'review';
  return 'retry';
}
