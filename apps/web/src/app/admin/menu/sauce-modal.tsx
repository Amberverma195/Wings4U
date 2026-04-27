"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "../admin-api";
import type { WingFlavour } from "./admin-menu.types";
import styles from "./admin-menu.module.css";

const ADMIN_MENU_API_BASE = "/api/v1/admin/menu";
const SAUCE_CATEGORIES = ["MILD", "MEDIUM", "HOT", "DRY_RUB"] as const;
type SauceCategory = (typeof SAUCE_CATEGORIES)[number];

function normalizeCategory(value: WingFlavour["heatLevel"]): SauceCategory {
  return value === "PLAIN" ? "MEDIUM" : value;
}

export function SauceModal({
  sauceId,
  onClose,
  onSaved,
}: {
  sauceId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<SauceCategory>("MEDIUM");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  useEffect(() => {
    if (!sauceId) return;
    let cancel = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const all = await adminFetch<WingFlavour[]>(`${ADMIN_MENU_API_BASE}/wing-flavours`);
        const existing = all.find((flavour) => flavour.id === sauceId);
        if (!existing) throw new Error("Sauce not found");
        if (!cancel) {
          setName(existing.name);
          setCategory(normalizeCategory(existing.heatLevel));
          setSortOrder(existing.sortOrder);
          setIsActive(existing.isActive);
        }
      } catch (err) {
        if (!cancel) setError(err instanceof Error ? err.message : "Failed to load sauce");
      } finally {
        if (!cancel) setLoading(false);
      }
    }

    void load();
    return () => {
      cancel = true;
    };
  }, [sauceId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        category,
        sort_order: sortOrder,
        is_active: isActive,
      };

      if (sauceId) {
        await adminFetch(`${ADMIN_MENU_API_BASE}/wing-flavours/${sauceId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await adminFetch(`${ADMIN_MENU_API_BASE}/wing-flavours`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save sauce");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!sauceId) return;
    if (!confirm("Archive this sauce? Active carts will show it as unavailable.")) return;
    setSaving(true);
    setError(null);
    try {
      await adminFetch(`${ADMIN_MENU_API_BASE}/wing-flavours/${sauceId}`, {
        method: "DELETE",
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive sauce");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onMouseDown={onClose} role="presentation">
      <div
        className={`${styles.modalContent} ${styles.sauceModalContent}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sauce-modal-title"
      >
        <header className={styles.modalHeader}>
          <h2 id="sauce-modal-title">{sauceId ? "Edit Sauce" : "New Sauce"}</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close sauce editor"
          >
            x
          </button>
        </header>

        <div className={styles.modalBody}>
          {error ? <div className={styles.error}>{error}</div> : null}

          {loading ? (
            <div className={styles.loader}>Loading...</div>
          ) : (
            <div className={styles.sauceFormGrid}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Name</label>
                <input
                  type="text"
                  className={styles.formInput}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Honey Garlic"
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Category</label>
                <select
                  className={styles.formSelect}
                  value={category}
                  onChange={(event) => setCategory(event.target.value as SauceCategory)}
                >
                  <option value="MILD">Mild</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HOT">Hot</option>
                  <option value="DRY_RUB">Dry Rub</option>
                </select>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Sort Order</label>
                  <input
                    type="number"
                    className={styles.formInput}
                    value={sortOrder}
                    onChange={(event) => setSortOrder(Number.parseInt(event.target.value, 10) || 0)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Status</label>
                  <label className={styles.sauceStatusToggle}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={isActive}
                      onChange={(event) => setIsActive(event.target.checked)}
                    />
                    <span>Active for ordering</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className={styles.modalFooter}>
          {sauceId ? (
            <button
              type="button"
              className={styles.btnDanger}
              onClick={handleArchive}
              disabled={saving || loading}
            >
              Archive
            </button>
          ) : (
            <span />
          )}

          <div className={styles.modalFooterActions}>
            <button
              type="button"
              className={styles.btnCancel}
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnSave}
              onClick={handleSave}
              disabled={saving || loading || !name.trim()}
            >
              {saving ? "Saving..." : "Save Sauce"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
