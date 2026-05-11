-- Revert menu image crop: column no longer used by the app.
ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "image_crop";
