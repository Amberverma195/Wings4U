"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { adminFetch } from "../admin-api";
import styles from "../menu/admin-menu.module.css";

const ADMIN_PROMOS_API_BASE = "/api/v1/admin/promos";

export type PickerSize =
  | { kind: "weight_lb"; weightLb: number; label: string; menuItemId?: string }
  | {
      kind: "modifier_option";
      modifierOptionId: string;
      label: string;
      priceDeltaCents?: number;
    };

export type PickerSelection = {
  categoryId: string;
  categoryName: string;
  productId: string | null;
  productName: string | null;
  size: PickerSize | null;
  label: string;
};

type CategoryRow = {
  id: string;
  name: string;
  itemCount: number;
  hasMultiSizeItems: boolean;
};

type ItemRow = {
  id: string;
  name: string;
  builderType: string | null;
  sizes: PickerSize[];
};

type Props = {
  title: string;
  onClose: () => void;
  onSelect: (selection: PickerSelection) => void;
};

function uniqueSizes(items: ItemRow[]): PickerSize[] {
  const seen = new Map<string, PickerSize>();
  for (const item of items) {
    for (const size of item.sizes) {
      const key =
        size.kind === "weight_lb"
          ? `weight:${size.weightLb}`
          : `option:${size.modifierOptionId}`;
      if (!seen.has(key)) seen.set(key, size);
    }
  }
  return Array.from(seen.values());
}

function selectionLabel(input: {
  categoryName: string;
  productName: string | null;
  size: PickerSize | null;
}) {
  return [input.categoryName, input.productName, input.size?.label]
    .filter(Boolean)
    .join(" - ");
}

export function TargetPickerModal({ title, onClose, onSelect }: Props) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [step, setStep] = useState<"category" | "item" | "size">("category");
  const [activeCategory, setActiveCategory] = useState<CategoryRow | null>(null);
  const [activeItem, setActiveItem] = useState<ItemRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    adminFetch<CategoryRow[]>(`${ADMIN_PROMOS_API_BASE}/targets/categories`)
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Failed to load categories",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const categorySizes = useMemo(() => uniqueSizes(items), [items]);
  const canPickWholeCategory = Boolean(activeCategory);

  async function chooseCategory(category: CategoryRow) {
    setActiveCategory(category);
    setActiveItem(null);
    setItems([]);
    setStep("item");
    setLoading(true);
    setError(null);

    try {
      const rows = await adminFetch<ItemRow[]>(
        `${ADMIN_PROMOS_API_BASE}/targets/categories/${category.id}/items`,
      );
      setItems(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }

  function finalize(input: {
    categoryId: string;
    categoryName: string;
    productId: string | null;
    productName: string | null;
    size: PickerSize | null;
  }) {
    onSelect({
      ...input,
      label: selectionLabel(input),
    });
  }

  function chooseItem(item: ItemRow) {
    if (!activeCategory) return;
    setActiveItem(item);

    if (item.sizes.length > 1) {
      setStep("size");
      return;
    }

    finalize({
      categoryId: activeCategory.id,
      categoryName: activeCategory.name,
      productId: item.id,
      productName: item.name,
      size: item.sizes[0] ?? null,
    });
  }

  function chooseWholeCategory() {
    if (!activeCategory) return;
    setActiveItem(null);

    if (activeCategory.hasMultiSizeItems && categorySizes.length > 1) {
      setStep("size");
      return;
    }

    finalize({
      categoryId: activeCategory.id,
      categoryName: activeCategory.name,
      productId: null,
      productName: null,
      size: categorySizes[0] ?? null,
    });
  }

  function chooseSize(size: PickerSize) {
    if (!activeCategory) return;
    finalize({
      categoryId: activeCategory.id,
      categoryName: activeCategory.name,
      productId: activeItem?.id ?? null,
      productName: activeItem?.name ?? null,
      size,
    });
  }

  const sizeOptions = activeItem?.sizes ?? categorySizes;

  return (
    <div
      className={styles.modalOverlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{ zIndex: 60 }}
    >
      <div className={styles.modalContent} style={{ maxWidth: 720 }}>
        <div className={styles.modalHeader}>
          <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <p style={{ margin: "0.25rem 0 0", color: "#6b7280" }}>
              {step === "category" ? "Pick from live menu categories." : null}
              {step === "item" && activeCategory
                ? `${activeCategory.name}: pick an item`
                : null}
              {step === "size" && activeCategory
                ? `${activeItem?.name ?? activeCategory.name}: pick a size`
                : null}
            </p>
          </div>
          <button type="button" onClick={onClose} className={styles.closeButton}>
            X
          </button>
        </div>

        <div className={styles.modalBody}>
          {error ? <div className={styles.error}>{error}</div> : null}

          {step !== "category" ? (
            <button
              type="button"
              className={styles.btnCancel}
              style={{ marginBottom: 12 }}
              onClick={() => {
                if (step === "size") {
                  setStep("item");
                  setActiveItem(null);
                } else {
                  setStep("category");
                  setActiveCategory(null);
                  setItems([]);
                }
              }}
            >
              Back
            </button>
          ) : null}

          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
              Loading...
            </div>
          ) : null}

          {!loading && step === "category" ? (
            <div style={pickerGridStyle}>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => void chooseCategory(category)}
                  style={pickerCardStyle}
                >
                  <strong style={pickerCardTitle}>{category.name}</strong>
                </button>
              ))}
              {categories.length === 0 ? (
                <div style={{ color: "#6b7280" }}>No live categories found.</div>
              ) : null}
            </div>
          ) : null}

          {!loading && step === "item" && activeCategory ? (
            <div style={{ display: "grid", gap: 12 }}>
              {canPickWholeCategory ? (
                <button
                  type="button"
                  onClick={chooseWholeCategory}
                  style={{ ...pickerCardStyle, background: "#fff7ed" }}
                >
                  <strong style={pickerCardTitle}>
                    Use whole {activeCategory.name} category
                  </strong>
                  <span style={pickerCardMeta}>
                    Any item{categorySizes[0] ? ` - ${categorySizes[0].label}` : ""}
                  </span>
                </button>
              ) : null}

              <div style={pickerGridStyle}>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseItem(item)}
                    style={pickerCardStyle}
                  >
                    <strong style={pickerCardTitle}>{item.name}</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!loading && step === "size" && activeCategory ? (
            <div style={pickerGridStyle}>
              {sizeOptions.map((size) => {
                const key =
                  size.kind === "weight_lb"
                    ? `weight:${size.weightLb}`
                    : `option:${size.modifierOptionId}`;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => chooseSize(size)}
                    style={pickerCardStyle}
                  >
                    <strong style={pickerCardTitle}>{size.label}</strong>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const pickerGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: 12,
};

const pickerCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 4,
  padding: "12px 14px",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "#fff",
  cursor: "pointer",
  textAlign: "left",
};

const pickerCardTitle: CSSProperties = {
  fontSize: "0.95rem",
  color: "#111827",
};

const pickerCardMeta: CSSProperties = {
  fontSize: "0.8rem",
  color: "#6b7280",
};
