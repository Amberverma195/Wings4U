const PROMO_REJECTION_PATTERNS = [
  /^invalid or expired promo code$/i,
  /^invalid coupon$/i,
  /^only one deal can be applied at a time$/i,
  /^this promo code is only valid for (delivery|pickup) orders$/i,
  /^this promo code has reached its usage limit$/i,
  /^this promo code can only be used/i,
  /^this promo code is only valid on a first order$/i,
  /^minimum order of .+ required for this promo$/i,
  /^delivery is already free for this order$/i,
  /^cart does not meet requirements for this buy x get y promo$/i,
];

export function isPromoRejectedQuoteError(message?: string | null): boolean {
  const normalized = message?.trim();
  if (!normalized) return false;
  return PROMO_REJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}
