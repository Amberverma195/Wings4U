-- OWNER REVIEW ONLY. NOT EXECUTED. No permission to connect is implied.
-- Source schema baseline: e169d6c, October 23, 2026.
-- All statements are SELECT-only, including catalog reads and aggregate CTEs.
-- No customer IDs, cart IDs, tokens, addresses, text, emails or phone values
-- are output. Location UUIDs identify business locations, not customers.
-- Use only after separate owner approval, with an owner-configured read-only
-- role/transaction and resource limits. Do not disable RLS or elevate access.
-- Restricted visibility can produce incomplete counts or false orphan reports.
-- Even SELECTs consume resources and take normal relation-read locks.
-- No execution plan/performance or deployed schema has been validated here.

-- 1. Preflight column types. STOP if these differ from the inspected schema.
-- Expected timestamps are timestamp with time zone; item cart_id is uuid.
SELECT table_schema, table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('saved_carts', 'saved_cart_items')
ORDER BY table_name, ordinal_position;

-- 2. All incoming/outgoing FKs involving cart roots/items. Owner must inspect
-- custom references, deletion actions and restrictions before any future purge.
-- Expected incoming cascade: saved_cart_items.cart_id -> saved_carts.id only.
SELECT ns.nspname AS relation_schema,
       rel.relname AS relation_name,
       con.conname AS constraint_name,
       pg_catalog.pg_get_constraintdef(con.oid) AS definition
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = rel.relnamespace
WHERE con.contype = 'f'
  AND (con.conrelid IN (pg_catalog.to_regclass('public.saved_carts'),
                       pg_catalog.to_regclass('public.saved_cart_items'))
       OR con.confrelid IN (pg_catalog.to_regclass('public.saved_carts'),
                           pg_catalog.to_regclass('public.saved_cart_items')))
ORDER BY relation_schema, relation_name, constraint_name;

-- 3. Trigger inventory (metadata only; no function bodies or arguments).
-- This does not prove that no external scheduler/function references carts.
SELECT ns.nspname AS relation_schema, rel.relname AS relation_name,
       trg.tgname AS trigger_name, trg.tgenabled AS enabled_mode,
       proc.proname AS function_name
FROM pg_catalog.pg_trigger AS trg
JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = rel.relnamespace
JOIN pg_catalog.pg_proc AS proc ON proc.oid = trg.tgfoid
WHERE NOT trg.tgisinternal
  AND trg.tgrelid IN (pg_catalog.to_regclass('public.saved_carts'),
                     pg_catalog.to_regclass('public.saved_cart_items'))
ORDER BY relation_schema, relation_name, trigger_name;

-- 4. Main aggregate inventory. Review/replace the SINGLE illustrative as-of
-- literal below with the owner's fixed approved UTC instant before execution.
-- This is an example cutoff, not the actual time of an executed audit.
-- No now()/CURRENT_TIMESTAMP: all age counts in this statement use one instant.
-- Fixed hours match application milliseconds and avoid calendar-day/DST drift.
-- Null-expiry legacy fallback uses updated_at (never created_at or read time).
-- Invalid ownership, missing/nonfinite timestamps, future updates and expiry
-- before the last update are quarantined. These conservative review buckets
-- are not changes to product logic. Runtime/driver date validation is still
-- required before any future deletion; SQL finiteness alone is not sufficient.
-- Counts are preliminary AGE candidates, NOT an approved deletion manifest:
-- legal holds, operational obligations, reference checks and client compatibility
-- are additional gates described in data-retention-cleanup-plan.md.
WITH parameters AS (
  SELECT TIMESTAMPTZ '2026-10-23T12:00:00Z' AS audit_as_of,
         INTERVAL '720 hours' AS proposed_grace
), ownership AS (
  SELECT c.*, p.audit_as_of, p.proposed_grace,
         CASE
           WHEN c.user_id IS NOT NULL AND c.guest_token IS NULL THEN 'customer'
           WHEN c.user_id IS NULL AND c.guest_token IS NOT NULL
                AND length(btrim(c.guest_token)) > 0 THEN 'guest'
           ELSE 'invalid'
         END AS owner_kind
  FROM public.saved_carts AS c
  CROSS JOIN parameters AS p
), validity AS (
  SELECT o.*,
         CASE
           WHEN owner_kind = 'invalid' THEN 'ambiguous_or_missing_owner'
           WHEN created_at IS NULL OR updated_at IS NULL THEN 'missing_timestamp'
           WHEN NOT isfinite(created_at) OR NOT isfinite(updated_at)
             THEN 'nonfinite_creation_or_update'
           WHEN updated_at > audit_as_of OR created_at > updated_at
             THEN 'future_or_contradictory_update'
           WHEN expires_at IS NOT NULL AND NOT isfinite(expires_at)
             THEN 'nonfinite_expiration'
           WHEN expires_at IS NOT NULL AND expires_at < updated_at
             THEN 'expiration_before_last_update'
           ELSE NULL
         END AS quarantine_reason
  FROM ownership AS o
), deadlines AS (
  SELECT v.*,
         CASE
           WHEN quarantine_reason IS NOT NULL THEN NULL
           WHEN expires_at IS NOT NULL THEN expires_at
           WHEN owner_kind = 'guest' THEN updated_at + INTERVAL '168 hours'
           WHEN owner_kind = 'customer' THEN updated_at + INTERVAL '720 hours'
           ELSE NULL
         END AS effective_expiration
  FROM validity AS v
), items_per_cart AS (
  SELECT cart_id, count(*) AS item_count
  FROM public.saved_cart_items
  GROUP BY cart_id
)
SELECT d.audit_as_of, d.location_id, d.status::text AS cart_status, d.owner_kind,
       count(*) AS cart_count,
       coalesce(sum(i.item_count), 0) AS associated_item_count,
       count(*) FILTER (WHERE d.expires_at IS NULL) AS null_expiration_count,
       count(*) FILTER (WHERE d.quarantine_reason IS NOT NULL) AS quarantined_count,
       count(*) FILTER (
         WHERE d.status::text = 'ACTIVE' AND isfinite(d.expires_at)
           AND d.expires_at <= d.audit_as_of
       ) AS raw_explicitly_expired_active_count,
       count(*) FILTER (
         WHERE d.status::text = 'ACTIVE'
           AND d.effective_expiration <= d.audit_as_of
       ) AS expired_active_with_valid_metadata,
       count(*) FILTER (
         WHERE d.status::text = 'ACTIVE'
           AND d.effective_expiration <= d.audit_as_of - d.proposed_grace
       ) AS proposed_active_age_candidate_count,
       count(*) FILTER (
         WHERE d.status::text = 'ACTIVE' AND d.expires_at IS NULL
           AND d.effective_expiration <= d.audit_as_of - d.proposed_grace
       ) AS legacy_null_expiry_age_candidates,
       coalesce(sum(i.item_count) FILTER (
         WHERE d.status::text = 'ACTIVE'
           AND d.effective_expiration <= d.audit_as_of - d.proposed_grace
       ), 0) AS associated_age_candidate_items,
       min(d.updated_at) FILTER (WHERE isfinite(d.updated_at)) AS earliest_update,
       max(d.updated_at) FILTER (WHERE isfinite(d.updated_at)) AS latest_update
