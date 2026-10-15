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
  let captured = 0;
  let refunded = 0;
  for (const payment of payments) {
    if (
      payment.transactionType === "CAPTURE" ||
      payment.transactionType === "ADJUSTMENT"
    ) {
      captured += payment.signedAmountCents;
    } else if (payment.transactionType === "REFUND") {
      refunded += Math.abs(payment.signedAmountCents);
    }
  }
  return Math.max(0, captured - refunded);
}
