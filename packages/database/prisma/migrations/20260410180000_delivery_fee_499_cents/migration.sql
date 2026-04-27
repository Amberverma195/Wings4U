-- Delivery fee: $4.99 (499¢), matching order-method modal and seed.
ALTER TABLE "location_settings" ALTER COLUMN "delivery_fee_cents" SET DEFAULT 499;

UPDATE "location_settings"
SET "delivery_fee_cents" = 499
WHERE "delivery_fee_cents" = 500;
