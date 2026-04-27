"use client";

import { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../admin-api";
import styles from "../menu/admin-menu.module.css";

const ADMIN_PROMOS_API_BASE = "/api/v1/admin/promos";
const ADMIN_MENU_API_BASE = "/api/v1/admin/menu";

type Props = {
  promoId: string | null;
  onClose: () => void;
  onSaved: () => void;
};

type MenuCategoryOption = {
  id: string;
  name: string;
};

type MenuItemOption = {
  id: string;
  name: string;
  category?: { id: string; name: string } | null;
};

type PromoDiscountType = "PERCENT" | "FIXED_AMOUNT" | "BXGY" | "FREE_DELIVERY";
type TargetMode = "ANY" | "CATEGORY" | "PRODUCT";

type BxgyFormState = {
  qualifyingProductId: string;
  qualifyingCategoryId: string;
  requiredQty: number;
  rewardProductId: string;
  rewardCategoryId: string;
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
  productTargets: string[];
  categoryTargets: string[];
  bxgyRule: BxgyFormState;
};

function createEmptyBxgyRule(): BxgyFormState {
  return {
    qualifyingProductId: "",
    qualifyingCategoryId: "",
    requiredQty: 1,
    rewardProductId: "",
    rewardCategoryId: "",
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

function readTargetMode(productId?: string | null, categoryId?: string | null): TargetMode {
  if (productId) return "PRODUCT";
  if (categoryId) return "CATEGORY";
  return "ANY";
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
      const candidate = entry as Record<string, unknown>;
      const raw = candidate[key];
      return typeof raw === "string" ? raw : "";
    })
    .filter(Boolean);
}

function hydrateForm(data: any): PromoFormState {
  const bxgyRule = data?.bxgyRule ?? {};
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
    productTargets: normalizeIdArray(data?.productTargets, "menuItemId"),
    categoryTargets: normalizeIdArray(data?.categoryTargets, "menuCategoryId"),
    bxgyRule: {
      qualifyingProductId:
        typeof bxgyRule.qualifyingProductId === "string"
          ? bxgyRule.qualifyingProductId
          : "",
      qualifyingCategoryId:
        typeof bxgyRule.qualifyingCategoryId === "string"
          ? bxgyRule.qualifyingCategoryId
          : "",
      requiredQty: Number(bxgyRule.requiredQty ?? 1),
      rewardProductId:
        typeof bxgyRule.rewardProductId === "string"
          ? bxgyRule.rewardProductId
          : "",
      rewardCategoryId:
        typeof bxgyRule.rewardCategoryId === "string"
          ? bxgyRule.rewardCategoryId
          : "",
      rewardQty: Number(bxgyRule.rewardQty ?? 1),
      rewardRule:
        typeof bxgyRule.rewardRule === "string" ? bxgyRule.rewardRule : "FREE",
    },
  };
}

