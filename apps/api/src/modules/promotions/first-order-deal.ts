export type FirstOrderDealKind = "FREE_DELIVERY" | "PERCENT" | "FIXED_AMOUNT";

export const FIRST_ORDER_DEAL_CODE_PREFIX = "W4U-FIRST-ORDER-";
export const DEFAULT_FIRST_ORDER_DEAL_PUBLIC_CODE = "MYFIRSTORDER";

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

export function normalizeFirstOrderDealPublicCode(code?: string | null): string {
  const normalized = (code ?? DEFAULT_FIRST_ORDER_DEAL_PUBLIC_CODE)
    .trim()
    .toUpperCase();
  return normalized || DEFAULT_FIRST_ORDER_DEAL_PUBLIC_CODE;
}
