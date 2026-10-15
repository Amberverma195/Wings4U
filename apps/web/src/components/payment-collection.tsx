"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, getApiErrorMessage } from "@/lib/api";
import { cents } from "@/lib/format";
import "./payment-collection.css";

export type PaymentSummary = {
  collection_preference: string | null;
  collection_preference_label: string;
  payment_status_summary: string;
  payment_method: string | null;
  order_total_cents: number;
  amount_collected_cents: number;
  outstanding_cents: number;
  has_unpaid_balance: boolean;
};

type StaffPaymentRow = {
  id: string;
  transaction_type: string;
  transaction_status: string;
  payment_method: string;
  signed_amount_cents: number;
  terminal_reference: string | null;
  reference_unavailable: boolean;
  outcome: string | null;
  collected_by: string | null;
  failure_reason: string | null;
  created_at: string;
};

type StaffPaymentView = PaymentSummary & {
  order_id: string;
  order_status: string;
  fulfillment_type: string;
  assigned_driver_user_id: string | null;
  assigned_driver_name: string | null;
  payments: StaffPaymentRow[];
  replayed?: boolean;
};

type Method = "CASH" | "CARD";
type Outcome = "SUCCESS" | "DECLINED" | "CANCELLED" | "FAILED" | "NOT_COLLECTED";

const STATUS_LABELS: Record<string, string> = {
  UNPAID: "Unpaid",
  PENDING: "Pending",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
  FAILED: "Failed",
  VOIDED: "Voided",
};

const OUTCOME_OPTIONS: Record<Method, { value: Outcome; label: string }[]> = {
  CASH: [
    { value: "SUCCESS", label: "Cash received" },
    { value: "NOT_COLLECTED", label: "Not collected / refused" },
  ],
  CARD: [
    { value: "SUCCESS", label: "Terminal approved" },
    { value: "DECLINED", label: "Declined" },
    { value: "CANCELLED", label: "Cancelled on terminal" },
    { value: "FAILED", label: "Terminal error" },
    { value: "NOT_COLLECTED", label: "Not collected / refused" },
  ],
};

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  SPLIT: "Split",
  STORE_CREDIT: "Store credit",
  WAIVED: "Waived",
};

function newIdempotencyKey(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `collect-${random}`;
}

