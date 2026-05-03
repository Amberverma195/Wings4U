"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { adminFetch } from "../admin-api";
import styles from "../menu/admin-menu.module.css";
import {
  TargetPickerModal,
  type PickerSelection,
  type PickerSize,
} from "./target-picker-modal";

const ADMIN_PROMOS_API_BASE = "/api/v1/admin/promos";

type Props = {
  promoId: string | null;
  onClose: () => void;
  onSaved: () => void;
};

type PromoDiscountType = "PERCENT" | "FIXED_AMOUNT" | "BXGY" | "FREE_DELIVERY";
type RedeemType = "BOTH" | "PICKUP" | "DELIVERY";

type BxgyTarget = {
  categoryId: string;
  categoryName: string;
  productId: string;
  productName: string;
  size: PickerSize | null;
};

type BxgyFormState = {
  qualifying: BxgyTarget;
  reward: BxgyTarget;
  requiredQty: number;
  rewardQty: number;
  rewardRule: string;
};

type PromoFormState = {
  code: string;
  name: string;
  discountType: PromoDiscountType;
  discountValue: number;
  minSubtotalCents: number;
  startsAt: string;
  endsAt: string;
  isOneTimePerCustomer: boolean;
  isActive: boolean;
  eligibleFulfillmentType: RedeemType;
  productTargets: string[];
  categoryTargets: string[];
  bxgyRule: BxgyFormState;
};

const EMPTY_TARGET: BxgyTarget = {
  categoryId: "",
  categoryName: "",
  productId: "",
  productName: "",
  size: null,
};

function createEmptyBxgyRule(): BxgyFormState {
  return {
    qualifying: { ...EMPTY_TARGET },
    reward: { ...EMPTY_TARGET },
    requiredQty: 1,
    rewardQty: 1,
    rewardRule: "FREE",
  };
}

function createEmptyForm(): PromoFormState {
  return {
    code: "",
    name: "",
    discountType: "PERCENT",
    discountValue: 0,
    minSubtotalCents: 0,
    startsAt: "",
    endsAt: "",
    isOneTimePerCustomer: false,
    isActive: true,
    eligibleFulfillmentType: "BOTH",
    productTargets: [],
    categoryTargets: [],
    bxgyRule: createEmptyBxgyRule(),
  };
}

function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function normalizeIdArray(
  values: unknown,
  key: "menuItemId" | "menuCategoryId",
): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return "";
      const raw = (entry as Record<string, unknown>)[key];
      return typeof raw === "string" ? raw : "";
    })
    .filter(Boolean);
}

function splitPersistedLabel(label: string | null | undefined): string[] {
  if (!label) return [];
  return label
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);
}

function hydrateSize(value: unknown): PickerSize | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind === "weight_lb") {
    return {
      kind: "weight_lb",
      weightLb: Number(raw.weightLb),
      label: typeof raw.label === "string" ? raw.label : `${raw.weightLb}lb`,
    };
  }
  if (raw.kind === "modifier_option" && typeof raw.modifierOptionId === "string") {
    return {
      kind: "modifier_option",
      modifierOptionId: raw.modifierOptionId,
      label: typeof raw.label === "string" ? raw.label : "Selected size",
    };
  }
  return null;
}

function hydrateTarget(params: {
  productId?: string | null;
  categoryId?: string | null;
  size?: PickerSize | null;
  label?: string | null;
}): BxgyTarget {
  if (!params.productId && !params.categoryId) return { ...EMPTY_TARGET };
  const labelParts = splitPersistedLabel(params.label);
  return {
    categoryId: params.categoryId ?? "",
    categoryName: labelParts[0] ?? "",
    productId: params.productId ?? "",
    productName: params.productId ? labelParts[1] ?? "" : "",
    size: params.size ?? null,
  };
}

