export type FirstOrderDealKind = "FREE_DELIVERY" | "PERCENT" | "FIXED_AMOUNT";

export const FIRST_ORDER_DEAL_CODE_PREFIX = "W4U-FIRST-ORDER-";
export const FIRST_ORDER_DEAL_DISPLAY_CODE = "FIRST ORDER DEAL";

export const FIRST_ORDER_DEAL_KINDS: FirstOrderDealKind[] = [
  "FREE_DELIVERY",
  "PERCENT",
  "FIXED_AMOUNT",
];

export function firstOrderDealCode(
  locationId: string,
  kind: FirstOrderDealKind,
): string {
  return `${FIRST_ORDER_DEAL_CODE_PREFIX}${kind}-${locationId}`.toUpperCase();
}

export function isFirstOrderDealCode(code: string): boolean {
  return code.trim().toUpperCase().startsWith(FIRST_ORDER_DEAL_CODE_PREFIX);
}
