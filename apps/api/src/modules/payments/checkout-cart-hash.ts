import { createHash } from "node:crypto";

type CheckoutCartHashInput = {
  location_id: string;
  fulfillment_type: "PICKUP" | "DELIVERY";
  items: unknown[];
  promo_code?: string;
  driver_tip_cents?: number;
  wallet_applied_cents?: number;
  scheduled_for?: string;
  apply_wings_reward?: boolean;
  delivery_quote_token?: string;
  delivery_fee_stated_cents?: number;
  address_snapshot_json?: Record<string, unknown>;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function buildCheckoutCartHash(input: CheckoutCartHashInput): string {
  return createHash("sha256")
    .update(
      stableJson({
        location_id: input.location_id,
        fulfillment_type: input.fulfillment_type,
        items: input.items,
        promo_code: input.promo_code ?? null,
        driver_tip_cents: input.driver_tip_cents ?? 0,
        wallet_applied_cents: input.wallet_applied_cents ?? 0,
        scheduled_for: input.scheduled_for ?? null,
        apply_wings_reward: input.apply_wings_reward ?? false,
        delivery_fee_stated_cents: input.delivery_fee_stated_cents ?? 0,
        address_snapshot_json: input.address_snapshot_json ?? null,
      }),
    )
    .digest("hex");
}

type CheckoutRequestFingerprintInput = {
  location_id: string;
  fulfillment_type: "PICKUP" | "DELIVERY";
  items: unknown[];
  promo_code?: string;
  driver_tip_cents?: number;
  wallet_applied_cents?: number;
  scheduled_for?: string;
  apply_wings_reward?: boolean;
  address_snapshot_json?: Record<string, unknown>;
  payment_method?: "PAY_AT_STORE" | "ONLINE_CARD";
  customer_order_notes?: string;
  contactless_pref?: string;
  is_student_order?: boolean;
  student_id_snapshot?: string;
  stripe_payment_intent_id?: string;
};

/**
 * Stable idempotency fingerprint for place-order replays.
 * Excludes the expiring delivery quote token; covers cart, address, notes,
 * payment method, and other meaningful checkout fields.
 */
export function buildCheckoutRequestFingerprint(
  input: CheckoutRequestFingerprintInput,
): string {
  return createHash("sha256")
    .update(
      stableJson({
        location_id: input.location_id,
        fulfillment_type: input.fulfillment_type,
        items: input.items,
        promo_code: input.promo_code ?? null,
        driver_tip_cents: input.driver_tip_cents ?? 0,
        wallet_applied_cents: input.wallet_applied_cents ?? 0,
        scheduled_for: input.scheduled_for ?? null,
        apply_wings_reward: input.apply_wings_reward ?? false,
        address_snapshot_json: input.address_snapshot_json ?? null,
        payment_method: input.payment_method ?? "PAY_AT_STORE",
        customer_order_notes: input.customer_order_notes ?? null,
        contactless_pref: input.contactless_pref ?? null,
        is_student_order: input.is_student_order ?? false,
        student_id_snapshot: input.student_id_snapshot ?? null,
        stripe_payment_intent_id: input.stripe_payment_intent_id?.trim() || null,
      }),
    )
    .digest("hex");
}
