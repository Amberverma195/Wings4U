import { Prisma } from "@prisma/client";

export const ACCOUNT_DELETION_POLICY_VERSION = "2026-10-20-review-1";
export const DELETION_AUTHORIZATION_TTL_MS = 5 * 60_000;

// Enabling requires a separately reviewed retention/obligations policy and migration.
// Never default to enabled, including in development.
export function accountDeletionEnabled(): boolean {
  return process.env.ACCOUNT_DELETION_ENABLED === "true" &&
    process.env.ACCOUNT_DELETION_POLICY_VERSION === ACCOUNT_DELETION_POLICY_VERSION;
}

export const TERMINAL_ORDER_STATUSES = [
  "PICKED_UP", "DELIVERED", "NO_SHOW_PICKUP", "NO_SHOW_DELIVERY", "NO_PIN_DELIVERY", "CANCELLED",
] as const;

export const DELETION_BLOCKERS = {
  ACTIVE_ORDERS: "You have active or scheduled orders. Complete them before trying again; deletion will not cancel them.",
  PENDING_PAYMENTS: "A payment is still processing. Wait for its final status before trying again.",
  OUTSTANDING_PAYMENTS: "An order has an unresolved payment balance. Resolve it before trying again.",
  PENDING_REFUNDS: "A refund is unresolved. Complete the refund process before trying again.",
  WALLET_BALANCE: "Your wallet has a nonzero balance. It must be resolved before deletion; no credit will be forfeited or transferred by this action.",
  OPEN_SUPPORT: "You have an unresolved support request or dispute. Resolve it before trying again.",
  OPEN_CANCELLATION: "An order cancellation request is unresolved. Wait for its resolution before trying again.",
  OPEN_CATERING: "A catering inquiry is still open. Resolve it before trying again.",
  REWARD_NOTIFICATION: "A reward notification is processing. Please try again shortly.",
  STAFF_HISTORY: "This account also has staff or business records. It requires a separate records review before deletion.",
  ACCOUNT_HOLD: "Your account has an unresolved financial dispute or records obligation. Deletion cannot complete until it is resolved.",
} as const;
export type DeletionBlockerCode = keyof typeof DELETION_BLOCKERS;

/** No arbitrary JSON strings survive. Financial columns/references remain authoritative. */
export function minimizePricing(value: Prisma.JsonValue): Prisma.InputJsonObject {
  const input = objectValue(value);
  const output: Record<string, Prisma.InputJsonValue | null> = {};
  for (const key of ["item_subtotal_cents", "item_discount_total_cents", "order_discount_total_cents",
    "discounted_subtotal_cents", "taxable_subtotal_cents", "tax_cents", "tax_rate_bps", "delivery_fee_cents",
    "driver_tip_cents", "wallet_applied_cents", "final_payable_cents", "promo_discount_cents"]) {
    if (typeof input[key] === "number" && Number.isFinite(input[key])) output[key] = input[key];
  }
  if (["PAY_AT_STORE", "CASH_ON_DELIVERY", "CARD_ON_DELIVERY"].includes(String(input.collection_preference))) {
    output.collection_preference = input.collection_preference;
  }
  return output;
}

export function minimizePayment(value: Prisma.JsonValue): Prisma.InputJsonObject {
  const input = objectValue(value);
  const output: Record<string, Prisma.InputJsonValue | null> = {};
  for (const key of ["amount", "amount_received"]) {
    if (typeof input[key] === "number" && Number.isFinite(input[key])) output[key] = input[key];
  }
  // Provider identifiers needed for reconciliation. Expanded Stripe objects are
  // reduced to a provider ID; billing/contact fields and all metadata are erased.
  for (const [key, pattern] of Object.entries({ id: /^pi_[A-Za-z0-9]+$/, payment_method: /^pm_[A-Za-z0-9]+$/,
    latest_charge: /^ch_[A-Za-z0-9]+$/ })) {
    const raw = input[key];
    const id = typeof raw === "string" ? raw : objectValue(raw).id;
    if (typeof id === "string" && pattern.test(id)) output[key] = id;
  }
  const enums: Record<string, readonly string[]> = {
    currency: ["cad", "CAD"], status: ["succeeded", "canceled", "requires_payment_method", "requires_capture", "processing"],
    source: ["STAFF_COLLECTION"], outcome: ["SUCCESS", "DECLINED", "CANCELLED", "FAILED"],
    collected_by: ["DRIVER", "CASHIER", "KITCHEN", "MANAGER", "ADMIN"], actor_role: ["ADMIN", "STAFF", "KDS_STATION", "POS_STATION"],
    collection_preference: ["PAY_AT_STORE", "CASH_ON_DELIVERY", "CARD_ON_DELIVERY"],
  };
  for (const [key, allowed] of Object.entries(enums)) {
    if (typeof input[key] === "string" && allowed.includes(input[key])) output[key] = input[key];
  }
  if (typeof input.reference_unavailable === "boolean") output.reference_unavailable = input.reference_unavailable;
  return output;
}

function objectValue(value: unknown): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue> : {};
}