FROM deadlines AS d
LEFT JOIN items_per_cart AS i ON i.cart_id = d.id
GROUP BY d.audit_as_of, d.location_id, d.status, d.owner_kind
ORDER BY d.location_id, d.status::text, d.owner_kind;

-- The inventory above includes all CONVERTED and ABANDONED counts separately,
-- and all guest/customer/invalid ownership buckets, by location. Candidate
-- columns are ZERO for every non-ACTIVE status, irrespective of its old expiry.
-- A missing group means no visible rows, not proof that RLS hides nothing.

-- 5. Explicit legacy/anomaly breakdown across ALL statuses. No guessed expiry
-- for ambiguous ownership. This query reports, but does not backfill or fix.
SELECT location_id, status::text AS cart_status,
       count(*) AS visible_cart_count,
       count(*) FILTER (WHERE expires_at IS NULL) AS null_expiration_count,
       count(*) FILTER (WHERE updated_at IS NULL OR created_at IS NULL)
         AS missing_creation_or_update,
       count(*) FILTER (WHERE NOT isfinite(updated_at) OR NOT isfinite(created_at)
                         OR NOT isfinite(expires_at)) AS nonfinite_timestamp_count,
       count(*) FILTER (WHERE user_id IS NULL AND guest_token IS NULL) AS no_owner_count,
       count(*) FILTER (WHERE user_id IS NOT NULL AND guest_token IS NOT NULL)
         AS mixed_owner_count,
       count(*) FILTER (WHERE guest_token IS NOT NULL AND length(btrim(guest_token)) = 0)
         AS empty_guest_token_count
FROM public.saved_carts
GROUP BY location_id, status
ORDER BY location_id, status::text;

-- 6. Dependent item totals independently reconciled by root status, including
-- CONVERTED and ABANDONED, plus orphan items if visible. No customer contents.
SELECT CASE WHEN c.id IS NULL THEN 'ORPHAN_OR_ROOT_NOT_VISIBLE'
            ELSE c.status::text END AS root_status,
       count(*) AS item_count,
       count(DISTINCT i.cart_id) AS associated_cart_id_count
FROM public.saved_cart_items AS i
LEFT JOIN public.saved_carts AS c ON c.id = i.cart_id
GROUP BY CASE WHEN c.id IS NULL THEN 'ORPHAN_OR_ROOT_NOT_VISIBLE'
              ELSE c.status::text END
ORDER BY root_status;

-- End of unexecuted owner-review queries. No table mutation, DDL, function
-- creation, locking SELECT, external call, transaction setup or EXPLAIN ANALYZE
-- is provided. Do not append a deletion command to this file.
