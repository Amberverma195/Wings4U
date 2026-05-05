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
  l."id",
  'STORE',
  v."day_of_week",
  v."time_from"::time,
  v."time_to"::time,
  false,
  now(),
  now()
FROM "locations" l
CROSS JOIN (
  VALUES
    (1, '11:00', '01:00'),
    (2, '11:00', '01:00'),
    (3, '11:00', '01:00'),
    (4, '11:00', '01:00'),
    (5, '11:00', '02:30'),
    (6, '11:00', '02:30'),
    (0, '11:00', '01:00')
) AS v("day_of_week", "time_from", "time_to")
WHERE NOT EXISTS (
  SELECT 1
  FROM "location_hours" h
  WHERE h."location_id" = l."id"
    AND h."service_type" = 'STORE'
    AND h."day_of_week" = v."day_of_week"
);
