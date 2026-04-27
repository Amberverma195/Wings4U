-- Minimum delivery order subtotal: raise $15 → $20.
-- Scoped to rows still on the previous policy so locations that have
-- intentionally diverged are left alone.
UPDATE "location_settings"
SET "minimum_delivery_subtotal_cents" = 2000
WHERE "minimum_delivery_subtotal_cents" = 1500;
