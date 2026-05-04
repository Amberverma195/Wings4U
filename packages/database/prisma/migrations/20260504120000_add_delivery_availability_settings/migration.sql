ALTER TABLE "location_settings"
  ADD COLUMN "delivery_disabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "delivery_available_from_minutes" INTEGER,
  ADD COLUMN "delivery_available_until_minutes" INTEGER;

ALTER TABLE "location_settings"
  ADD CONSTRAINT "location_settings_delivery_available_from_minutes_check"
    CHECK (
      "delivery_available_from_minutes" IS NULL OR
      ("delivery_available_from_minutes" >= 0 AND "delivery_available_from_minutes" <= 1439)
    ),
  ADD CONSTRAINT "location_settings_delivery_available_until_minutes_check"
    CHECK (
      "delivery_available_until_minutes" IS NULL OR
      ("delivery_available_until_minutes" >= 0 AND "delivery_available_until_minutes" <= 1439)
    );
