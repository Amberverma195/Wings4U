"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "../admin-api";
import type { Category, FullMenuItem } from "./admin-menu.types";
import { CategoryModal } from "./category-modal";
import { MenuItemCard } from "./menu-item-card";
import { MenuItemModal } from "./menu-item-modal";
import styles from "./admin-menu.module.css";

const ADMIN_MENU_API_BASE = "/api/v1/admin/menu";

export function AdminMenuClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [items, setItems] = useState<FullMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);

  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [catModalOpen, setCatModalOpen] = useState(false);

  const loadCategories = useCallback(async () => {
    try {
      const data = await adminFetch<Category[]>(
        `${ADMIN_MENU_API_BASE}/categories`,
      );
      setCategories(data);
    } catch (err) {
      console.error("Failed to load categories", err);
    }
  }, []);

  const loadItems = useCallback(async (catId: string | null, query: string) => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (catId) params.append("categoryId", catId);
      if (query) params.append("q", query);
      const querySuffix = params.toString() ? `?${params.toString()}` : "";

      const data = await adminFetch<FullMenuItem[]>(
        `${ADMIN_MENU_API_BASE}/items${querySuffix}`,
      );
      setItems(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load menu items",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadItems(activeCategoryId, searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [activeCategoryId, searchQuery, loadItems]);

  const refresh = useCallback(() => {
    loadCategories();
    loadItems(activeCategoryId, searchQuery);
  }, [activeCategoryId, loadCategories, loadItems, searchQuery]);

  return (
    <>
      <section className="surface-card admin-section-lead">
        <div className="admin-section-lead__row">
          <div>
            <p className="surface-eyebrow">Admin Menu</p>
            <h1>Menu management</h1>
            <p className="surface-muted">
              Manage categories, item visibility, pricing, images, and stock
              states from one place.
            </p>
          </div>

          <div className="admin-section-lead__actions">
            <button
              type="button"
              className={styles.leadButtonSecondary}
              onClick={() => {
                setEditCategoryId(null);
                setCatModalOpen(true);
              }}
            >
              New Category
            </button>
            <button
              type="button"
              className={styles.leadButtonPrimary}
              onClick={() => {
                setEditItemId(null);
                setItemModalOpen(true);
              }}
            >
              Add Item
            </button>
          </div>
        </div>
      </section>

      <div className={styles.container}>
        <section className={`surface-card ${styles.categoryDock}`}>
          <div className={styles.sidebarHeader}>
            <div className={styles.categoryHeaderCopy}>
              <span className={styles.categoryHeaderEyebrow}>Categories</span>
              <p className={styles.categoryHeaderText}>
                Filter the menu by section, then edit items below.
              </p>
            </div>
            <div className={styles.categoryHeaderActions}>
              <button
                type="button"
                className={styles.sidebarHeaderBtn}
                onClick={() => {
                  setEditCategoryId(null);
                  setCatModalOpen(true);
                }}
              >
                + New
              </button>
            </div>
          </div>

          <div className={styles.categoryList}>
            <button
              type="button"
              className={styles.categoryItem}
              data-active={activeCategoryId === null}
              onClick={() => setActiveCategoryId(null)}
            >
              <span>All Items</span>
            </button>

            {categories.map((cat) => (
              <div
                key={cat.id}
                className={styles.categoryRow}
                data-active={activeCategoryId === cat.id}
              >
                <button
                  type="button"
                  className={styles.categoryItem}
                  data-active={activeCategoryId === cat.id}
                  onClick={() => setActiveCategoryId(cat.id)}
                >
                  <span style={cat.isActive ? undefined : { opacity: 0.5 }}>
                    {cat.name}
                  </span>
                  <span className={styles.catCount}>{cat._count.menuItems}</span>
                </button>

                <button
                  type="button"
                  className={styles.catEditBtn}
                  onClick={() => {
                    setEditCategoryId(cat.id);
                    setCatModalOpen(true);
                  }}
                  title={`Edit ${cat.name}`}
                  aria-label={`Edit ${cat.name}`}
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className={`surface-card ${styles.content}`}>
          <div className={styles.toolbar}>
            <div className={styles.searchWrapper}>
              <svg
                className={styles.searchIcon}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search menu items..."
                className={styles.searchInput}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className={styles.toolbarMeta}>
              {activeCategoryId ? (
                <span className="surface-muted">Filtered by category</span>
              ) : (
                <span className="surface-muted">Showing all categories</span>
              )}
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          {loading ? (
            <div className={styles.loader}>Loading items...</div>
          ) : items.length === 0 ? (
            <div className={styles.emptyGrid}>
              No items found.{" "}
              {searchQuery
                ? "Try a different search."
                : 'Click "+ Add Item" to create one.'}
            </div>
          ) : (
            <div className={styles.grid}>
              {items.map((item) => (
                <MenuItemCard
                  key={item.id}
                  item={item}
                  onEdit={() => {
                    setEditItemId(item.id);
                    setItemModalOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {itemModalOpen && (
          <MenuItemModal
            itemId={editItemId}
            categories={categories}
            onClose={() => setItemModalOpen(false)}
            onSaved={() => {
              setItemModalOpen(false);
              refresh();
            }}
          />
        )}

        {catModalOpen && (
          <CategoryModal
            categoryId={editCategoryId}
            categories={categories}
            onClose={() => setCatModalOpen(false)}
            onSaved={() => {
              setCatModalOpen(false);
              refresh();
            }}
          />
        )}
      </div>
    </>
  );
}
