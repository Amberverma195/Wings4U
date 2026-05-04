ALTER TABLE "menu_categories"
  ADD COLUMN "available_from_minutes" INTEGER,
  ADD COLUMN "available_until_minutes" INTEGER;

ALTER TABLE "menu_categories"
  ADD CONSTRAINT "menu_categories_available_from_minutes_check"
    CHECK (
      "available_from_minutes" IS NULL OR
      ("available_from_minutes" >= 0 AND "available_from_minutes" <= 1439)
    ),
  ADD CONSTRAINT "menu_categories_available_until_minutes_check"
    CHECK (
      "available_until_minutes" IS NULL OR
      ("available_until_minutes" >= 0 AND "available_until_minutes" <= 1439)
    );