export function PromoModal({ promoId, onClose, onSaved }: Props) {
  const isEdit = !!promoId;
  const [categories, setCategories] = useState<MenuCategoryOption[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemOption[]>([]);
  const [form, setForm] = useState<PromoFormState>(createEmptyForm);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadModalData() {
      try {
        const [categoryData, itemData, promoData] = await Promise.all([
          adminFetch<MenuCategoryOption[]>(`${ADMIN_MENU_API_BASE}/categories`),
          adminFetch<MenuItemOption[]>(`${ADMIN_MENU_API_BASE}/items`),
          promoId
            ? adminFetch<any>(`${ADMIN_PROMOS_API_BASE}/${promoId}`)
            : Promise.resolve(null),
        ]);

        if (cancelled) return;
        setCategories(categoryData);
        setMenuItems(itemData);
        setForm(promoData ? hydrateForm(promoData) : createEmptyForm());
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Failed to load promo builder data",
          );
        }
      }
    }

    void loadModalData();

    return () => {
      cancelled = true;
    };
  }, [promoId]);

  const qualifyingMode = useMemo(
    () =>
      readTargetMode(
        form.bxgyRule.qualifyingProductId,
        form.bxgyRule.qualifyingCategoryId,
      ),
    [form.bxgyRule.qualifyingCategoryId, form.bxgyRule.qualifyingProductId],
  );
  const rewardMode = useMemo(
    () =>
      readTargetMode(
        form.bxgyRule.rewardProductId,
        form.bxgyRule.rewardCategoryId,
      ),
    [form.bxgyRule.rewardCategoryId, form.bxgyRule.rewardProductId],
  );

  const menuItemOptions = useMemo(
    () =>
      menuItems.map((item) => ({
        value: item.id,
        label: `${item.category?.name ?? "Uncategorized"} · ${item.name}`,
      })),
    [menuItems],
  );

  function setBxgyRule(patch: Partial<BxgyFormState>) {
    setForm((current) => ({
      ...current,
      bxgyRule: {
        ...current.bxgyRule,
        ...patch,
      },
    }));
  }

  function handleTargetModeChange(kind: "qualifying" | "reward", mode: TargetMode) {
    if (kind === "qualifying") {
      if (mode === "ANY") {
        setBxgyRule({ qualifyingCategoryId: "", qualifyingProductId: "" });
      } else if (mode === "CATEGORY") {
        setBxgyRule({ qualifyingProductId: "" });
      } else {
        setBxgyRule({ qualifyingCategoryId: "" });
      }
      return;
    }

    if (mode === "ANY") {
      setBxgyRule({ rewardCategoryId: "", rewardProductId: "" });
    } else if (mode === "CATEGORY") {
      setBxgyRule({ rewardProductId: "" });
    } else {
      setBxgyRule({ rewardCategoryId: "" });
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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
      productTargets: form.productTargets.length ? form.productTargets : undefined,
      categoryTargets: form.categoryTargets.length ? form.categoryTargets : undefined,
      bxgyRule:
        form.discountType === "BXGY"
          ? {
              qualifyingProductId:
                form.bxgyRule.qualifyingProductId || undefined,
              qualifyingCategoryId:
                form.bxgyRule.qualifyingCategoryId || undefined,
              requiredQty: form.bxgyRule.requiredQty,
              rewardProductId: form.bxgyRule.rewardProductId || undefined,
              rewardCategoryId: form.bxgyRule.rewardCategoryId || undefined,
              rewardQty: form.bxgyRule.rewardQty,
              rewardRule: form.bxgyRule.rewardRule,
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
          <button onClick={onClose} className={styles.closeButton}>
            &#x2715;
          </button>
        </div>

        <form
          className={styles.modalBody}
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
        >
          {error ? <div className={styles.error}>{error}</div> : null}

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}
          >
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
                }))
              }
            >
              <option value="PERCENT">Percentage off</option>
              <option value="FIXED_AMOUNT">Fixed amount off</option>
              <option value="FREE_DELIVERY">Free delivery</option>
              <option value="BXGY">Free item / Buy X Get Y</option>
            </select>
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
                step="0.01"
                min="0"
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
            <div
              style={{
                padding: "1rem",
                background: "rgba(0,0,0,0.02)",
                borderRadius: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              <label style={{ fontWeight: "bold" }}>Free item / BXGY rule</label>

              <div
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}
              >
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
                  <label>Qualifying scope</label>
                  <select
                    className={styles.formInput}
                    value={qualifyingMode}
                    onChange={(event) =>
                      handleTargetModeChange(
                        "qualifying",
                        event.target.value as TargetMode,
                      )
                    }
                  >
                    <option value="ANY">Any item</option>
                    <option value="CATEGORY">Specific category</option>
                    <option value="PRODUCT">Specific item</option>
                  </select>
                </div>
              </div>

              {qualifyingMode === "CATEGORY" ? (
                <div className={styles.formGroup}>
                  <label>Qualifying category</label>
                  <select
                    className={styles.formInput}
                    value={form.bxgyRule.qualifyingCategoryId}
                    onChange={(event) =>
                      setBxgyRule({ qualifyingCategoryId: event.target.value })
                    }
                  >
                    <option value="">Choose a category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {qualifyingMode === "PRODUCT" ? (
                <div className={styles.formGroup}>
                  <label>Qualifying item</label>
                  <select
                    className={styles.formInput}
                    value={form.bxgyRule.qualifyingProductId}
                    onChange={(event) =>
                      setBxgyRule({ qualifyingProductId: event.target.value })
                    }
                  >
                    <option value="">Choose an item</option>
                    {menuItemOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}
              >
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
                <div className={styles.formGroup}>
                  <label>Reward scope</label>
                  <select
                    className={styles.formInput}
                    value={rewardMode}
                    onChange={(event) =>
                      handleTargetModeChange(
                        "reward",
                        event.target.value as TargetMode,
                      )
                    }
                  >
                    <option value="ANY">Any item</option>
                    <option value="CATEGORY">Specific category</option>
                    <option value="PRODUCT">Specific item</option>
                  </select>
                </div>
              </div>

              {rewardMode === "CATEGORY" ? (
                <div className={styles.formGroup}>
                  <label>Reward category</label>
                  <select
                    className={styles.formInput}
                    value={form.bxgyRule.rewardCategoryId}
                    onChange={(event) =>
                      setBxgyRule({ rewardCategoryId: event.target.value })
                    }
                  >
                    <option value="">Choose a category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {rewardMode === "PRODUCT" ? (
                <div className={styles.formGroup}>
                  <label>Reward item</label>
                  <select
                    className={styles.formInput}
                    value={form.bxgyRule.rewardProductId}
                    onChange={(event) =>
                      setBxgyRule({ rewardProductId: event.target.value })
                    }
                  >
                    <option value="">Choose an item</option>
                    {menuItemOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <p
                style={{
                  margin: 0,
                  fontSize: "0.9rem",
                  color: "#6b7280",
                  lineHeight: 1.5,
                }}
              >
                Tip: leave minimum subtotal at <strong>$0.00</strong> to make the
                reward valid on any order.
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

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}
          >
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
    </div>
  );
}