function hydrateForm(data: any): PromoFormState {
  const bxgyRule = data?.bxgyRule ?? {};
  const eligibleFulfillmentType =
    data?.eligibleFulfillmentType === "PICKUP" ||
    data?.eligibleFulfillmentType === "DELIVERY"
      ? data.eligibleFulfillmentType
      : "BOTH";

  return {
    code: typeof data?.code === "string" ? data.code : "",
    name: typeof data?.name === "string" ? data.name : "",
    discountType:
      data?.discountType === "FIXED_AMOUNT" ||
      data?.discountType === "BXGY" ||
      data?.discountType === "FREE_DELIVERY"
        ? data.discountType
        : "PERCENT",
    discountValue: Number(data?.discountValue ?? 0),
    minSubtotalCents: Number(data?.minSubtotalCents ?? 0),
    startsAt: toDateTimeLocalValue(data?.startsAt),
    endsAt: toDateTimeLocalValue(data?.endsAt),
    isOneTimePerCustomer: Boolean(data?.isOneTimePerCustomer),
    isActive: data?.isActive !== false,
    eligibleFulfillmentType,
    productTargets: normalizeIdArray(data?.productTargets, "menuItemId"),
    categoryTargets: normalizeIdArray(data?.categoryTargets, "menuCategoryId"),
    bxgyRule: {
      qualifying: hydrateTarget({
        productId: bxgyRule.qualifyingProductId,
        categoryId: bxgyRule.qualifyingCategoryId,
        size: hydrateSize(bxgyRule.qualifyingSize),
        label: bxgyRule.qualifyingLabel,
      }),
      reward: hydrateTarget({
        productId: bxgyRule.rewardProductId,
        categoryId: bxgyRule.rewardCategoryId,
        size: hydrateSize(bxgyRule.rewardSize),
        label: bxgyRule.rewardLabel,
      }),
      requiredQty: Number(bxgyRule.requiredQty ?? 1),
      rewardQty: Number(bxgyRule.rewardQty ?? 1),
      rewardRule:
        typeof bxgyRule.rewardRule === "string" ? bxgyRule.rewardRule : "FREE",
    },
  };
}

function buildSelectionLabel(target: BxgyTarget): string {
  const parts = [target.categoryName, target.productName, target.size?.label]
    .filter(Boolean)
    .join(" - ");
  return parts || "Any item";
}

function sizePayload(size: PickerSize | null) {
  if (!size) return null;
  if (size.kind === "weight_lb") {
    return {
      kind: "weight_lb" as const,
      weightLb: size.weightLb,
      label: size.label,
    };
  }
  return {
    kind: "modifier_option" as const,
    modifierOptionId: size.modifierOptionId,
    label: size.label,
  };
}

function pickerSelectionToTarget(selection: PickerSelection): BxgyTarget {
  return {
    categoryId: selection.categoryId,
    categoryName: selection.categoryName,
    productId: selection.productId ?? "",
    productName: selection.productName ?? "",
    size: selection.size,
  };
}

