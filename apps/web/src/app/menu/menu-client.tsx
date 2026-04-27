"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { cents } from "@/lib/format";
import {
  canQuickAddMenuItem,
  isComboBuilderItem,
  isWingBuilderItem,
  shouldUseCustomizationOverlay,
} from "@/lib/menu-item-customization";
import type { MenuResponse, MenuCategory, MenuItem, FulfillmentType } from "@/lib/types";
import { ComboBuilder } from "@/components/combo-builder";
import { ItemCustomizationOverlay } from "@/components/item-customization-overlay";
import { ItemModal } from "@/components/item-modal";
import { WingsBuilder } from "@/components/wings-builder";

export function MenuClient() {
  const cart = useCart();
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  const loadMenu = useCallback(
    async (fulfillmentType: FulfillmentType) => {
      setError(null);
      const query = new URLSearchParams({
        location_id: cart.locationId,
        fulfillment_type: fulfillmentType,
      });
      try {
        const env = await apiJson<MenuResponse>(
          `/api/v1/menu?${query.toString()}`,
          { locationId: cart.locationId },
        );
        if (!env.data) {
          setError("Menu response missing data");
          setMenu(null);
          return;
        }

        const data = env.data;
        setMenu(data);
        if (data.categories.length) {
          setActiveCategoryId((previous) =>
            previous && data.categories.some((category) => category.id === previous)
              ? previous
              : data.categories[0].id,
          );
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to load menu");
      }
    },
    [cart.locationId],
  );

  useEffect(() => {
    void loadMenu(cart.fulfillmentType);
  }, [cart.fulfillmentType, loadMenu]);

  const activeCategory: MenuCategory | undefined = useMemo(
    () => menu?.categories.find((category) => category.id === activeCategoryId),
    [menu, activeCategoryId],
  );

  const handleSelectItem = useCallback((item: MenuItem) => {
    if (!item.is_available) return;

    if (canQuickAddMenuItem(item)) {
      cart.addItem({
        menu_item_id: item.id,
        menu_item_slug: item.slug,
        name: item.name,
        image_url: item.image_url,
        base_price_cents: item.base_price_cents,
        quantity: 1,
        modifier_selections: [],
        special_instructions: "",
      });
      return;
    }

    setSelectedItem(item);
  }, [cart]);

  if (error) {
    return (
      <section className="surface-card">
        <p className="surface-error">{error}</p>
        <p className="surface-muted">
          Make sure the API is running, that Next was restarted after editing <code>apps/web/.env.local</code>, and that <code>NEXT_PUBLIC_DEFAULT_LOCATION_ID</code> is set to the seeded LON01 location UUID.
        </p>
      </section>
    );
  }

  if (!menu) {
    return (
      <section className="surface-card">
        <p className="surface-muted">Loading menu...</p>
      </section>
    );
  }

  return (
    <>
      <section className="surface-card" style={{ marginBottom: "1rem" }}>
        <h1 style={{ margin: "0 0 0.25rem" }}>{menu.location.name}</h1>
        <p className="surface-muted" style={{ margin: 0 }}>
          {menu.location.is_open ? "Open" : "Closed"}
          {menu.location.busy_mode && " | Busy mode"}
          {" | "}~{menu.location.estimated_prep_minutes} min
          {cart.fulfillmentType === "DELIVERY" &&
            ` | Delivery ${cents(menu.location.delivery_fee_cents)}`}
        </p>

        <div className="fulfillment-toggle" style={{ marginTop: "1rem" }}>
          {(["PICKUP", "DELIVERY"] as const).map((fulfillmentType) => (
            <button
              key={fulfillmentType}
              data-active={cart.fulfillmentType === fulfillmentType}
              onClick={() => cart.setFulfillmentType(fulfillmentType)}
            >
              {fulfillmentType === "PICKUP" ? "Pickup" : "Delivery"}
            </button>
          ))}
        </div>
      </section>

      <section className="surface-card">
        <div className="category-tabs">
          {menu.categories.map((category) => (
            <button
              key={category.id}
              data-active={activeCategoryId === category.id}
              onClick={() => setActiveCategoryId(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>

        {activeCategory && (
          <div className="item-grid">
            {activeCategory.items.map((item) => (
              <div
                key={item.id}
                className={`item-card${item.is_available ? "" : " item-unavailable"}`}
                onClick={() => handleSelectItem(item)}
              >
                <h3>
                  {item.name}
                  {item.is_popular && <span className="item-popular">Popular</span>}
                </h3>
                {item.description && <p className="item-desc">{item.description}</p>}
                <span className="item-price">{cents(item.base_price_cents)}</span>
                {!item.is_available && <span className="surface-muted"> | Unavailable</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {selectedItem && isWingBuilderItem(selectedItem) && (
        <WingsBuilder item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}

      {selectedItem && isComboBuilderItem(selectedItem) && (
        <ComboBuilder item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}

      {selectedItem && !isWingBuilderItem(selectedItem) && !isComboBuilderItem(selectedItem) && shouldUseCustomizationOverlay(selectedItem) && (
        <ItemCustomizationOverlay item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}

      {selectedItem && !isWingBuilderItem(selectedItem) && !isComboBuilderItem(selectedItem) && !shouldUseCustomizationOverlay(selectedItem) && (
        <ItemModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </>
  );
}
