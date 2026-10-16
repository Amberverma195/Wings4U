-- Idempotent guard: local DBs (or any env) that never applied 20260511120000 still get the column.
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "image_crop" JSONB;
