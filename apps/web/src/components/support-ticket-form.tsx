"use client";

import { useCallback, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { cents } from "@/lib/format";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { OrderItem, SupportTicketType } from "@/lib/types";

const DEFAULT_SUPPORT_ISSUE: {
  value: SupportTicketType;
  label: string;
} = { value: "WRONG_ITEM", label: "Wrong item" };

const CUSTOMER_SUPPORT_ISSUES: Array<{
  value: SupportTicketType;
  label: string;
}> = [
  DEFAULT_SUPPORT_ISSUE,
  { value: "MISSING_ITEM", label: "Missing item" },
  { value: "COLD_FOOD", label: "Cold food" },
  { value: "BURNT_FOOD", label: "Burnt food" },
  { value: "OTHER", label: "Other" },
];

function itemTitle(item: OrderItem): string {
  return `${item.product_name_snapshot}${item.quantity > 1 ? ` x${item.quantity}` : ""}`;
}

function itemSummary(item: OrderItem): string {
  const flavourNames = item.flavours
    .map((flavour) => flavour.flavour_name_snapshot)
    .filter(Boolean);
  const modifierNames = item.modifiers
    .map((modifier) => modifier.modifier_name_snapshot)
    .filter(Boolean);
  const parts = [
    item.category_name_snapshot,
    flavourNames.length ? `Flavours: ${flavourNames.join(", ")}` : null,
    modifierNames.length ? `Options: ${modifierNames.join(", ")}` : null,
  ].filter(Boolean);

  return parts.slice(0, 3).join(" / ");
}

function buildTicketDescription({
  issueLabel,
  selectedItems,
  description,
}: {
  issueLabel: string;
  selectedItems: OrderItem[];
  description: string;
}): string {
  const itemLines = selectedItems.length
    ? selectedItems
        .map((item) => {
          const summary = itemSummary(item);
          const detail = summary ? ` (${summary})` : "";
          return `- ${itemTitle(item)} - ${cents(item.line_total_cents)}${detail} [order_item_id: ${item.id}]`;
        })
        .join("\n")
    : "- Whole order";

  return [
    `Issue type: ${issueLabel}`,
    "Selected item(s):",
    itemLines,
    "",
    "Customer description:",
    description.trim(),
  ].join("\n");
}

export function SupportTicketForm({
  orderId,
  orderNumber,
  locationId,
  items = [],
  onDone,
}: {
  orderId: string;
  orderNumber?: number;
  /**
   * Location the order was placed at. `SupportController` is guarded by
   * `LocationScopeGuard`, so `POST /support/tickets` requires a valid
   * `X-Location-Id` UUID header. Missing or malformed => 422
   * "X-Location-Id header must be a valid UUID".
   */
  locationId: string;
  items?: OrderItem[];
  onDone: () => void;
}) {
  const session = useSession();
  const [step, setStep] = useState<"items" | "details">(
    items.length > 1 ? "items" : "details",
  );
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(
    items.length === 1 && items[0]?.id ? [items[0].id] : [],
  );
  const [ticketType, setTicketType] = useState<SupportTicketType>("WRONG_ITEM");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedItemIds.includes(item.id)),
    [items, selectedItemIds],
  );
  const selectedIssue =
    CUSTOMER_SUPPORT_ISSUES.find((issue) => issue.value === ticketType) ??
    DEFAULT_SUPPORT_ISSUE;
  const hasRequiredItemSelection = items.length === 0 || selectedItems.length > 0;

  const toggleItem = useCallback((itemId: string) => {
    setSelectedItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId],
    );
  }, []);

  const submit = useCallback(async () => {
    if (!description.trim() || !hasRequiredItemSelection) return;
    setSubmitting(true);
    setError(null);
    try {
      const subjectItems = selectedItems.length
        ? selectedItems.map((item) => item.product_name_snapshot).join(", ")
        : "Whole order";
      const subject = `${selectedIssue.label} - ${subjectItems}${
        orderNumber ? ` (#${orderNumber})` : ""
      }`;
      const res = await withSilentRefresh(
        () =>
          apiFetch("/api/v1/support/tickets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticket_type: ticketType,
              subject,
              description: buildTicketDescription({
                issueLabel: selectedIssue.label,
                selectedItems,
                description,
              }),
              order_id: orderId,
            }),
            locationId,
          }),
        session.refresh,
        session.clear,
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.errors?.[0]?.message ?? `Failed (${res.status})`);
      }
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  }, [
    orderId,
    orderNumber,
    locationId,
    ticketType,
    selectedIssue.label,
    selectedItems,
    description,
    hasRequiredItemSelection,
    session,
  ]);

  if (success) {
    return (
      <div style={{ textAlign: "center", padding: "1rem 0" }}>
        <h3 style={{ margin: "0 0 0.5rem", color: "var(--accent-strong)" }}>
          Ticket submitted
        </h3>
        <p className="surface-muted">
          Our team will review your request and get back to you.
        </p>
        <button
          type="button"
          className="btn-secondary"
          style={{ marginTop: "0.75rem" }}
          onClick={onDone}
        >
          Close
        </button>
      </div>
    );
  }

  if (step === "items") {
    const allSelected = items.length > 0 && selectedItemIds.length === items.length;

    return (
      <div>
        <h3 style={{ margin: "0 0 0.35rem" }}>Which item had an issue?</h3>
        <p className="surface-muted" style={{ margin: "0 0 1rem" }}>
          Select one or more items from your order.
        </p>

        <button
          type="button"
          className="btn-secondary"
          style={{ marginBottom: "0.75rem" }}
          onClick={() =>
            setSelectedItemIds(allSelected ? [] : items.map((item) => item.id))
          }
        >
          {allSelected ? "Clear selection" : "Select all"}
        </button>

        <div style={{ display: "grid", gap: "0.65rem", marginBottom: "1rem" }}>
          {items.map((item) => {
            const checked = selectedItemIds.includes(item.id);
            const summary = itemSummary(item);
            return (
              <label
                key={item.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: "0.75rem",
                  alignItems: "center",
                  width: "100%",
                  padding: "0.85rem",
                  borderRadius: 14,
                  border: checked ? "1px solid #f97316" : "1px solid #e5e7eb",
                  background: checked ? "#fff7ed" : "#fff",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleItem(item.id)}
                  aria-label={`Select ${item.product_name_snapshot}`}
                />
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", color: "#111827" }}>
                    {itemTitle(item)}
                  </strong>
                  {summary ? (
                    <span
                      style={{
                        display: "block",
                        marginTop: 3,
                        color: "#6b7280",
                        fontSize: "0.85rem",
                        lineHeight: 1.35,
                      }}
                    >
                      {summary}
                    </span>
                  ) : null}
                </span>
                <strong style={{ color: "#111827", whiteSpace: "nowrap" }}>
                  {cents(item.line_total_cents)}
                </strong>
              </label>
            );
          })}
        </div>

        {error && (
          <p className="surface-error" style={{ marginBottom: "0.75rem" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            className="btn-primary"
            style={{ flex: 1 }}
            disabled={!hasRequiredItemSelection}
            onClick={() => {
              if (!hasRequiredItemSelection) {
                setError("Select at least one item to continue.");
                return;
              }
              setError(null);
              setStep("details");
            }}
          >
            Continue
          </button>
          <button type="button" className="btn-secondary" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ margin: "0 0 0.35rem" }}>Open a support ticket</h3>
      {selectedItems.length ? (
        <p className="surface-muted" style={{ margin: "0 0 1rem" }}>
          For {selectedItems.map((item) => itemTitle(item)).join(", ")}
        </p>
      ) : null}

      <div className="checkout-field">
        <label>Issue type</label>
        <div
          role="radiogroup"
          aria-label="Issue type"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: "0.5rem",
          }}
        >
          {CUSTOMER_SUPPORT_ISSUES.map((issue) => (
            <button
              key={issue.value}
              type="button"
              role="radio"
              aria-checked={ticketType === issue.value}
              onClick={() => setTicketType(issue.value)}
              style={{
                padding: "0.7rem 0.8rem",
                borderRadius: 12,
                border:
                  ticketType === issue.value
                    ? "1px solid #f97316"
                    : "1px solid #e5e7eb",
                background: ticketType === issue.value ? "#fff7ed" : "#fff",
                color: ticketType === issue.value ? "#c2410c" : "#374151",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {issue.label}
            </button>
          ))}
        </div>
      </div>

      <div className="checkout-field">
        <label>Tell us what happened</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell us what happened..."
          rows={4}
        />
      </div>

      {error && (
        <p className="surface-error" style={{ marginBottom: "0.75rem" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: "0.75rem" }}>
        {items.length > 1 ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setStep("items")}
            disabled={submitting}
          >
            Back
          </button>
        ) : null}
        <button
          type="button"
          className="btn-primary"
          style={{ flex: 1 }}
          disabled={submitting || !description.trim() || !hasRequiredItemSelection}
          onClick={() => void submit()}
        >
          {submitting ? "Submitting..." : "Submit ticket"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onDone}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