export function PromoModal({ promoId, onClose, onSaved }: Props) {
  const isEdit = Boolean(promoId);
  const [form, setForm] = useState<PromoFormState>(createEmptyForm);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<"qualifying" | "reward" | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    if (!promoId) {
      setForm(createEmptyForm());
      return;
    }

    adminFetch<any>(`${ADMIN_PROMOS_API_BASE}/${promoId}`)
      .then((data) => {
        if (!cancelled) setForm(hydrateForm(data));
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Failed to load promo code",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [promoId]);

  function setBxgyRule(patch: Partial<BxgyFormState>) {
    setForm((current) => ({
      ...current,
      bxgyRule: { ...current.bxgyRule, ...patch },
    }));
  }

  function handlePickerSelect(selection: PickerSelection) {
    const target = pickerSelectionToTarget(selection);
    if (pickerOpenFor === "qualifying") {
      setBxgyRule({ qualifying: target });
    } else if (pickerOpenFor === "reward") {
      setBxgyRule({ reward: target });
    }
    setPickerOpenFor(null);
  }

  function validateBeforeSubmit(): string | null {
    if (!form.code.trim()) return "Code is required";
    if (!form.name.trim()) return "Internal name is required";
    if (form.discountType === "BXGY") {
      if (form.bxgyRule.requiredQty < 1 || form.bxgyRule.rewardQty < 1) {
        return "Buy and reward quantities must be at least 1";
      }
    }
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validateBeforeSubmit();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      code: form.code,
      name: form.name,
      discountType: form.discountType,
      discountValue: form.discountValue,
      minSubtotalCents: form.minSubtotalCents,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
      isOneTimePerCustomer: form.isOneTimePerCustomer,
      isActive: form.isActive,
      eligibleFulfillmentType:
        form.discountType === "FREE_DELIVERY"
          ? "DELIVERY"
          : form.eligibleFulfillmentType,
      productTargets: form.productTargets.length ? form.productTargets : undefined,
      categoryTargets: form.categoryTargets.length
        ? form.categoryTargets
        : undefined,
      bxgyRule:
        form.discountType === "BXGY"
          ? {
              qualifyingProductId:
                form.bxgyRule.qualifying.productId || undefined,
              qualifyingCategoryId:
                form.bxgyRule.qualifying.categoryId || undefined,
              requiredQty: form.bxgyRule.requiredQty,
              rewardProductId: form.bxgyRule.reward.productId || undefined,
              rewardCategoryId: form.bxgyRule.reward.categoryId || undefined,
              rewardQty: form.bxgyRule.rewardQty,
              rewardRule: form.bxgyRule.rewardRule,
              qualifyingSize: sizePayload(form.bxgyRule.qualifying.size),
              rewardSize: sizePayload(form.bxgyRule.reward.size),
              qualifyingLabel: buildSelectionLabel(form.bxgyRule.qualifying),
              rewardLabel: buildSelectionLabel(form.bxgyRule.reward),
            }
          : undefined,
    };

    try {
      if (isEdit) {
        await adminFetch(`${ADMIN_PROMOS_API_BASE}/${promoId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await adminFetch(ADMIN_PROMOS_API_BASE, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to save promo code",
      );
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!promoId) return;
    if (!window.confirm("Delete this promo code?")) return;

    setArchiving(true);
    setError(null);

    try {
      await adminFetch(`${ADMIN_PROMOS_API_BASE}/${promoId}`, {
        method: "DELETE",
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete");
      setArchiving(false);
    }
  }

  return (
    <div
      className={styles.modalOverlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.modalContent} style={{ maxWidth: 720 }}>
        <div className={styles.modalHeader}>
          <h2>{isEdit ? "Edit Promo Code" : "New Promo Code"}</h2>
          <button type="button" onClick={onClose} className={styles.closeButton}>
            X
          </button>
        </div>

        <form className={styles.modalBody} onSubmit={handleSubmit} style={formStyle}>
          {error ? <div className={styles.error}>{error}</div> : null}

          <div style={twoColumnStyle}>
            <div className={styles.formGroup}>
              <label>Code</label>
              <input
                type="text"
                className={styles.formInput}
                value={form.code}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    code: event.target.value.toUpperCase(),
                  }))
                }
                required
              />
            </div>
            <div className={styles.formGroup}>
              <label>Internal name</label>
              <input
                type="text"
                className={styles.formInput}
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
              />
            </div>
          </div>

          <div style={twoColumnStyle}>
            <div className={styles.formGroup}>
              <label>Discount type</label>
              <select
                className={styles.formInput}
                value={form.discountType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    discountType: event.target.value as PromoDiscountType,
                    discountValue:
                      event.target.value === "FREE_DELIVERY"
                        ? 0
                        : current.discountValue,
                    eligibleFulfillmentType:
                      event.target.value === "FREE_DELIVERY"
                        ? "DELIVERY"
                        : current.eligibleFulfillmentType,
                  }))
                }
              >
                <option value="PERCENT">Percentage off</option>
                <option value="FIXED_AMOUNT">Fixed amount off</option>
                <option value="FREE_DELIVERY">Free delivery</option>
                <option value="BXGY">Free item / Buy X Get Y</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>Redeem type</label>
              <select
                className={styles.formInput}
                value={form.eligibleFulfillmentType}
                disabled={form.discountType === "FREE_DELIVERY"}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    eligibleFulfillmentType: event.target.value as RedeemType,
                  }))
                }
              >
                <option value="BOTH">Both</option>
                <option value="PICKUP">Pickup only</option>
                <option value="DELIVERY">Delivery only</option>
              </select>
            </div>
          </div>

          {form.discountType === "PERCENT" ? (
            <div className={styles.formGroup}>
              <label>Discount value (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                className={styles.formInput}
                value={form.discountValue}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    discountValue: Number.parseInt(event.target.value, 10) || 0,
                  }))
                }
              />
            </div>
          ) : null}

          {form.discountType === "FIXED_AMOUNT" ? (
            <div className={styles.formGroup}>
              <label>Discount value ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={styles.formInput}
                value={form.discountValue / 100}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    discountValue:
                      Math.round(Number.parseFloat(event.target.value) * 100) || 0,
                  }))
                }
              />
            </div>
          ) : null}

          {form.discountType === "BXGY" ? (
            <div style={bxgyPanelStyle}>
              <label style={{ fontWeight: "bold" }}>Free item / BXGY rule</label>

              <div style={twoColumnStyle}>
                <div className={styles.formGroup}>
                  <label>Required quantity (buy)</label>
                  <input
                    type="number"
                    min="1"
                    className={styles.formInput}
                    value={form.bxgyRule.requiredQty}
                    onChange={(event) =>
                      setBxgyRule({
                        requiredQty: Number.parseInt(event.target.value, 10) || 1,
                      })
                    }
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Reward quantity (free)</label>
                  <input
                    type="number"
                    min="1"
                    className={styles.formInput}
                    value={form.bxgyRule.rewardQty}
                    onChange={(event) =>
                      setBxgyRule({
                        rewardQty: Number.parseInt(event.target.value, 10) || 1,
                      })
                    }
                  />
                </div>
              </div>

              <ScopePickerRow
                label="Qualifying scope"
                target={form.bxgyRule.qualifying}
                onAny={() => setBxgyRule({ qualifying: { ...EMPTY_TARGET } })}
                onChooseCategory={() => setPickerOpenFor("qualifying")}
              />

              <ScopePickerRow
                label="Reward scope"
                target={form.bxgyRule.reward}
                onAny={() => setBxgyRule({ reward: { ...EMPTY_TARGET } })}
                onChooseCategory={() => setPickerOpenFor("reward")}
              />

              <p style={helpTextStyle}>
                Tip: leave minimum subtotal at $0.00 to make the reward valid on
                any order.
              </p>
            </div>
          ) : null}

          <div className={styles.formGroup}>
            <label>Minimum order subtotal ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={styles.formInput}
              value={form.minSubtotalCents / 100}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  minSubtotalCents:
                    Math.round(Number.parseFloat(event.target.value) * 100) || 0,
                }))
              }
            />
          </div>

          <div style={twoColumnStyle}>
            <div className={styles.formGroup}>
              <label>Valid from</label>
              <input
                type="datetime-local"
                className={styles.formInput}
                value={form.startsAt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    startsAt: event.target.value,
                  }))
                }
              />
            </div>
            <div className={styles.formGroup}>
              <label>Valid until</label>
              <input
                type="datetime-local"
                className={styles.formInput}
                value={form.endsAt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    endsAt: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={form.isOneTimePerCustomer}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isOneTimePerCustomer: event.target.checked,
                  }))
                }
              />
              One-time use per customer account
            </label>

            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))
                }
              />
              Active
            </label>
          </div>

          <div className={styles.modalFooter} style={{ marginTop: "1rem" }}>
            {isEdit ? (
              <button
                type="button"
                className={styles.btnDanger}
                onClick={handleArchive}
                disabled={archiving}
                style={{ marginRight: "auto" }}
              >
                {archiving ? "Deleting..." : "Delete"}
              </button>
            ) : null}
            <button type="button" onClick={onClose} className={styles.btnCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.btnSave}
              disabled={saving || !form.code.trim()}
            >
              {saving ? "Saving..." : isEdit ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>

      {pickerOpenFor ? (
        <TargetPickerModal
          title={
            pickerOpenFor === "qualifying"
              ? "Pick qualifying category / item"
              : "Pick reward category / item"
          }
          onClose={() => setPickerOpenFor(null)}
          onSelect={handlePickerSelect}
        />
      ) : null}
    </div>
  );
}

function ScopePickerRow({
  label,
  target,
  onAny,
  onChooseCategory,
}: {
  label: string;
  target: BxgyTarget;
  onAny: () => void;
  onChooseCategory: () => void;
}) {
  const hasSelection = Boolean(target.categoryId);

  return (
    <div className={styles.formGroup}>
      <label>{label}</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onAny}
          style={{
            ...scopeButtonStyle,
            ...(hasSelection ? null : activeScopeButtonStyle),
          }}
        >
          Any item
        </button>
        <button type="button" onClick={onChooseCategory} style={scopeButtonStyle}>
          {hasSelection ? `Change - ${buildSelectionLabel(target)}` : "Choose Category"}
        </button>
      </div>
      {hasSelection ? (
        <p style={selectedTextStyle}>
          Selected: <strong>{buildSelectionLabel(target)}</strong>
        </p>
      ) : null}
    </div>
  );
}

const formStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const twoColumnStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "1rem",
};

const bxgyPanelStyle: CSSProperties = {
  padding: "1rem",
  background: "rgba(0,0,0,0.02)",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const helpTextStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.9rem",
  color: "#6b7280",
  lineHeight: 1.5,
};

const selectedTextStyle: CSSProperties = {
  margin: "6px 0 0",
  fontSize: "0.85rem",
  color: "#374151",
};

const scopeButtonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#fff",
  cursor: "pointer",
  fontSize: "0.9rem",
};

const activeScopeButtonStyle: CSSProperties = {
  background: "#fff7ed",
  borderColor: "#f97316",
  color: "#9a3412",
};
