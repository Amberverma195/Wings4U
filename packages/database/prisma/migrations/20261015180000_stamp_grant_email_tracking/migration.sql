CREATE TABLE "wings_stamp_grant_emails" (
  "grant_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "payload_json" JSONB,
  "first_attempt_at" TIMESTAMPTZ(6),
  "lease_until" TIMESTAMPTZ(6),
  "attempt_token" UUID,
  "sent_at" TIMESTAMPTZ(6),
  "provider_email_id" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wings_stamp_grant_emails_pkey" PRIMARY KEY ("grant_id"),
  CONSTRAINT "wings_stamp_grant_emails_grant_id_fkey" FOREIGN KEY ("grant_id")
    REFERENCES "customer_wings_stamp_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Email payloads are server-only; do not expose them through Supabase's public data API.
ALTER TABLE "wings_stamp_grant_emails" ENABLE ROW LEVEL SECURITY;
