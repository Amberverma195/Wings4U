CREATE INDEX "idx_menu_categories_public"
  ON "menu_categories" ("location_id", "is_active", "archived_at", "sort_order");

CREATE INDEX "idx_menu_items_public_category"
  ON "menu_items" ("category_id", "is_hidden", "archived_at", "allowed_fulfillment_type");
