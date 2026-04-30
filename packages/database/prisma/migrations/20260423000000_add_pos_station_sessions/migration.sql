-- Detach POS auth into a station-password surface.
-- Mirrors `kds_station_sessions` so POS gets its own cookie-bound station
-- session table, separate from KDS even though both are unlocked by the
-- same shared 8-digit password (stored in `location_settings.kds_password_hash`).
CREATE TABLE "pos_station_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "session_key" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "client_ip" INET NOT NULL,
    "device_id" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pos_station_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_station_sessions_session_key_key"
    ON "pos_station_sessions"("session_key");

CREATE INDEX "idx_pos_station_sessions_loc_active"
    ON "pos_station_sessions"("location_id");

CREATE INDEX "idx_pos_station_sessions_key"
    ON "pos_station_sessions"("session_key");

ALTER TABLE "pos_station_sessions"
    ADD CONSTRAINT "pos_station_sessions_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
