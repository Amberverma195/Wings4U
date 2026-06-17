DROP TABLE IF EXISTS "order_change_requests";

ALTER TABLE "location_settings"
  DROP COLUMN IF EXISTS "add_items_auto_approve_enabled";

DROP TYPE IF EXISTS "change_request_type";
DROP TYPE IF EXISTS "change_request_status";
