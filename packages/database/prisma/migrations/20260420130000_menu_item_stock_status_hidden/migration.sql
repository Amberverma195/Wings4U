-- Add stock_status and is_hidden columns to menu_items for admin menu management.
-- stock_status tracks NORMAL / LOW_STOCK / UNAVAILABLE; is_hidden hides items from the customer menu entirely.

ALTER TABLE "menu_items"
ADD COLUMN IF NOT EXISTS "stock_status" TEXT NOT NULL DEFAULT 'NORMAL';

ALTER TABLE "menu_items"
ADD COLUMN IF NOT EXISTS "is_hidden" BOOLEAN NOT NULL DEFAULT false;
