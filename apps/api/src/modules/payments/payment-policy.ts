/**
 * Customer checkout payment policy.
 *
 * Online card payments are off unless ONLINE_PAYMENTS_ENABLED=true.
 * A collection preference records how the customer expects to pay later.
 * It is not a payment and must not mark an order paid.
 */

export type CollectionPreference =
  | "PAY_AT_STORE"
  | "CASH_ON_DELIVERY"
  | "CARD_ON_DELIVERY";

export type FulfillmentType = "PICKUP" | "DELIVERY";

export function onlinePaymentsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ONLINE_PAYMENTS_ENABLED?.trim().toLowerCase() === "true";
}

export function resolveCollectionPreference(
  fulfillmentType: FulfillmentType,
  preference?: string | null,
):
  | { ok: true; preference: CollectionPreference | null }
  | { ok: false; message: string } {
  const value = preference?.trim() || null;
  if (!value) return { ok: true, preference: null };

  if (fulfillmentType === "PICKUP") {
    if (value !== "PAY_AT_STORE") {
      return {
        ok: false,
        message: "Pickup orders can only use Pay at Store.",
      };
    }
    return { ok: true, preference: "PAY_AT_STORE" };
  }

  if (value !== "CASH_ON_DELIVERY" && value !== "CARD_ON_DELIVERY") {
    return {
      ok: false,
      message: "Delivery orders must use Cash on Delivery or Card on Delivery.",
    };
  }
  return { ok: true, preference: value };
}

export function capturedCents(
  payments: { transactionType: string; signedAmountCents: number }[],
): number {
  return payments.reduce((sum, payment) => {
    if (
      payment.transactionType === "CAPTURE" ||
      payment.transactionType === "ADJUSTMENT"
    ) {
      return sum + payment.signedAmountCents;
    }
    return sum;
  }, 0);
}

/** A second successful capture must not be recorded once the order is paid. */
export function isAlreadyFullyCaptured(
  alreadyCapturedCents: number,
  payableCents: number,
): boolean {
  return payableCents > 0 && alreadyCapturedCents >= payableCents;
}

export function netCollectedCents(
  payments: { transactionType: string; signedAmountCents: number }[],
): number {
  return Math.max(0, capturedCents(payments) - refundedCents(payments));
}

export function refundedCents(
  payments: { transactionType: string; signedAmountCents: number }[],
): number {
  return payments.reduce(
    (sum, payment) =>
      payment.transactionType === "REFUND"
        ? sum + Math.abs(payment.signedAmountCents)
        : sum,
    0,
  );
}

export const COLLECTION_PREFERENCE_LABELS: Record<CollectionPreference, string> = {
  PAY_AT_STORE: "Pay at Store",
  CASH_ON_DELIVERY: "Cash on Delivery",
  CARD_ON_DELIVERY: "Card on Delivery",
};

/** Orders placed before collection preferences were stored have none. */
export const MISSING_COLLECTION_PREFERENCE_LABEL = "Not recorded";

export function collectionPreferenceFromSnapshot(
  snapshot: unknown,
): CollectionPreference | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = (snapshot as { collection_preference?: unknown })
    .collection_preference;
  if (
    value === "PAY_AT_STORE" ||
    value === "CASH_ON_DELIVERY" ||
    value === "CARD_ON_DELIVERY"
  ) {
    return value;
  }
  return null;
}

export function collectionPreferenceLabel(
  preference: CollectionPreference | null,
): string {
  return preference
    ? COLLECTION_PREFERENCE_LABELS[preference]
    : MISSING_COLLECTION_PREFERENCE_LABEL;
}

/**
 * Balance for an order from its SUCCESS payment rows.
 * Refunds reduce the amount collected but never reopen a balance due.
 */
export function paymentBalance(
  finalPayableCents: number,
  successfulPayments: { transactionType: string; signedAmountCents: number }[],
  orderStatus?: string | null,
) {
  const captured = capturedCents(successfulPayments);
  const refunded = refundedCents(successfulPayments);
  return {
    captured_cents: captured,
    refunded_cents: refunded,
    collected_cents: Math.max(0, captured - refunded),
    outstanding_cents:
      orderStatus === "CANCELLED" ? 0 : Math.max(0, finalPayableCents - captured),
  };
}

export type PaymentRollupStatus =
  | "UNPAID"
  | "PENDING"
  | "PARTIALLY_PAID"
  | "PAID"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "VOIDED";

export function rollupPaymentStatus(
  successfulPayments: { transactionType: string; signedAmountCents: number }[],
  finalPayableCents: number,
): PaymentRollupStatus {
  if (successfulPayments.length === 0) return "UNPAID";

  let authTotal = 0;
  let voidTotal = 0;
  for (const payment of successfulPayments) {
    if (payment.transactionType === "AUTH") authTotal += payment.signedAmountCents;
    if (payment.transactionType === "VOID") {
      voidTotal += Math.abs(payment.signedAmountCents);
    }
  }
  const captureTotal = capturedCents(successfulPayments);
  const refundTotal = refundedCents(successfulPayments);

  if (voidTotal > 0 && captureTotal === 0) return "VOIDED";
  if (refundTotal > 0 && refundTotal >= captureTotal) return "REFUNDED";
  if (refundTotal > 0 && refundTotal < captureTotal) return "PARTIALLY_REFUNDED";
  if (captureTotal >= finalPayableCents) return "PAID";
  if (captureTotal > 0) return "PARTIALLY_PAID";
  if (authTotal > 0) return "PENDING";
  return "UNPAID";
}

/** Terminal approval codes and reference numbers, never a card number. */
const TERMINAL_REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9_\-./#]{1,63}$/;

/** True when text contains a 13-19 digit run, i.e. something shaped like a card number. */
export function containsPossibleCardNumber(text: string): boolean {
  return /\d{13,19}/.test(text.replace(/[\s-]/g, ""));
}

export function validateTerminalReference(
  reference: string,
): { ok: true; reference: string } | { ok: false; message: string } {
  const value = reference.trim();
  if (containsPossibleCardNumber(value)) {
    return {
      ok: false,
      message:
        "That looks like a card number. Enter the terminal approval or reference code only.",
    };
  }
  if (!TERMINAL_REFERENCE_RE.test(value)) {
    return {
      ok: false,
      message:
        "Terminal reference must be 2-64 letters, numbers or - _ . / # characters.",
    };
  }
  return { ok: true, reference: value };
}
