ALTER TABLE "menu_items"
ADD COLUMN "is_wing_combo_side" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "modifier_options"
ADD COLUMN "linked_menu_item_id" UUID;

ALTER TABLE "modifier_options"
ADD CONSTRAINT "modifier_options_linked_menu_item_id_fkey"
FOREIGN KEY ("linked_menu_item_id") REFERENCES "menu_items"("id")
ON DELETE SET NULL ON UPDATE NO ACTION;

WITH legacy_side_items AS (
  SELECT DISTINCT ON (
    modifier_group."location_id",
    lower(trim(option."name"))
  ) item."id" AS item_id
  FROM "modifier_options" AS option
  INNER JOIN "modifier_groups" AS modifier_group
    ON modifier_group."id" = option."modifier_group_id"
  INNER JOIN "menu_items" AS item
    ON item."location_id" = modifier_group."location_id"
    AND item."archived_at" IS NULL
    AND lower(trim(item."name")) = lower(trim(option."name"))
  WHERE modifier_group."archived_at" IS NULL
    AND option."is_active" = true
    AND (
      modifier_group."context_key" = 'side'
      OR EXISTS (
        SELECT 1
        FROM "menu_item_modifier_groups" AS mapped_group
        WHERE mapped_group."modifier_group_id" = modifier_group."id"
          AND mapped_group."context_key" = 'side'
      )
    )
  ORDER BY
    modifier_group."location_id",
    lower(trim(option."name")),
    item."created_at" ASC,
    item."id" ASC
)
UPDATE "menu_items" AS item
SET "is_wing_combo_side" = true
FROM legacy_side_items
WHERE item."id" = legacy_side_items.item_id;

WITH option_matches AS (
  SELECT
    option."id" AS option_id,
    item."id" AS item_id,
    row_number() OVER (
      PARTITION BY option."modifier_group_id", item."id"
      ORDER BY option."sort_order" ASC, option."created_at" ASC, option."id" ASC
    ) AS match_number
  FROM "modifier_options" AS option
  INNER JOIN "modifier_groups" AS modifier_group
    ON modifier_group."id" = option."modifier_group_id"
  INNER JOIN "menu_items" AS item
    ON item."location_id" = modifier_group."location_id"
    AND item."is_wing_combo_side" = true
    AND item."archived_at" IS NULL
    AND lower(trim(item."name")) = lower(trim(option."name"))
  WHERE modifier_group."archived_at" IS NULL
    AND (
      modifier_group."context_key" = 'side'
      OR EXISTS (
        SELECT 1
        FROM "menu_item_modifier_groups" AS mapped_group
        WHERE mapped_group."modifier_group_id" = modifier_group."id"
          AND mapped_group."context_key" = 'side'
      )
    )
)
UPDATE "modifier_options" AS option
SET "linked_menu_item_id" = option_matches.item_id
FROM option_matches
WHERE option."id" = option_matches.option_id
  AND option_matches.match_number = 1;

CREATE UNIQUE INDEX "uq_modifier_options_group_linked_item"
ON "modifier_options"("modifier_group_id", "linked_menu_item_id");