function parseDollarsToCents(value: string): number | null {
  if (!/^\d+(\.\d{0,2})?$/.test(value.trim())) return null;
  const amount = Math.round(Number.parseFloat(value) * 100);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function badgeTone(status: string, hasUnpaid: boolean): string {
  if (status === "PAID" && !hasUnpaid) return "paid";
  if (status === "PARTIALLY_PAID" || status === "PENDING") return "partial";
  if (status === "UNPAID" || status === "FAILED") return "unpaid";
  return "neutral";
}

export function paymentStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function PaymentStatusBadge({ summary }: { summary: PaymentSummary }) {
  const tone = badgeTone(summary.payment_status_summary, summary.has_unpaid_balance);
  return (
    <span className={`pay-badge pay-badge--${tone}`}>
      {paymentStatusLabel(summary.payment_status_summary)}
    </span>
  );
}

/** Compact one-line payment state for a KDS ticket. */
export function PaymentStrip({ summary }: { summary: PaymentSummary }) {
  return (
    <div className="pay-strip">
      <PaymentStatusBadge summary={summary} />
      <span>{summary.collection_preference_label}</span>
      {summary.has_unpaid_balance ? (
        <span className="pay-strip__due">{cents(summary.outstanding_cents)} due</span>
      ) : null}
    </div>
  );
}

/** Shown before a completion action: completing never records payment. */
export function UnpaidCompletionWarning({
  summary,
  action,
}: {
  summary: PaymentSummary | null | undefined;
  action: string;
}) {
  if (!summary?.has_unpaid_balance) return null;
  return (
    <div className="pay-collect__warning" role="alert">
      {cents(summary.outstanding_cents)} is still unpaid ({summary.collection_preference_label}).{" "}
      {action} does not record a payment. Record the collection separately, or
      it will stay unpaid for reconciliation.
    </div>
  );
}

export function unpaidCompletionConfirmText(
  summary: PaymentSummary | null | undefined,
  action: string,
): string | null {
  if (!summary?.has_unpaid_balance) return null;
  return `${cents(summary.outstanding_cents)} is still unpaid (${summary.collection_preference_label}). ${action} does not record a payment. Continue?`;
}

type Fetcher = (
  path: string,
  init: RequestInit & { locationId?: string },
) => Promise<Response>;

/**
 * Staff-only payment panel: balance, attempt history and the confirm-before-
 * record collection form. `paymentsPath` is the order's payments resource
 * (KDS: /api/v1/kds/orders/:id/payments, staff: /api/v1/orders/:id/payments).
 */
export function PaymentCollectionPanel({
  paymentsPath,
  locationId,
  fetcher = apiFetch,
  onRecorded,
}: {
  paymentsPath: string;
  locationId: string;
  fetcher?: Fetcher;
  onRecorded?: () => void;
}) {
  const [view, setView] = useState<StaffPaymentView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetcher(paymentsPath, { method: "GET", locationId });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(getApiErrorMessage(body, `Load failed (${res.status})`));
      setView((body?.data ?? body) as StaffPaymentView);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load payments");
    }
  }, [fetcher, locationId, paymentsPath]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) return <p className="surface-error">{loadError}</p>;
  if (!view) return <p className="pay-collect__muted">Loading payment…</p>;

  const canCollect = view.order_status !== "CANCELLED" && view.has_unpaid_balance;

  return (
    <div className="pay-collect">
      <div className="pay-collect__summary">
        <div className="pay-collect__fact">
          <span>Customer preference</span>
          <strong>{view.collection_preference_label}</strong>
        </div>
        <div className="pay-collect__fact">
          <span>Status</span>
          <strong><PaymentStatusBadge summary={view} /></strong>
        </div>
        <div className="pay-collect__fact">
          <span>Order total</span>
          <strong>{cents(view.order_total_cents)}</strong>
        </div>
        <div className="pay-collect__fact">
          <span>Collected</span>
          <strong>{cents(view.amount_collected_cents)}</strong>
        </div>
        <div className={`pay-collect__fact${view.has_unpaid_balance ? " pay-collect__fact--due" : ""}`}>
          <span>Outstanding</span>
          <strong>{cents(view.outstanding_cents)}</strong>
        </div>
        <div className="pay-collect__fact">
          <span>Paid by</span>
          <strong>{view.payment_method ? METHOD_LABELS[view.payment_method] ?? view.payment_method : "—"}</strong>
        </div>
        {view.fulfillment_type === "DELIVERY" ? (
          <div className="pay-collect__fact">
            <span>Driver</span>
            <strong>{view.assigned_driver_name ?? (view.assigned_driver_user_id ? "Assigned" : "Not assigned")}</strong>
          </div>
        ) : null}
      </div>

      {view.payments.length > 0 ? (
        <ul className="pay-collect__history">
          {view.payments.map((row) => {
            const failed = row.transaction_status !== "SUCCESS";
            return (
              <li key={row.id} className={failed ? "pay-collect__history-failed" : undefined}>
                <span>
                  {new Date(row.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {" · "}
                  {row.transaction_type === "REFUND" ? "Refund" : METHOD_LABELS[row.payment_method] ?? row.payment_method}
                  {row.collected_by === "DRIVER" ? " (driver)" : ""}
                  {failed ? ` · ${row.failure_reason ?? row.transaction_status}` : ""}
                </span>
                <span>
                  {row.terminal_reference ? `Ref ${row.terminal_reference} · ` : ""}
                  {row.reference_unavailable ? "No ref · " : ""}
                  {failed ? "Not paid · " : ""}
                  {cents(Math.abs(row.signed_amount_cents))}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {canCollect && !formOpen ? (
        <div className="pay-collect__actions">
          <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
            Record payment
          </button>
        </div>
      ) : null}

      {canCollect && formOpen ? (
        <CollectionForm
          view={view}
          paymentsPath={paymentsPath}
          locationId={locationId}
          fetcher={fetcher}
          onCancel={() => setFormOpen(false)}
          onRecorded={(next) => {
            setView(next);
            setFormOpen(false);
            onRecorded?.();
          }}
        />
      ) : null}
    </div>
  );
}

function CollectionForm({
  view,
  paymentsPath,
  locationId,
  fetcher,
  onCancel,
  onRecorded,
}: {
  view: StaffPaymentView;
  paymentsPath: string;
  locationId: string;
  fetcher: Fetcher;
  onCancel: () => void;
  onRecorded: (next: StaffPaymentView) => void;
}) {
  const isDelivery = view.fulfillment_type === "DELIVERY";
  const [method, setMethod] = useState<Method>(
    view.collection_preference === "CARD_ON_DELIVERY" ? "CARD" : "CASH",
  );
  const [outcome, setOutcome] = useState<Outcome>("SUCCESS");
  const [collectedBy, setCollectedBy] = useState<"STORE" | "DRIVER">(
    isDelivery && view.assigned_driver_user_id ? "DRIVER" : "STORE",
  );
  const [amount, setAmount] = useState((view.outstanding_cents / 100).toFixed(2));
  const [reference, setReference] = useState("");
  const [referenceUnavailable, setReferenceUnavailable] = useState(false);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per confirmation so a double tap or network retry is recorded once.
  const [idempotencyKey] = useState(newIdempotencyKey);

  const amountCents = parseDollarsToCents(amount);
  const isSuccess = outcome === "SUCCESS";
  const needsReference = method === "CARD" && isSuccess && !referenceUnavailable;
  const needsNote =
    outcome === "NOT_COLLECTED" || (method === "CARD" && isSuccess && referenceUnavailable);
  const methodChanged =
    view.collection_preference === "CASH_ON_DELIVERY"
      ? method !== "CASH"
      : view.collection_preference === "CARD_ON_DELIVERY"
        ? method !== "CARD"
        : false;

  const formError =
    amountCents == null
      ? "Enter a valid amount."
      : isSuccess && amountCents > view.outstanding_cents
        ? `Amount is more than the ${cents(view.outstanding_cents)} outstanding.`
        : needsReference && !reference.trim()
          ? "Enter the terminal approval or reference code."
          : needsNote && !note.trim()
            ? "Add a short reason."
            : null;

  const confirmText = isSuccess
    ? method === "CASH"
      ? `I confirm ${amountCents ? cents(amountCents) : "the"} cash is in hand.`
      : `I confirm the terminal shows APPROVED for ${amountCents ? cents(amountCents) : "this amount"}.`
    : "Record this unsuccessful attempt. The order stays unpaid.";

  const submit = async () => {
    if (formError || !confirmed || amountCents == null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetcher(`${paymentsPath}/collect`, {
        method: "POST",
        locationId,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          outcome,
          amount_cents: amountCents,
          collected_by: collectedBy,
          terminal_reference: method === "CARD" && reference.trim() ? reference.trim() : undefined,
          reference_unavailable: method === "CARD" && isSuccess ? referenceUnavailable : undefined,
          note: note.trim() || undefined,
          idempotency_key: idempotencyKey,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(getApiErrorMessage(body, `Could not record (${res.status})`));
      onRecorded((body?.data ?? body) as StaffPaymentView);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record payment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pay-collect__form">
      <div className="pay-collect__label">
        Actual payment method
        <div className="pay-collect__choices">
          {(["CASH", "CARD"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={method === value ? "btn-primary" : "btn-secondary"}
              onClick={() => {
                setMethod(value);
                setOutcome("SUCCESS");
                setConfirmed(false);
              }}
            >
              {value === "CASH" ? "Cash" : "Card terminal"}
            </button>
          ))}
        </div>
      </div>
      {methodChanged ? (
        <p className="pay-collect__muted">
          Customer chose {view.collection_preference_label}. Their original choice stays on the order.
        </p>
      ) : null}

      {isDelivery ? (
        <div className="pay-collect__label">
          Collected by
          <div className="pay-collect__choices">
            <button
              type="button"
              className={collectedBy === "DRIVER" ? "btn-primary" : "btn-secondary"}
              disabled={!view.assigned_driver_user_id}
              onClick={() => setCollectedBy("DRIVER")}
            >
              Driver{view.assigned_driver_name ? ` (${view.assigned_driver_name})` : ""}
            </button>
            <button
              type="button"
              className={collectedBy === "STORE" ? "btn-primary" : "btn-secondary"}
              onClick={() => setCollectedBy("STORE")}
            >
              Store
            </button>
          </div>
        </div>
      ) : null}

      <label className="pay-collect__label">
        Result
        <select
          className="pay-collect__input"
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value as Outcome);
            setConfirmed(false);
          }}
        >
          {OUTCOME_OPTIONS[method].map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {method === "CARD" ? (
        <p className="pay-collect__muted">
          If the terminal still shows pending, wait for it to finish before recording.
        </p>
      ) : null}

      <label className="pay-collect__label">
        Amount
        <input
          className="pay-collect__input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>

      {method === "CARD" ? (
        <>
          <label className="pay-collect__label">
            Terminal approval / reference code
            <input
              className="pay-collect__input"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. APPR 552190"
              autoComplete="off"
              maxLength={64}
              disabled={isSuccess && referenceUnavailable}
            />
          </label>
          <p className="pay-collect__muted">Never enter the card number or CVV.</p>
          {isSuccess ? (
            <label className="pay-collect__check">
              <input
                type="checkbox"
                checked={referenceUnavailable}
                onChange={(e) => setReferenceUnavailable(e.target.checked)}
              />
              The terminal did not give a reference
            </label>
          ) : null}
        </>
      ) : null}

      <label className="pay-collect__label">
        Note{needsNote ? " (required)" : " (optional)"}
        <input
          className="pay-collect__input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder={outcome === "NOT_COLLECTED" ? "e.g. Customer refused the order" : ""}
        />
      </label>

      <label className="pay-collect__check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {confirmText}
      </label>

      {formError ? <p className="pay-collect__muted">{formError}</p> : null}
      {error ? <p className="surface-error" style={{ margin: 0 }}>{error}</p> : null}

      <div className="pay-collect__actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={isSuccess ? "btn-primary" : "btn-danger"}
          onClick={submit}
          disabled={busy || Boolean(formError) || !confirmed}
        >
          {busy ? "Recording…" : isSuccess ? "Confirm payment" : "Record attempt"}
        </button>
      </div>
    </div>
  );
}
