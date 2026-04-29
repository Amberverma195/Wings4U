-- Migration 0005: KDS Station Sessions and Password Access

-- 1. Add kds_password_hash to location_settings
ALTER TABLE location_settings
  ADD COLUMN kds_password_hash VARCHAR(255);

-- 2. Create kds_station_sessions table
CREATE TABLE kds_station_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  session_key text NOT NULL UNIQUE,
  token_hash text NOT NULL,
  client_ip inet NOT NULL,
  device_id text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kds_station_sessions_loc_active ON kds_station_sessions(location_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_kds_station_sessions_key ON kds_station_sessions(session_key);

-- 3. Make requested_by_user_id nullable in cancellation_requests and refund_requests
ALTER TABLE cancellation_requests
  ALTER COLUMN requested_by_user_id DROP NOT NULL;

ALTER TABLE refund_requests
  ALTER COLUMN requested_by_user_id DROP NOT NULL;
