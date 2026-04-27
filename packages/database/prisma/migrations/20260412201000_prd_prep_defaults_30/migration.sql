ALTER TABLE "location_settings"
ALTER COLUMN "default_prep_time_minutes" SET DEFAULT 30;

UPDATE "location_settings"
SET
  "default_prep_time_minutes" = 30,
  "default_pickup_min_minutes" = 30,
  "default_pickup_max_minutes" = 40,
  "default_delivery_min_minutes" = 40,
  "default_delivery_max_minutes" = 60
WHERE
  "default_prep_time_minutes" = 20
  OR (
    "default_pickup_min_minutes" = 15
    AND "default_pickup_max_minutes" = 20
    AND "default_delivery_min_minutes" = 30
    AND "default_delivery_max_minutes" = 30
  );
