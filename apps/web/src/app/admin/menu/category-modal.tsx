"use client";

import { useState } from "react";
import { adminFetch } from "../admin-api";
import type { Category } from "./admin-menu.types";
import styles from "./admin-menu.module.css";

const ADMIN_MENU_API_BASE = "/api/v1/admin/menu";

type Props = {
  categoryId: string | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
};

type FormState = {
  name: string;
  sort_order: number;
  is_active: boolean;
};

export function CategoryModal({
  categoryId,
  categories,
  onClose,
  onSaved,
}: Props) {
  const existing = categoryId
    ? categories.find((c) => c.id === categoryId)
    : null;

  const [form, setForm] = useState<FormState>({
    name: existing?.name ?? "",
    sort_order: existing?.sortOrder ?? categories.length,
    is_active: existing?.isActive ?? true,
  });

  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!categoryId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (isEdit) {
        await adminFetch(`${ADMIN_MENU_API_BASE}/categories/${categoryId}`, {
          method: "PUT",
          body: JSON.stringify(form),
        });
      } else {
        await adminFetch(`${ADMIN_MENU_API_BASE}/categories`, {
          method: "POST",
          body: JSON.stringify(form),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category");
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!categoryId) return;
    if (
      !window.confirm(
        `Archive "${existing?.name}"? This will hide it from the admin list. It cannot be archived if it still has active items.`,
      )
    ) {
      return;
    }

    setArchiving(true);
    setError(null);

    try {
      await adminFetch(`${ADMIN_MENU_API_BASE}/categories/${categoryId}`, {
        method: "DELETE",
      });
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to archive category",
      );
      setArchiving(false);
    }
  };

  return (
    <div
      className={styles.modalOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modalContent} style={{ maxWidth: 480 }}>
        <div className={styles.modalHeader}>
          <h2>{isEdit ? "Edit Category" : "New Category"}</h2>
          <button onClick={onClose} className={styles.closeButton}>
            &#x2715;
          </button>
        </div>

        <form className={styles.modalBody} onSubmit={handleSubmit}>
          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.formGroup}>
            <label>Name</label>
            <input
              type="text"
              className={styles.formInput}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
            />
          </div>

          <div className={styles.formGroup}>
            <label>Sort Order</label>
            <input
              type="number"
              min="0"
              className={styles.formInput}
              value={form.sort_order}
              onChange={(e) =>
                setForm({
                  ...form,
                  sort_order: parseInt(e.target.value, 10) || 0,
                })
              }
            />
          </div>

          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) =>
                setForm({ ...form, is_active: e.target.checked })
              }
            />
            Active (visible on customer menu)
          </label>

          <div className={styles.modalFooter}>
            {isEdit && (
              <button
                type="button"
                className={styles.btnDanger}
                onClick={handleArchive}
                disabled={archiving}
                style={{ marginRight: "auto" }}
              >
                {archiving ? "Archiving..." : "Archive"}
              </button>
            )}
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
              disabled={saving || !form.name}
            >
              {saving ? "Saving..." : isEdit ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
