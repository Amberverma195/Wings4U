ALTER TABLE "users"
  ADD COLUMN "last_profile_identity_change_at" TIMESTAMPTZ(6);

ALTER TABLE "auth_otp_codes"
  ADD COLUMN "pending_email_normalized" CITEXT,
  ADD COLUMN "pending_phone_e164" TEXT;

CREATE INDEX "idx_auth_otp_purpose_active"
  ON "auth_otp_codes" ("purpose", "expires_at", "consumed_at");
