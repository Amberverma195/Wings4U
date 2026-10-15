import {
  collectionPreferenceFromSnapshot,
  collectionPreferenceLabel,
  paymentBalance,
} from "./payment-policy";

type SummaryOrder = {
  status?: string | null;
  finalPayableCents: number;
  paymentStatusSummary?: string | null;
  paymentMethod?: string | null;
  pricingSnapshotJson?: unknown;
  netPaidAmountCents?: number | null;
};

type PaymentRow = {
  id?: string;
  transactionType: string;
  transactionStatus?: string;
  paymentMethod?: string;
  signedAmountCents: number;
  provider?: string | null;
  providerTransactionId?: string | null;
  processorPayloadJson?: unknown;
  failureReason?: string | null;
  initiatedByUserId?: string | null;
  createdByUserId?: string | null;
  createdAt?: Date | string;
};

const SETTLED_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);

function payloadOf(row: PaymentRow): Record<string, unknown> {
  const payload = row.processorPayloadJson;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Payment state shared by customer and staff order views. Pass only SUCCESS
 * rows; when rows were not loaded the stored order rollup is used instead.
 */
export function serializePaymentSummary(
  order: SummaryOrder,
  successfulPayments?: PaymentRow[],
) {
  const preference = collectionPreferenceFromSnapshot(order.pricingSnapshotJson);
  let collected: number;
  let outstanding: number;
  if (successfulPayments) {
    const balance = paymentBalance(
      order.finalPayableCents,
      successfulPayments,
      order.status,
    );
    collected = balance.collected_cents;
    outstanding = balance.outstanding_cents;
  } else {
    collected = order.netPaidAmountCents ?? 0;
    outstanding =
      order.status === "CANCELLED" ||
      SETTLED_STATUSES.has(order.paymentStatusSummary ?? "")
        ? 0
        : Math.max(0, order.finalPayableCents - collected);
  }

  return {
    collection_preference: preference,
    collection_preference_label: collectionPreferenceLabel(preference),
    payment_status_summary: order.paymentStatusSummary ?? "UNPAID",
    payment_method: order.paymentMethod ?? null,
    order_total_cents: order.finalPayableCents,
    amount_collected_cents: collected,
    outstanding_cents: outstanding,
    has_unpaid_balance: outstanding > 0,
  };
}

/** Customer-safe payment row: no references, actors, notes or failed attempts. */
export function serializeCustomerPaymentRow(row: PaymentRow) {
  return {
    id: row.id,
    transaction_type: row.transactionType,
    payment_method: row.paymentMethod,
    signed_amount_cents: row.signedAmountCents,
    created_at: row.createdAt,
  };
}

export function serializeStaffPaymentRow(row: PaymentRow) {
  const payload = payloadOf(row);
  return {
    id: row.id,
    transaction_type: row.transactionType,
    transaction_status: row.transactionStatus,
    payment_method: row.paymentMethod,
    signed_amount_cents: row.signedAmountCents,
    provider: row.provider ?? null,
    terminal_reference:
      row.providerTransactionId ?? stringOrNull(payload.terminal_reference),
    reference_unavailable: payload.reference_unavailable === true,
    outcome: stringOrNull(payload.outcome),
    collected_by: stringOrNull(payload.collected_by),
    actor_role: stringOrNull(payload.actor_role),
    failure_reason: row.failureReason ?? null,
    note: stringOrNull(payload.note),
    initiated_by_user_id: row.initiatedByUserId ?? null,
    created_by_user_id: row.createdByUserId ?? null,
    created_at: row.createdAt,
  };
}
