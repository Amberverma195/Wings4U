-- FOR REVIEW ONLY. Do not execute against production without separate approval.
-- Additive schema; no customer records are updated by this migration.
ALTER TABLE "users" ADD COLUMN "account_deleted_at" TIMESTAMPTZ(6);

CREATE TABLE "account_deletion_authorizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "request_id" UUID NOT NULL,
  "credential_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_deletion_authorizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_deletion_authorizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "account_deletion_authorizations_token_hash_key" ON "account_deletion_authorizations"("token_hash");
CREATE UNIQUE INDEX "account_deletion_authorizations_request_id_key" ON "account_deletion_authorizations"("request_id");
CREATE INDEX "idx_account_deletion_authorizations_user" ON "account_deletion_authorizations"("user_id", "expires_at");

CREATE TABLE "account_deletion_requests" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "authorization_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "blockers_json" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_deletion_requests_status_check" CHECK ("status" IN ('RESOLUTION_REQUIRED', 'COMPLETED')),
  CONSTRAINT "account_deletion_requests_completed_check" CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)),
  CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "account_deletion_requests_user_id_key" ON "account_deletion_requests"("user_id");

-- Explicit chargeback/legal holds; ingestion and legacy reconciliation must be
-- separately approved before activation. No automatic population is performed.
CREATE TABLE "account_deletion_holds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL,
  "code" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMPTZ(6),
  CONSTRAINT "account_deletion_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_deletion_holds_code_check" CHECK ("code" IN ('CHARGEBACK', 'LEGAL_HOLD', 'REFUND_RECONCILIATION', 'BUSINESS_REVIEW')),
  CONSTRAINT "account_deletion_holds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE INDEX "idx_account_deletion_holds_active" ON "account_deletion_holds"("user_id", "released_at");

-- Supabase public-schema tables must not expose authorization or lifecycle
-- records through PostgREST. The reviewed backend DB role must own/bypass RLS.
ALTER TABLE "account_deletion_authorizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_deletion_holds" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "account_deletion_authorizations", "account_deletion_requests", "account_deletion_holds" FROM PUBLIC;
DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON account_deletion_authorizations, account_deletion_requests, account_deletion_holds FROM %I', role_name);
    END IF;
  END LOOP;
END;
$$;

-- Hold creation/release participates in the same account lock as deletion.
CREATE FUNCTION "lock_account_deletion_hold"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE deleted_at TIMESTAMPTZ;
BEGIN
  SELECT account_deleted_at INTO deleted_at FROM users WHERE id = NEW.user_id FOR KEY SHARE;
  IF deleted_at IS NOT NULL AND TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Account is already deleted; reconcile retained transaction evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lock_account_deletion_hold BEFORE INSERT OR UPDATE ON "account_deletion_holds"
FOR EACH ROW EXECUTE FUNCTION "lock_account_deletion_hold"();

-- A pre-deletion authenticated request may still be in flight. Owner checks
-- acquire a lock conflicting with deletion's FOR UPDATE lock. Before deletion
-- commits a write completes first (and is included in cleanup), or aborts; after
-- deletion commits it cannot repopulate personal/account data. No DB setting or
-- client-supplied bypass can disable this guard. Other inactive accounts are unchanged.
CREATE FUNCTION "guard_deleted_account_owner"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE owner_id UUID; deleted_at TIMESTAMPTZ;
BEGIN
  owner_id := (to_jsonb(NEW) ->> TG_ARGV[0])::UUID;
  IF owner_id IS NULL THEN RETURN NEW; END IF;
  SELECT account_deleted_at INTO deleted_at FROM users WHERE id = owner_id FOR KEY SHARE;
  IF deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Account is deleted' USING ERRCODE = '23514', CONSTRAINT = 'deleted_account_owner';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE entry TEXT[];
BEGIN
  FOREACH entry SLICE 1 IN ARRAY ARRAY[
    ['user_identities','user_id'], ['auth_sessions','user_id'],
    ['customer_profiles','user_id'], ['customer_addresses','user_id'],
    ['saved_carts','user_id'], ['checkout_idempotency_keys','user_id'],
    ['customer_wallets','customer_user_id'], ['customer_credit_ledger','customer_user_id'],
    ['customer_wings_rewards','customer_user_id'], ['customer_wings_stamp_ledger','customer_user_id'],
    ['promo_redemptions','customer_user_id'], ['support_tickets','customer_user_id'],
    ['support_ticket_messages','author_user_id'], ['order_messages','sender_user_id'],
    ['item_reviews','customer_user_id'], ['driver_delivery_reviews','customer_user_id'],
    ['catering_inquiries','customer_user_id'], ['chat_read_states','user_id']
  ] LOOP
    EXECUTE format('CREATE TRIGGER deleted_account_owner BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_deleted_account_owner(%L)', entry[1], entry[2]);
  END LOOP;
END;
$$;

-- Orders retain required customer FK / non-null snapshot columns. Inserts must
-- not purchase against a tombstone; updates must not restore contact snapshots.
CREATE FUNCTION "guard_deleted_account_order"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE deleted_at TIMESTAMPTZ;
BEGIN
  IF NEW.customer_user_id IS NULL THEN RETURN NEW; END IF;
  SELECT account_deleted_at INTO deleted_at FROM users WHERE id = NEW.customer_user_id FOR KEY SHARE;
  IF deleted_at IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Account is deleted' USING ERRCODE = '23514', CONSTRAINT = 'deleted_account_owner';
    END IF;
    NEW.customer_name_snapshot := 'Deleted customer';
    NEW.customer_phone_snapshot := '';
    NEW.customer_email_snapshot := NULL;
    NEW.delivery_phone_snapshot := NULL;
    NEW.address_snapshot_json := NULL;
    NEW.customer_order_notes := NULL;
    NEW.cancellation_reason := NULL;
    NEW.revalidation_diff_json := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER deleted_account_order BEFORE INSERT OR UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION "guard_deleted_account_order"();

-- Prevent accidental reactivation or identity restoration of a completed account.
CREATE FUNCTION "guard_account_tombstone"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.account_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted account cannot be restored' USING ERRCODE = '23514', CONSTRAINT = 'immutable_account_tombstone';
  END IF;
  IF NEW.account_deleted_at IS NOT NULL AND (NEW.role <> 'CUSTOMER' OR NEW.is_active OR NEW.archived_at IS NULL OR
    NEW.password_hash IS NOT NULL OR NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL OR NEW.display_name <> 'Deleted customer') THEN
    RAISE EXCEPTION 'Invalid account tombstone' USING ERRCODE = '23514', CONSTRAINT = 'valid_account_tombstone';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_account_tombstone BEFORE INSERT OR UPDATE ON "users"
FOR EACH ROW EXECUTE FUNCTION "guard_account_tombstone"();
