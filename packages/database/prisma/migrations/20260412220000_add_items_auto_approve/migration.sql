-- PRD §13: per-location flag for auto-approving post-order add-item requests.
-- Default FALSE preserves existing behaviour: every request enters the admin
-- queue. Setting it to TRUE lets OrderChangesService bypass the queue and
-- apply the requested items immediately (still subject to 3-minute window,
-- payment-method matrix, and wallet balance checks).

ALTER TABLE "location_settings"
  ADD COLUMN "add_items_auto_approve_enabled" boolean NOT NULL DEFAULT false;
