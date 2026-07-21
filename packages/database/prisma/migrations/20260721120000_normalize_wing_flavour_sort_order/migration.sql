-- Repair legacy duplicate and gapped sauce positions independently per category.
WITH ranked_flavours AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY location_id, heat_level
      ORDER BY sort_order ASC, updated_at DESC, created_at ASC, id ASC
    )::integer AS normalized_sort_order
  FROM wing_flavours
  WHERE archived_at IS NULL
    AND heat_level <> 'PLAIN'
)
UPDATE wing_flavours AS flavour
SET sort_order = ranked.normalized_sort_order
FROM ranked_flavours AS ranked
WHERE flavour.id = ranked.id
  AND flavour.sort_order <> ranked.normalized_sort_order;
