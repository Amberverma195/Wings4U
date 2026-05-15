"use client";

import {
  Fragment,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
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

const supportFormStyles = {
  shell: {
    color: "#111827",
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  title: {
    margin: "0 0 0.35rem",
    color: "#0f172a",
    fontSize: "1.35rem",
    lineHeight: 1.2,
    fontWeight: 800,
  },
  muted: {
    margin: "0 0 1rem",
    color: "#4b5563",
    fontSize: "0.95rem",
    lineHeight: 1.45,
    fontWeight: 600,
  },
  selectedItemsLine: {
    margin: "0 0 1rem",
    color: "#4b5563",
    fontSize: "0.95rem",
    lineHeight: 1.65,
    fontWeight: 700,
  },
  selectedItemChip: {
    display: "inline-block",
    margin: "0.12rem 0",
    padding: "0.12rem 0.48rem",
    borderRadius: 999,
    border: "1px solid #fed7aa",
    background: "#fff7ed",
    color: "#c2410c",
    fontWeight: 900,
  },
  selectedItemSeparator: {
    color: "#6b7280",
    fontWeight: 700,
  },
  field: {
    marginBottom: "1rem",
  },
  label: {
    display: "block",
    marginBottom: "0.45rem",
    color: "#374151",
    fontSize: "0.82rem",
    fontWeight: 800,
  },
  issueGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "0.5rem",
  },
  issueButton: {
    padding: "0.78rem 0.85rem",
    borderRadius: 12,
    background: "#ffffff",
    color: "#374151",
    fontWeight: 800,
    cursor: "pointer",
    border: "1px solid #e5e7eb",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  },
  issueButtonActive: {
    background: "#fff7ed",
    color: "#c2410c",
    border: "1px solid #f97316",
    boxShadow: "0 0 0 3px rgba(249, 115, 22, 0.12)",
  },
  textarea: {
    width: "100%",
    minHeight: "7rem",
    resize: "vertical",
    padding: "0.85rem 0.95rem",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    background: "#ffffff",
    color: "#111827",
    fontFamily: "inherit",
    fontSize: "0.95rem",
    lineHeight: 1.45,
    outlineColor: "#f97316",
  },
  actionRow: {
    display: "flex",
    gap: "0.75rem",
    alignItems: "stretch",
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    border: "1px solid #ea580c",
    borderRadius: 12,
    background: "#f97316",
    color: "#ffffff",
    fontFamily: "inherit",
    fontWeight: 800,
    cursor: "pointer",
  },
  primaryButtonDisabled: {
    background: "#fed7aa",
    borderColor: "#fdba74",
    color: "#7c2d12",
    cursor: "not-allowed",
  },
  secondaryButton: {
    minHeight: 44,
    padding: "0 1.15rem",
    border: "1px solid #d1d5db",
    borderRadius: 12,
    background: "#ffffff",
    color: "#374151",
    fontFamily: "inherit",
    fontWeight: 800,
    cursor: "pointer",
  },
} satisfies Record<string, CSSProperties>;

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
        <p
          className="surface-muted"
          style={{
            margin: "0 0 1rem",
            color: "#3f2414",
            fontWeight: 700,
          }}
        >
          Select one or more items from your order.
        </p>

        <button
          type="button"
          className="btn-secondary"
          style={{
            marginBottom: "0.75rem",
            color: "#7c2d12",
            borderColor: "#fdba74",
            background: "#fff7ed",
            fontWeight: 800,
          }}
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
                  boxShadow: checked
                    ? "0 0 0 3px rgba(249, 115, 22, 0.12)"
                    : "0 1px 2px rgba(15, 23, 42, 0.04)",
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
                        color: "#334155",
                        fontSize: "0.85rem",
                        lineHeight: 1.35,
                        fontWeight: 700,
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
            style={{
              flex: 1,
              opacity: 1,
              color: hasRequiredItemSelection ? "#ffffff" : "#7c2d12",
              background: hasRequiredItemSelection ? undefined : "#fed7aa",
              border: hasRequiredItemSelection ? undefined : "1px solid #fdba74",
              fontWeight: 800,
            }}
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
          <button
            type="button"
            className="btn-secondary"
            style={{
              color: "#374151",
              background: "#ffffff",
              borderColor: "#d1d5db",
              fontWeight: 800,
            }}
            onClick={onDone}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={supportFormStyles.shell}>
      <h3 style={supportFormStyles.title}>Open a support ticket</h3>
      {selectedItems.length ? (
        <p style={supportFormStyles.selectedItemsLine}>
          <span>For </span>
          {selectedItems.map((item, index) => (
            <Fragment key={item.id}>
              {index > 0 ? (
                <span style={supportFormStyles.selectedItemSeparator}>, </span>
              ) : null}
              <span style={supportFormStyles.selectedItemChip}>
                {itemTitle(item)}
              </span>
            </Fragment>
          ))}
        </p>
      ) : null}

      <div style={supportFormStyles.field}>
        <label style={supportFormStyles.label}>Issue type</label>
        <div
          role="radiogroup"
          aria-label="Issue type"
          style={supportFormStyles.issueGrid}
        >
          {CUSTOMER_SUPPORT_ISSUES.map((issue) => {
            const active = ticketType === issue.value;
            return (
              <button
                key={issue.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTicketType(issue.value)}
                style={{
                  ...supportFormStyles.issueButton,
                  ...(active ? supportFormStyles.issueButtonActive : null),
                }}
              >
                {issue.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={supportFormStyles.field}>
        <label style={supportFormStyles.label}>Please Explain the Issue</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell us what happened..."
          rows={4}
          style={supportFormStyles.textarea}
        />
      </div>

      {error && (
        <p className="surface-error" style={{ marginBottom: "0.75rem" }}>
          {error}
        </p>
      )}

      <div style={supportFormStyles.actionRow}>
        {items.length > 1 ? (
          <button
            type="button"
            style={supportFormStyles.secondaryButton}
            onClick={() => setStep("items")}
            disabled={submitting}
          >
            Back
          </button>
        ) : null}
        <button
          type="button"
          style={{
            ...supportFormStyles.primaryButton,
            ...(submitting || !description.trim() || !hasRequiredItemSelection
              ? supportFormStyles.primaryButtonDisabled
              : null),
          }}
          disabled={submitting || !description.trim() || !hasRequiredItemSelection}
          onClick={() => void submit()}
        >
          {submitting ? "Submitting..." : "Submit ticket"}
        </button>
        <button
          type="button"
          style={supportFormStyles.secondaryButton}
          onClick={onDone}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
