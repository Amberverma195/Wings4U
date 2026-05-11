"use client";

import type { ChangeEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminApiFetch, adminFetch } from "../admin-api";
import type { Category, FullMenuItem, WingFlavour } from "./admin-menu.types";
import { CategoryModal } from "./category-modal";
import { MenuItemCard } from "./menu-item-card";
import { MenuItemModal } from "./menu-item-modal";
import { SauceModal } from "./sauce-modal";
import styles from "./admin-menu.module.css";

const ADMIN_MENU_API_BASE = "/api/v1/admin/menu";
const SAUCE_HEAT_LEVELS = ["MILD", "MEDIUM", "HOT", "DRY_RUB"] as const;
const SAUCE_LABELS: Record<(typeof SAUCE_HEAT_LEVELS)[number], string> = {
  MILD: "Mild",
  MEDIUM: "Medium",
  HOT: "Hot",
  DRY_RUB: "Dry Rub",
};

export function AdminMenuClient() {
  const [activeTab, setActiveTab] = useState<"ITEMS" | "SAUCES">("ITEMS");
  const [categories, setCategories] = useState<Category[]>([]);
  const [sauces, setSauces] = useState<WingFlavour[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [items, setItems] = useState<FullMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [builderImageCategory, setBuilderImageCategory] = useState<Category | null>(null);

  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);

  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [catModalOpen, setCatModalOpen] = useState(false);

  const [editSauceId, setEditSauceId] = useState<string | null>(null);
  const [sauceModalOpen, setSauceModalOpen] = useState(false);

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

  const loadSauces = useCallback(async () => {
    try {
      const data = await adminFetch<WingFlavour[]>(`${ADMIN_MENU_API_BASE}/wing-flavours`);
      setSauces(data);
    } catch (err) {
      console.error("Failed to load sauces", err);
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
    loadSauces();
  }, [loadCategories, loadSauces]);

  useEffect(() => {
    if (activeTab !== "ITEMS") return;
    const timer = setTimeout(() => {
      loadItems(activeCategoryId, searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [activeCategoryId, searchQuery, loadItems, activeTab]);

  const refresh = useCallback(() => {
    loadCategories();
    loadSauces();
    if (activeTab === "ITEMS") {
      loadItems(activeCategoryId, searchQuery);
    }
  }, [activeCategoryId, loadCategories, loadItems, loadSauces, searchQuery, activeTab]);

  const getBuilderImageLabel = (category: Category) => {
    if (category.slug === "wing-combos") return "Wing Combos";
    if (category.slug === "wings") return "Wings by the Pound";
    return null;
  };

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
                if (activeTab === "SAUCES") {
                  setEditSauceId(null);
                  setSauceModalOpen(true);
                } else {
                  setEditCategoryId(null);
                  setCatModalOpen(true);
                }
              }}
            >
              {activeTab === "SAUCES" ? "New Sauce" : "New Category"}
            </button>
            {activeTab === "ITEMS" && (
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
            )}
          </div>
        </div>
      </section>

      <div className={styles.container}>
        <section className={`surface-card ${styles.categoryDock}`}>
          <div className={styles.menuTabs} role="tablist" aria-label="Menu editor sections">
            <button
              type="button"
              className={styles.menuTab}
              data-active={activeTab === "ITEMS"}
              role="tab"
              aria-selected={activeTab === "ITEMS"}
              onClick={() => setActiveTab("ITEMS")}
            >
              Menu Items
            </button>
            <button
              type="button"
              className={styles.menuTab}
              data-active={activeTab === "SAUCES"}
              role="tab"
              aria-selected={activeTab === "SAUCES"}
              onClick={() => setActiveTab("SAUCES")}
            >
              Sauces
            </button>
          </div>
          {activeTab === "ITEMS" && (
            <>
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

            {categories.map((cat) => {
              const builderImageLabel = getBuilderImageLabel(cat);
              return (
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
                {builderImageLabel && (
                  <button
                    type="button"
                    className={styles.catEditBtn}
                    onClick={() => setBuilderImageCategory(cat)}
                    title={`Add picture to every ${builderImageLabel} item`}
                    aria-label={`Add picture to every ${builderImageLabel} item`}
                  >
                    Add picture
                  </button>
                )}
              </div>
              );
            })}
          </div>
          </>
          )}
        </section>

        {activeTab === "ITEMS" ? (
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
        ) : (
          <section className={`surface-card ${styles.content}`}>
            <div className={styles.sauceHeader}>
              <div>
                <span className={styles.categoryHeaderEyebrow}>Sauces</span>
                <h2 className={styles.sauceTitle}>Wing sauce library</h2>
              </div>
            </div>

            <div className={styles.sauceGrid}>
              {SAUCE_HEAT_LEVELS.map((heat) => {
                const groupSauces = sauces.filter((sauce) => sauce.heatLevel === heat);
                return (
                  <section key={heat} className={styles.sauceGroup}>
                    <div className={styles.sauceGroupHeader}>
                      <span>{SAUCE_LABELS[heat]}</span>
                      <span>{groupSauces.length}</span>
                    </div>
                    {groupSauces.length === 0 ? (
                      <div className={styles.sauceEmpty}>No sauces</div>
                    ) : (
                      <div className={styles.sauceList}>
                        {groupSauces.map((sauce) => (
                          <div
                            key={sauce.id}
                            className={styles.sauceRow}
                            data-inactive={!sauce.isActive}
                          >
                            <div className={styles.sauceNameBlock}>
                              <span className={styles.sauceName}>{sauce.name}</span>
                              {!sauce.isActive ? (
                                <span className={styles.sauceStatus}>Unavailable</span>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              className={styles.catEditBtn}
                              onClick={() => {
                                setEditSauceId(sauce.id);
                                setSauceModalOpen(true);
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </section>
        )}

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

        {builderImageCategory && (
          <BuilderCategoryImageModal
            category={builderImageCategory}
            label={getBuilderImageLabel(builderImageCategory) ?? builderImageCategory.name}
            onClose={() => setBuilderImageCategory(null)}
            onSaved={() => {
              setBuilderImageCategory(null);
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

        {sauceModalOpen && (
          <SauceModal
            sauceId={editSauceId}
            onClose={() => setSauceModalOpen(false)}
            onSaved={() => {
              setSauceModalOpen(false);
              refresh();
            }}
          />
        )}
      </div>
    </>
  );
}

type BuilderImageResponse = {
  image_url: string | null;
  updated_count: number;
};

function BuilderCategoryImageModal({
  category,
  label,
  onClose,
  onSaved,
}: {
  category: Category;
  label: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<BuilderImageResponse>(
      `${ADMIN_MENU_API_BASE}/categories/${category.id}/builder-image`,
    )
      .then((data) => {
        if (!cancelled) {
          setImageUrl(data.image_url);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load picture");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category.id]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFilePick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemovePending(false);
    event.target.value = "";
  };

  const removePicture = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setImageFile(null);
    setRemovePending(true);
  };

  const readErrorMessage = async (res: Response) => {
    const raw = await res.text();
    let message = `Request failed (${res.status})`;
    try {
      const body = JSON.parse(raw) as {
        errors?: Array<{ message?: string }>;
        message?: string;
      };
      message = body.errors?.[0]?.message ?? body.message ?? message;
    } catch {
      // Keep the status-based fallback.
    }
    return message;
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (imageFile) {
        const formData = new FormData();
        formData.append("image", imageFile);
        const res = await adminApiFetch(
          `${ADMIN_MENU_API_BASE}/categories/${category.id}/builder-image`,
          { method: "POST", body: formData },
        );
        if (!res.ok) throw new Error(await readErrorMessage(res));
      } else if (removePending) {
        const res = await adminApiFetch(
          `${ADMIN_MENU_API_BASE}/categories/${category.id}/builder-image`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(await readErrorMessage(res));
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save picture");
      setSaving(false);
    }
  };

  const shownImage = removePending ? null : previewUrl ?? imageUrl;
  const hasChange = Boolean(imageFile) || removePending;

  return (
    <div
      className={styles.modalOverlay}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className={`${styles.modalContent} ${styles.builderPictureModal}`}>
        <div className={styles.modalHeader}>
          <h2>{label} picture</h2>
          <button
            type="button"
            onClick={onClose}
            className={styles.closeButton}
            disabled={saving}
          >
            &#x2715;
          </button>
        </div>

        <div className={styles.modalBody}>
          {error && <div className={styles.error}>{error}</div>}
          {loading ? (
            <div className={styles.loader}>Loading picture...</div>
          ) : (
            <div className={styles.builderPicturePanel}>
              {shownImage ? (
                <>
                  <div className={styles.builderPicturePreview}>
                    <img
                      src={shownImage}
                      alt=""
                      className={styles.builderPictureImage}
                    />
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleFilePick}
                    style={{ display: "none" }}
                  />
                  <div className={styles.builderPictureActions}>
                    <button
                      type="button"
                      className={styles.btnDanger}
                      onClick={removePicture}
                      disabled={saving || (!shownImage && !imageUrl)}
                    >
                      Remove picture
                    </button>
                    <button
                      type="button"
                      className={styles.btnCancel}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={saving}
                    >
                      Replace picture
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.builderPicturePreview}>
                    <span>No picture selected</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleFilePick}
                    style={{ display: "none" }}
                  />
                  <div className={styles.builderPictureActions}>
                    <button
                      type="button"
                      className={styles.btnCancel}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={saving}
                    >
                      Upload picture
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <span className="surface-muted">
            Applies to every {label} item.
          </span>
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
              onClick={save}
              disabled={saving || loading || !hasChange}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
