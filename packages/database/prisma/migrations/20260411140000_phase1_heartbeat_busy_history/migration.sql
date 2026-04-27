-- Phase 1 (PRD §7/§11 foundation):
--   • KDS heartbeat storage (per-location session last-seen)
--   • Busy-mode history events (append-only)
--   • Align overdue_delivery_grace_minutes default with PRD §7.8.8 (10 min)

-- ── 1. Align overdue grace default to PRD (10 min). New rows only. ────────────
ALTER TABLE "location_settings" ALTER COLUMN "overdue_delivery_grace_minutes" SET DEFAULT 10;

-- ── 2. KDS heartbeats ────────────────────────────────────────────────────────
CREATE TABLE "kds_heartbeats" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "location_id"  UUID         NOT NULL,
    "session_key"  TEXT         NOT NULL,
    "device_id"    UUID,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kds_heartbeats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_kds_heartbeats_loc_session" ON "kds_heartbeats" ("location_id", "session_key");
CREATE INDEX "idx_kds_heartbeats_loc_last_seen" ON "kds_heartbeats" ("location_id", "last_seen_at");

ALTER TABLE "kds_heartbeats"
    ADD CONSTRAINT "kds_heartbeats_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ── 3. Busy-mode events (append-only history) ───────────────────────────────
CREATE TABLE "busy_mode_events" (
    "id"                     UUID         NOT NULL DEFAULT gen_random_uuid(),
    "location_id"            UUID         NOT NULL,
    "started_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at"               TIMESTAMPTZ(6),
    "started_by_user_id"     UUID,
    "ended_by_user_id"       UUID,
    "prep_minutes_snapshot"  INTEGER,
    "note"                   TEXT,
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "busy_mode_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_busy_mode_events_loc_started" ON "busy_mode_events" ("location_id", "started_at");

ALTER TABLE "busy_mode_events"
    ADD CONSTRAINT "busy_mode_events_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "busy_mode_events"
    ADD CONSTRAINT "busy_mode_events_started_by_user_id_fkey"
    FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "busy_mode_events"
    ADD CONSTRAINT "busy_mode_events_ended_by_user_id_fkey"
    FOREIGN KEY ("ended_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
