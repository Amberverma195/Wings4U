CREATE TABLE IF NOT EXISTS "removable_ingredients" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "menu_item_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "removable_ingredients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_removable_ingredients_item"
  ON "removable_ingredients" ("menu_item_id", "sort_order");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'removable_ingredients_menu_item_id_fkey'
  ) THEN
    ALTER TABLE "removable_ingredients"
      ADD CONSTRAINT "removable_ingredients_menu_item_id_fkey"
      FOREIGN KEY ("menu_item_id")
      REFERENCES "menu_items"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION;
  END IF;
END $$;
