INSERT INTO "location_hours" (
  "id",
  "location_id",
  "service_type",
  "day_of_week",
  "time_from",
  "time_to",
  "is_closed",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  store_hours."location_id",
  'KDS',
  store_hours."day_of_week",
  store_hours."time_from",
  store_hours."time_to",
  store_hours."is_closed",
  now(),
  now()
FROM "location_hours" store_hours
WHERE store_hours."service_type" = 'STORE'
  AND NOT EXISTS (
    SELECT 1
    FROM "location_hours" kds_hours
    WHERE kds_hours."location_id" = store_hours."location_id"
      AND kds_hours."service_type" = 'KDS'
      AND kds_hours."day_of_week" = store_hours."day_of_week"
  );
