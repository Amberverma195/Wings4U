-- Split standalone side items out of the legacy "Poutines & Sides" category.
-- Keep the old poutines slug for compatibility with existing frontend builder logic.

UPDATE "menu_categories"
SET
  "name" = 'Poutines',
  "updated_at" = NOW()
WHERE "slug" = 'poutines-and-sides'
  AND "archived_at" IS NULL
  AND "name" <> 'Poutines';

WITH poutines AS (
  SELECT "id", "location_id", "sort_order"
  FROM "menu_categories"
  WHERE "slug" = 'poutines-and-sides'
    AND "archived_at" IS NULL
),
locations_to_split AS (
  SELECT p."id", p."location_id", p."sort_order"
  FROM poutines p
  WHERE NOT EXISTS (
    SELECT 1
    FROM "menu_categories" s
    WHERE s."location_id" = p."location_id"
      AND s."slug" = 'sides'
      AND s."archived_at" IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM "menu_items" item
    WHERE item."location_id" = p."location_id"
      AND item."category_id" = p."id"
      AND item."archived_at" IS NULL
      AND item."slug" IN (
        'fries',
        'onion-rings',
        'wedges',
        'coleslaw',
        'gravy',
        'chicken-nuggets'
      )
  )
)
UPDATE "menu_categories" c
SET
  "sort_order" = c."sort_order" + 1,
  "updated_at" = NOW()
FROM locations_to_split n
WHERE c."location_id" = n."location_id"
  AND c."archived_at" IS NULL
  AND c."slug" <> 'sides'
  AND c."sort_order" > n."sort_order";

WITH poutines AS (
  SELECT "location_id", "sort_order"
  FROM "menu_categories"
  WHERE "slug" = 'poutines-and-sides'
    AND "archived_at" IS NULL
)
UPDATE "menu_categories" s
SET
  "name" = 'Sides',
  "sort_order" = p."sort_order" + 1,
  "is_active" = TRUE,
  "archived_at" = NULL,
  "updated_at" = NOW()
FROM poutines p
WHERE s."location_id" = p."location_id"
  AND s."slug" = 'sides'
  AND s."archived_at" IS NOT NULL;

WITH poutines AS (
  SELECT "location_id", "sort_order"
  FROM "menu_categories"
  WHERE "slug" = 'poutines-and-sides'
    AND "archived_at" IS NULL
)
INSERT INTO "menu_categories" (
  "id",
  "location_id",
  "name",
  "slug",
  "sort_order",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  p."location_id",
  'Sides',
  'sides',
  p."sort_order" + 1,
  TRUE,
  NOW(),
  NOW()
FROM poutines p
WHERE NOT EXISTS (
  SELECT 1
  FROM "menu_categories" s
  WHERE s."location_id" = p."location_id"
    AND s."slug" = 'sides'
);

WITH poutines AS (
  SELECT "location_id", "sort_order"
  FROM "menu_categories"
  WHERE "slug" = 'poutines-and-sides'
    AND "archived_at" IS NULL
)
UPDATE "menu_categories" s
SET
  "name" = 'Sides',
  "sort_order" = p."sort_order" + 1,
  "updated_at" = NOW()
FROM poutines p
WHERE s."location_id" = p."location_id"
  AND s."slug" = 'sides'
  AND s."archived_at" IS NULL;

WITH side_categories AS (
  SELECT "id", "location_id"
  FROM "menu_categories"
  WHERE "slug" = 'sides'
    AND "archived_at" IS NULL
)
UPDATE "menu_items" item
SET
  "category_id" = sides."id",
  "updated_at" = NOW()
FROM side_categories sides
WHERE item."location_id" = sides."location_id"
  AND item."archived_at" IS NULL
  AND item."slug" IN (
    'fries',
    'onion-rings',
    'wedges',
    'coleslaw',
    'gravy',
    'chicken-nuggets'
  );
