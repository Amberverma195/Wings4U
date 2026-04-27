-- Default delivery fee $5.00 (500 cents) for new location_settings rows.
ALTER TABLE "location_settings" ALTER COLUMN "delivery_fee_cents" SET DEFAULT 500;

-- Backfill legacy defaults (0 = schema default, 399 = old seed) to $5.00.
UPDATE "location_settings" SET "delivery_fee_cents" = 500 WHERE "delivery_fee_cents" IN (0, 399);
