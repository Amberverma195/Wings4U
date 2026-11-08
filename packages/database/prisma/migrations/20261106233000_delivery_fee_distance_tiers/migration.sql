BEGIN;

-- The delivery fee is code-owned. Keep database defaults and seeded locations
-- aligned with the new $8 minimum tier, including fixed-pricing rollout mode.
ALTER TABLE "location_settings"
ALTER COLUMN "delivery_fee_cents" SET DEFAULT 800;

UPDATE "location_settings"
SET "delivery_fee_cents" = 800;

COMMIT;
