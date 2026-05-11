"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { adminFetch, adminApiFetch } from "../admin-api";
import styles from "./admin-menu.module.css";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ADMIN_MENU_API_BASE = "/api/v1/admin/menu";

type Props = {
  itemId: string | null;
  categories: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
};

type IngredientRow = { name: string; sortOrder: number };
type ScheduleRow = { day_of_week: number; time_from: string; time_to: string };
type ModGroupRef = { id: string };
type AvailableModGroup = {
  id: string;
  name: string;
  displayLabel: string;
  selectionMode: string;
  isRequired: boolean;
  options: Array<{ id: string; name: string; priceDeltaCents: number }>;
};

type FormState = {
  name: string;
  description: string;
  base_price_cents: number;
  category_id: string;
  stock_status: "NORMAL" | "LOW_STOCK" | "UNAVAILABLE";
  is_hidden: boolean;
  allowed_fulfillment_type: "BOTH" | "PICKUP" | "DELIVERY";
  modifier_groups: ModGroupRef[];
  removable_ingredients: IngredientRow[];
  schedules: ScheduleRow[];
};

export function MenuItemModal({ itemId, categories, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    base_price_cents: 0,
    category_id: categories[0]?.id || "",
    stock_status: "NORMAL",
    is_hidden: false,
    allowed_fulfillment_type: "BOTH",
    modifier_groups: [],
    removable_ingredients: [],
    schedules: [],
  });

  const [loading, setLoading] = useState(!!itemId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [availableModGroups, setAvailableModGroups] = useState<AvailableModGroup[]>([]);

  // Load available modifier groups for the location
  useEffect(() => {
    let cancelled = false;
    adminFetch<AvailableModGroup[]>(`${ADMIN_MENU_API_BASE}/modifier-groups`)
      .then((data) => {
        if (!cancelled) setAvailableModGroups(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Load existing item data
  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;

    async function load() {
      try {
        const data = await adminFetch<any>(
          `${ADMIN_MENU_API_BASE}/items/${itemId}`,
        );
        if (cancelled) return;

        setForm({
          name: data.name,
          description: data.description || "",
          base_price_cents: data.basePriceCents,
          category_id: data.categoryId,
          stock_status: data.stockStatus,
          is_hidden: data.isHidden,
          allowed_fulfillment_type: data.allowedFulfillmentType,
          modifier_groups: (data.modifierGroups || []).map(
            (mg: any) => ({ id: mg.modifierGroupId } as ModGroupRef),
          ),
          removable_ingredients: (data.removableIngredients || []).map(
            (ri: any) => ({ name: ri.name, sortOrder: ri.sortOrder }),
          ),
          schedules: (data.schedules || []).map((s: any) => {
            const from = new Date(s.timeFrom);
            const to = new Date(s.timeTo);
            return {
              day_of_week: s.dayOfWeek,
              time_from: `${String(from.getUTCHours()).padStart(2, "0")}:${String(from.getUTCMinutes()).padStart(2, "0")}`,
              time_to: `${String(to.getUTCHours()).padStart(2, "0")}:${String(to.getUTCMinutes()).padStart(2, "0")}`,
            };
          }),
        });

        setImageRemoved(false);
        setImageFile(null);

        if (data.imageUrl) {
          setImagePreview(data.imageUrl);
        } else {
          setImagePreview(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load item");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [itemId]);

  // ── Field helpers ──

  const set = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  // ── Ingredients ──

  const addIngredient = () =>
    set("removable_ingredients", [
      ...form.removable_ingredients,
      { name: "", sortOrder: form.removable_ingredients.length },
    ]);

  const updateIngredient = (idx: number, name: string) => {
    const next = [...form.removable_ingredients];
    next[idx] = { ...next[idx], name };
    set("removable_ingredients", next);
  };

  const removeIngredient = (idx: number) =>
    set(
      "removable_ingredients",
      form.removable_ingredients
        .filter((_, i) => i !== idx)
        .map((ri, i) => ({ ...ri, sortOrder: i })),
    );

  // ── Schedules ──

  const addSchedule = () =>
    set("schedules", [
      ...form.schedules,
      { day_of_week: 0, time_from: "09:00", time_to: "21:00" },
    ]);

  const updateSchedule = (
    idx: number,
    field: keyof ScheduleRow,
    value: string | number,
  ) => {
    const next = [...form.schedules];
    next[idx] = { ...next[idx], [field]: value };
    set("schedules", next);
  };

  const removeSchedule = (idx: number) =>
    set("schedules", form.schedules.filter((_, i) => i !== idx));

  // ── Modifier groups ──

  const linkedGroupIds = new Set(form.modifier_groups.map((mg) => mg.id));

  const toggleModGroup = (groupId: string) => {
    if (linkedGroupIds.has(groupId)) {
      set(
        "modifier_groups",
        form.modifier_groups.filter((mg) => mg.id !== groupId),
      );
    } else {
      set("modifier_groups", [...form.modifier_groups, { id: groupId }]);
    }
  };

  // ── Image ──

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setImageRemoved(false);
    e.target.value = "";
  };

  const handleImageRemove = () => {
    setImageFile(null);
    setImagePreview(null);
    setImageRemoved(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Submit ──

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      let savedId = itemId;

      if (!itemId) {
        const created = await adminFetch<{ id: string }>(
          `${ADMIN_MENU_API_BASE}/items`,
          { method: "POST", body: JSON.stringify(form) },
        );
        savedId = created.id;
      } else {
        await adminFetch(`${ADMIN_MENU_API_BASE}/items/${itemId}`, {
          method: "PUT",
          body: JSON.stringify(form),
        });
      }

      // Image
      if (imageFile && savedId) {
        const fd = new FormData();
        fd.append("image", imageFile);
        const res = await adminApiFetch(
          `${ADMIN_MENU_API_BASE}/items/${savedId}/image`,
          { method: "POST", body: fd },
        );
        if (!res.ok) throw new Error("Failed to upload image");
      } else if (imageRemoved && savedId) {
        await adminApiFetch(`${ADMIN_MENU_API_BASE}/items/${savedId}/image`, {
          method: "DELETE",
        });
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save item");
      setSaving(false);
    }
  };

  // ── Render ──

  return (
    <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <h2>{itemId ? "Edit Item" : "Add Item"}</h2>
          <button onClick={onClose} className={styles.closeButton}>
            &#x2715;
          </button>
        </div>

        {loading ? (
          <div className={styles.loader}>Loading...</div>
        ) : (
          <form className={styles.modalBody} onSubmit={handleSubmit}>
            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.modalIntro}>
              <div className={styles.modalIntroCopy}>
                <span className={styles.modalIntroEyebrow}>
                  {itemId ? "Editing existing item" : "Creating a new item"}
                </span>
                <h3 className={styles.modalIntroTitle}>
                  {form.name || "Untitled menu item"}
                </h3>
                <p className={styles.modalIntroText}>
                  Update pricing, availability, fulfillment, and presentation in
                  one place.
                </p>
              </div>

              <div className={styles.modalIntroMeta}>
                {form.stock_status === "LOW_STOCK" && (
                  <span className={`${styles.badge} ${styles.badgeLowStock}`}>
                    Low Stock
                  </span>
                )}
                {form.stock_status === "UNAVAILABLE" && (
                  <span
                    className={`${styles.badge} ${styles.badgeUnavailable}`}
                  >
                    Unavailable
                  </span>
                )}
                {form.stock_status === "NORMAL" && (
                  <span className={styles.modalStatusPill}>Available</span>
                )}
                {form.is_hidden && (
                  <span className={`${styles.badge} ${styles.badgeHidden}`}>
                    Hidden
                  </span>
                )}
                <span className={styles.modalStatusPill}>
                  {form.allowed_fulfillment_type === "BOTH"
                    ? "Pickup + Delivery"
                    : form.allowed_fulfillment_type === "PICKUP"
                      ? "Pickup only"
                      : "Delivery only"}
                </span>
              </div>
            </div>

            {/* ── Basic Info ── */}
            <div className={styles.formSection}>
              <h3>Basic Info</h3>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Name</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    required
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Price (cents)</label>
                  <input
                    type="number"
                    min="0"
                    className={styles.formInput}
                    value={form.base_price_cents}
                    onChange={(e) =>
                      set("base_price_cents", parseInt(e.target.value, 10) || 0)
                    }
                    required
                  />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Category</label>
                <select
                  className={styles.formSelect}
                  value={form.category_id}
                  onChange={(e) => set("category_id", e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select category...
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Description</label>
                <textarea
                  className={styles.formTextarea}
                  rows={3}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </div>
            </div>

            {/* ── Image ── */}
            <div className={styles.formSection}>
              <h3>Image</h3>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                accept="image/png,image/jpeg,image/webp"
                onChange={handleImagePick}
              />

              {imagePreview && !imageRemoved ? (
                <>
                  <div className={styles.menuItemModalImageWrap}>
                    <img
                      src={imagePreview}
                      alt=""
                      className={styles.menuItemModalImage}
                    />
                  </div>
                  <div className={styles.imageActions}>
                    <button
                      type="button"
                      className={styles.btnSmall}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      className={styles.btnSmallDanger}
                      onClick={handleImageRemove}
                    >
                      Remove
                    </button>
                  </div>
                </>
              ) : (
                <div
                  className={styles.imageUploadArea}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div>Click to upload an image</div>
                </div>
              )}
            </div>

            {/* ── Visibility & Status ── */}
            <div className={styles.formSection}>
              <h3>Visibility &amp; Status</h3>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Stock Status</label>
                  <select
                    className={styles.formSelect}
                    value={form.stock_status}
                    onChange={(e) =>
                      set(
                        "stock_status",
                        e.target.value as FormState["stock_status"],
                      )
                    }
                  >
                    <option value="NORMAL">Normal (Available)</option>
                    <option value="LOW_STOCK">
                      Low Stock (Available with badge)
                    </option>
                    <option value="UNAVAILABLE">
                      Currently Unavailable (Disabled)
                    </option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Fulfillment Type</label>
                  <select
                    className={styles.formSelect}
                    value={form.allowed_fulfillment_type}
                    onChange={(e) =>
                      set(
                        "allowed_fulfillment_type",
                        e.target.value as FormState["allowed_fulfillment_type"],
                      )
                    }
                  >
                    <option value="BOTH">Pickup &amp; Delivery</option>
                    <option value="PICKUP">Pickup Only</option>
                    <option value="DELIVERY">Delivery Only</option>
                  </select>
                </div>
              </div>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={form.is_hidden}
                  onChange={(e) => set("is_hidden", e.target.checked)}
                />
                Hide entirely from customer menu
              </label>
            </div>

            {/* ── Removable Ingredients ── */}
            <div className={styles.formSection}>
              <h3>Removable Ingredients</h3>
              <div className={styles.listEditor}>
                {form.removable_ingredients.map((ri, idx) => (
                  <div key={idx} className={styles.listRow}>
                    <input
                      type="text"
                      className={styles.formInput}
                      value={ri.name}
                      placeholder="Ingredient name"
                      onChange={(e) => updateIngredient(idx, e.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.listRowRemove}
                      onClick={() => removeIngredient(idx)}
                      title="Remove"
                    >
                      &#x2715;
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={styles.addRowBtn}
                  onClick={addIngredient}
                >
                  + Add ingredient
                </button>
              </div>
            </div>

            {/* ── Modifier Groups (link/unlink) ── */}
            <div className={styles.formSection}>
              <h3>Modifier Groups</h3>
              {availableModGroups.length === 0 ? (
                <div style={{ color: "#71717a", fontSize: "0.85rem" }}>
                  No modifier groups configured for this location.
                </div>
              ) : (
                <div className={styles.modGroupList}>
                  {availableModGroups.map((mg) => (
                    <label key={mg.id} className={styles.modGroupItem}>
                      <input
                        type="checkbox"
                        checked={linkedGroupIds.has(mg.id)}
                        onChange={() => toggleModGroup(mg.id)}
                      />
                      <span>{mg.name}</span>
                      <span className={styles.modGroupMeta}>
                        {mg.options.length} option
                        {mg.options.length !== 1 ? "s" : ""}
                        {mg.isRequired ? " \u00b7 required" : ""}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* ── Schedules ── */}
            <div className={styles.formSection}>
              <h3>
                Availability Schedule{" "}
                <span style={{ fontWeight: 400, color: "#71717a", fontSize: "0.8rem" }}>
                  (empty = always available)
                </span>
              </h3>
              <div className={styles.listEditor}>
                {form.schedules.map((row, idx) => (
                  <div key={idx} className={styles.listRow}>
                    <select
                      className={`${styles.formSelect} ${styles.scheduleDay}`}
                      value={row.day_of_week}
                      onChange={(e) =>
                        updateSchedule(
                          idx,
                          "day_of_week",
                          parseInt(e.target.value, 10),
                        )
                      }
                    >
                      {DAY_LABELS.map((label, d) => (
                        <option key={d} value={d}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="time"
                      className={`${styles.formInput} ${styles.scheduleTime}`}
                      value={row.time_from}
                      onChange={(e) =>
                        updateSchedule(idx, "time_from", e.target.value)
                      }
                    />
                    <span style={{ color: "#71717a" }}>to</span>
                    <input
                      type="time"
                      className={`${styles.formInput} ${styles.scheduleTime}`}
                      value={row.time_to}
                      onChange={(e) =>
                        updateSchedule(idx, "time_to", e.target.value)
                      }
                    />
                    <button
                      type="button"
                      className={styles.listRowRemove}
                      onClick={() => removeSchedule(idx)}
                      title="Remove"
                    >
                      &#x2715;
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={styles.addRowBtn}
                  onClick={addSchedule}
                >
                  + Add time window
                </button>
              </div>
            </div>

            {/* ── Footer ── */}
            <div className={styles.modalFooter}>
              <button
                type="button"
                onClick={onClose}
                className={styles.btnCancel}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.btnSave}
                disabled={saving || !form.name || !form.category_id}
              >
                {saving ? "Saving..." : "Save Item"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
