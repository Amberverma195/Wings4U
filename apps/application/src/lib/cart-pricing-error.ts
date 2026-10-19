import { getCartItemIssue } from './cart-validation';
import { isPromoRejectedQuoteError } from './promo-selection';

export type CartPricingRecovery = 'retry' | 'sign_in' | 'add_items' | 'time' | 'delivery' | 'items' | 'coupon' | 'review';

/** Prefer the API envelope's field/code; support existing plain-message failures too. */
export function cartPricingRecovery(cause: unknown): CartPricingRecovery {
  const error = cause as { message?: string; status?: number; code?: string; body?: { errors?: Array<{ field?: string; code?: string; message?: string }> } } | null;
  const message = error?.message ?? '';
  const field = error?.body?.errors?.[0]?.field;
  const codes = [error?.code, ...(error?.body?.errors?.map(row => row.code) ?? [])].filter(Boolean).join(' ');
  const messages = [message, ...(error?.body?.errors?.map(row => row.message) ?? [])].filter(Boolean).join(' ');
  if (error?.status === 401) return 'sign_in';
  if (error?.status && (error.status >= 500 || [408, 429].includes(error.status))) return 'retry';
  if (/\b(UNAUTHENTICATED|UNAUTHORIZED|AUTH_REQUIRED|AUTHENTICATION_REQUIRED|SESSION_EXPIRED|EXPIRED_SESSION|TOKEN_EXPIRED|INVALID_TOKEN)\b/i.test(codes) ||
    /unauthenticated|unauthorized|authentication required|(?:session|token) (?:has )?expired|expired (?:session|token)|(?:sign|log)[ -]?in (?:is )?required/i.test(messages)) return 'sign_in';
  // Minimum failures share fulfillment_type with delivery settings errors.
  if (/\b(DELIVERY_MINIMUM(?:_NOT_MET)?|MINIMUM_DELIVERY_SUBTOTAL|INSUFFICIENT_SUBTOTAL)\b/i.test(codes) ||
    /minimum subtotal for delivery|delivery minimum|minimum delivery (?:subtotal|order)|insufficient subtotal|subtotal.*(?:below|less than|minimum)/i.test(messages)) return 'add_items';
  if (field === 'scheduled_for' || /not open for (pickup|delivery)|selected order time (is unavailable|has expired)|scheduled time must/i.test(message)) return 'time';
  if (getCartItemIssue(cause) || field === 'items') return 'items';
  if (field === 'promo_code' || isPromoRejectedQuoteError(message)) return 'coupon';
  if (['fulfillment_type', 'address_snapshot_json', 'delivery_quote_token'].includes(field ?? '') || /delivery (address|eligibility)|outside.*delivery/i.test(message)) return 'delivery';
  if (error?.status && error.status >= 400 && error.status < 500) return 'review';
  return 'retry';
}
