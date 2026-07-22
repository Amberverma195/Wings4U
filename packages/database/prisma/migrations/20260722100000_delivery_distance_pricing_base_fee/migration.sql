BEGIN;

ALTER TABLE "location_settings"
ALTER COLUMN "delivery_fee_cents" SET DEFAULT 500;

-- Distance pricing has one code-owned $5 base fee for every location.
UPDATE "location_settings"
SET "delivery_fee_cents" = 500;

-- Older seed versions serialized this JSON array before passing it to Prisma,
-- producing a JSON string instead of a JSON array.
DO $$
DECLARE
  candidate RECORD;
  parsed JSONB;
BEGIN
  FOR candidate IN
    SELECT "location_id", "allowed_postal_codes"
    FROM "location_settings"
    WHERE jsonb_typeof("allowed_postal_codes") = 'string'
  LOOP
    BEGIN
      parsed := (candidate."allowed_postal_codes" #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION
        'Malformed allowed_postal_codes for location % - repair the JSON before migrating',
        candidate."location_id";
    END;

    IF jsonb_typeof(parsed) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION
        'Non-array allowed_postal_codes for location % - repair the JSON before migrating',
        candidate."location_id";
    END IF;

    UPDATE "location_settings"
    SET "allowed_postal_codes" = parsed
    WHERE "location_id" = candidate."location_id";
  END LOOP;

  SELECT "location_id", jsonb_typeof("allowed_postal_codes") AS value_type
  INTO candidate
  FROM "location_settings"
  WHERE jsonb_typeof("allowed_postal_codes") IS DISTINCT FROM 'array'
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Non-array allowed_postal_codes for location % - found JSON type %',
      candidate."location_id",
      COALESCE(candidate."value_type", 'SQL NULL');
  END IF;
END $$;

COMMIT;
