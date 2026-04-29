-- ============================================================================
-- Wings4U Schema v1.4 — Production
-- Aligned to PRD v3.5, Topic Map v2, Flaws & Fixes v4, Blueprint v4.0,
-- Schema Spec v1.0, and menu source.
--
-- CHANGES FROM v1.0 (introduced in v1.1):
--   • Added all missing columns on orders table (ETA, cancel window,
--     student discount, manual review flag, driver completion tracking)
--   • Added missing columns on location_settings (kds_auto_accept,
--     delivery PIN expiry, manager credit limit)
--   • Fixed admin_audit_logs.actor_user_id to be NULLABLE (PRD canonical
--     system-event rule)
--   • Expanded support_tickets.ticket_type to match PRD §25 granular types
--   • Added device auth columns (api_token_hash, device_registered_at,
--     token_last_used_at) per PRD §24
--   • Added customer_wallets.lifetime_credit_cents per PRD §10.15
--   • Added chat_messages.visibility per PRD §10.14 (BOTH | STAFF_ONLY)
--   • Added promo_codes missing columns (min_subtotal_cents,
--     max_discount_cents, usage_count, valid_time_from, valid_time_to,
--     is_one_time_per_customer, created_by_user_id)
--   • NEW TABLE: order_change_requests (PRD §10.12, §13)
--   • NEW TABLE: order_eta_events (PRD §10.7, §11.3)
--   • NEW TABLE: order_finalization_events (PRD §10.8)
--   • NEW TABLE: promo_code_product_targets (PRD §10.16)
--   • NEW TABLE: promo_code_category_targets (PRD §10.16)
--   • NEW TABLE: promo_valid_days (PRD §10.16)
--   • NEW TABLE: promo_bxgy_rules (PRD §10.34)
--   • NEW TABLE: order_discounts (PRD §10.16)
--   • NEW TABLE: driver_delivery_review_tags (PRD §10.11)
--   • NEW TABLE: driver_payouts (PRD §10.33)
--
-- CHANGES FROM v1.3 (introduced in v1.4):
--   • payment_method enum aligned to PRD-friendly naming:
--     CASH | CARD | STORE_CREDIT | SPLIT | WAIVED
--   • Two-layer payment model: orders now carries payment_method (nullable,
--     summary only) and payment_status_summary (order_payment_status_summary
--     enum: UNPAID | PENDING | PARTIALLY_PAID | PAID | PARTIALLY_REFUNDED |
--     REFUNDED | FAILED | VOIDED). order_payments remains source of truth;
--     orders fields are derived convenience for reporting/UI.
--   • order_payments refactored to proper transaction model:
--     - payment_method now uses payment_tender_method (CASH|CARD|STORE_CREDIT|WAIVED,
--       never SPLIT — SPLIT is order-level summary only)
--     - Added transaction_type (payment_transaction_type: AUTH|CAPTURE|VOID|REFUND|ADJUSTMENT)
--     - Added transaction_status (payment_transaction_status: PENDING|SUCCESS|FAILED|CANCELLED)
--     - amount_cents → signed_amount_cents (positive for charges, negative for refunds)
--     - Added provider, provider_transaction_id, currency, initiated_by_user_id, failure_reason
--     - Removed gateway_transaction_id, captured_at, old payment_status
--   • Chat model aligned to PRD naming with order_conversations + order_messages
--     while retaining cursor-based read states
--   • NEW TABLE: chat_side_read_states — canonical side-based unread behavior
--     (CUSTOMER vs STAFF). chat_read_states demoted to per-user audit/helper.
--   • devices.device_type aligned to PRD-first names:
--     KDS_SCREEN | POS_TERMINAL | RECEIPT_PRINTER | CASH_DRAWER | TIMECLOCK_TERMINAL
--   • NEW TABLE: driver_payout_order_links (PRD §10.33)
--   • NEW TABLE: support_ticket_resolutions (PRD §10.21, §25.2B)
--   • NEW TABLE: support_ticket_events (PRD §10.21)
--
-- CHANGES FROM v1.1 (v1.2):
--   • FIX: driver_payouts.driver_user_id now FK → driver_profiles(user_id)
--     instead of users(id). Prevents payout rows for non-driver users.
--   • FIX: driver_payout_order_links.driver_user_id same fix.
--   • DOCS: Documented 4 intentional cross-doc design divergences at
--     bottom of file so future engineers know these are deliberate, not
--     accidental drift.
--
-- CHANGES FROM v1.2 (this version — v1.3):
--   • SPLIT: reviews table replaced with item_reviews + driver_delivery_reviews
--     per PRD §10.11 ("do NOT merge with item_reviews"). This resolves the
--     last structural PRD contradiction.
--   • item_reviews has admin reply inline (PRD §10.13) — no separate
--     review_replies table needed. UNIQUE on (order_item_id, customer_user_id).
--   • driver_delivery_reviews is UNIQUE on order_id (one rating per delivery).
--   • driver_delivery_review_tags now FK → driver_delivery_reviews(id),
--     structurally guaranteeing tags only exist on driver reviews.
--   • review_replies table REMOVED (admin reply is inline on item_reviews).
--   • DIVERGENCE 4 (merged reviews) REMOVED from divergence docs — resolved.
--
-- CHANGES (2026-03-22 — support ticket lean expansion, folded into this baseline):
--   • support_tickets.created_source: add CUSTOMER_APP, STAFF_PANEL, ADMIN_PANEL
--   • support_tickets.priority: NOT NULL DEFAULT 'NORMAL' CHECK (LOW|NORMAL|HIGH|URGENT)
--   • support_ticket_events.event_type: add CREATED, MESSAGE_ADDED, STATUS_CHANGED,
--     PRIORITY_CHANGED, RESOLVED, ASSIGNED (keeps legacy aliases STATUS_CHANGE, etc.)
--   • support_ticket_events.payload_json: jsonb NOT NULL DEFAULT '{}'::jsonb
--   If you already have a database created from an older baseline without these
--   columns/constraints, run db/sql/0002_manual_sql_patches.sql.
--
-- CHANGES (2026-03-22 — timeclock schema expansion, folded into this baseline):
--   • employee_shifts.status: CLOCKED_IN|ON_BREAK|CLOCKED_OUT (replaces OPEN|CLOSED)
--   • employee_shifts.total_break_minutes: int NOT NULL DEFAULT 0
--   • employee_shifts.net_worked_minutes: int (nullable for active shifts)
--   • employee_breaks.break_type: constrained to UNPAID only
--   • Partial unique: one active shift per employee, one open break per shift
--   For existing databases, run db/sql/0003_timeclock_schema_expansion.sql.
-- ============================================================================

-- CHANGES (2026-03-24 - catalog modifier-group context-key alignment):
--   - modifier_groups.context_key added to the executable SQL baseline to match
--     the Prisma schema and application query shape used by /api/v1/menu
--   - Existing already-created databases missing this nullable column should run
--     db/sql/0004_modifier_groups_context_key_patch.sql instead of re-running this file
--
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE user_role AS ENUM ('CUSTOMER','STAFF','ADMIN');
CREATE TYPE employee_role AS ENUM ('MANAGER','CASHIER','KITCHEN','DRIVER');
CREATE TYPE identity_provider AS ENUM ('PHONE_OTP','EMAIL','GOOGLE');
CREATE TYPE fulfillment_type AS ENUM ('PICKUP','DELIVERY');
CREATE TYPE order_source AS ENUM ('ONLINE','POS','PHONE','ADMIN');
CREATE TYPE order_status AS ENUM ('PLACED','ACCEPTED','PREPARING','READY','OUT_FOR_DELIVERY','PICKED_UP','DELIVERED','NO_SHOW_PICKUP','NO_SHOW_DELIVERY','CANCELLED');
CREATE TYPE contactless_pref AS ENUM ('HAND_TO_ME','LEAVE_AT_DOOR','CALL_ON_ARRIVAL','TEXT_ON_ARRIVAL');
CREATE TYPE driver_availability_status AS ENUM ('AVAILABLE','ON_DELIVERY','OFF_SHIFT','UNAVAILABLE','INACTIVE');
CREATE TYPE promo_discount_type AS ENUM ('PERCENT','FIXED_AMOUNT','BXGY','FREE_DELIVERY');
CREATE TYPE promo_scope_type AS ENUM ('GLOBAL','LOCATION_SCOPED');
CREATE TYPE payment_method AS ENUM ('CASH','CARD','STORE_CREDIT','SPLIT','WAIVED');
-- payment_status enum REMOVED in v1.4. Replaced by:
--   order_payment_status_summary (on orders — summary field)
--   payment_transaction_status (on order_payments — transaction-level)
CREATE TYPE order_payment_status_summary AS ENUM ('UNPAID','PENDING','PARTIALLY_PAID','PAID','PARTIALLY_REFUNDED','REFUNDED','FAILED','VOIDED');
CREATE TYPE payment_transaction_type AS ENUM ('AUTH','CAPTURE','VOID','REFUND','ADJUSTMENT');
CREATE TYPE payment_transaction_status AS ENUM ('PENDING','SUCCESS','FAILED','CANCELLED');
CREATE TYPE payment_tender_method AS ENUM ('CASH','CARD','STORE_CREDIT','WAIVED');
CREATE TYPE refund_status AS ENUM ('PENDING','APPROVED','REJECTED','ISSUED','VOIDED');
CREATE TYPE refund_method AS ENUM ('STORE_CREDIT','ORIGINAL_PAYMENT','CASH');
CREATE TYPE inventory_adjustment_type AS ENUM ('MANUAL_SET','MANUAL_ADD','MANUAL_SUBTRACT','WASTE','RESTOCK','CORRECTION');
CREATE TYPE ticket_status AS ENUM ('OPEN','IN_REVIEW','WAITING_ON_CUSTOMER','RESOLVED','CLOSED');
CREATE TYPE ticket_resolution_type AS ENUM ('NO_ACTION','STORE_CREDIT','PARTIAL_REFUND','FULL_REFUND','REPLACEMENT','FOLLOW_UP');
CREATE TYPE pin_verification_result AS ENUM ('PENDING','VERIFIED','BYPASSED','EXPIRED','LOCKED');

-- v1.1 new enums
CREATE TYPE change_request_type AS ENUM ('ADD_ITEMS');
CREATE TYPE change_request_status AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TYPE review_tag_sentiment AS ENUM ('POSITIVE','NEGATIVE');
CREATE TYPE payout_status AS ENUM ('UNPAID','PAID','CANCELLED');

-- ============================================================================
-- IDENTITY & ACCESS
-- ============================================================================

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  address_line_1 text NOT NULL,
  address_line_2 text,
  city text NOT NULL,
  province_code text NOT NULL,
  postal_code text NOT NULL,
  phone_number text NOT NULL,
  timezone_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role user_role NOT NULL,
  display_name text NOT NULL,
  first_name text,
  last_name text,
  password_hash text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE user_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider identity_provider NOT NULL,
  provider_subject text,
  email_normalized citext,
  phone_e164 text,
  is_primary boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_user_identity_channel
    CHECK (((email_normalized IS NOT NULL)::int + (phone_e164 IS NOT NULL)::int) >= 1 OR provider = 'GOOGLE'),
  CONSTRAINT uq_provider_subject UNIQUE (provider, provider_subject),
  CONSTRAINT uq_email UNIQUE (email_normalized),
  CONSTRAINT uq_phone UNIQUE (phone_e164)
);

CREATE TABLE auth_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_identity_id uuid NOT NULL REFERENCES user_identities(id) ON DELETE CASCADE,
  otp_hash text NOT NULL,
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempt_count int NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  total_successful_orders int NOT NULL DEFAULT 0 CHECK (total_successful_orders >= 0),
  total_no_shows int NOT NULL DEFAULT 0 CHECK (total_no_shows >= 0),
  prepayment_required boolean NOT NULL DEFAULT false,
  preferred_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE employee_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  role employee_role NOT NULL,
  employee_pin_hash text,
  hourly_rate_cents int CHECK (hourly_rate_cents IS NULL OR hourly_rate_cents >= 0),
  hire_date date,
  is_active_employee boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE admin_location_assignments (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);

CREATE TABLE driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES employee_profiles(user_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  phone_number_mirror text NOT NULL,
  email_mirror citext,
  vehicle_type text,
  vehicle_identifier text,
  availability_status driver_availability_status NOT NULL DEFAULT 'OFF_SHIFT',
  is_active boolean NOT NULL DEFAULT true,
  is_on_delivery boolean NOT NULL DEFAULT false,
  last_assigned_at timestamptz,
  last_delivery_completed_at timestamptz,
  total_deliveries_completed int NOT NULL DEFAULT 0 CHECK (total_deliveries_completed >= 0),
  average_rating_numeric numeric(3,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT chk_driver_delivery_state CHECK (NOT (availability_status = 'ON_DELIVERY' AND is_on_delivery = false))
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,
  device_info text,
  ip_address inet,
  location_id uuid REFERENCES locations(id),
  is_pos_session boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES users(id),
  CONSTRAINT chk_auth_session_expiry CHECK (expires_at > created_at)
);

-- ============================================================================
-- LOCATIONS & OPERATIONS CONFIGURATION
-- ============================================================================

CREATE TABLE location_settings (
  location_id uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  tax_rate_bps int NOT NULL CHECK (tax_rate_bps >= 0),
  tax_delivery_fee boolean NOT NULL DEFAULT true,
  tax_tip boolean NOT NULL DEFAULT false,
  discounts_reduce_taxable_base boolean NOT NULL DEFAULT true,
  delivery_fee_cents int NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  free_delivery_threshold_cents int CHECK (free_delivery_threshold_cents IS NULL OR free_delivery_threshold_cents >= 0),
  minimum_delivery_subtotal_cents int NOT NULL DEFAULT 0 CHECK (minimum_delivery_subtotal_cents >= 0),
  default_prep_time_minutes int NOT NULL DEFAULT 20 CHECK (default_prep_time_minutes >= 0),
  busy_mode_enabled boolean NOT NULL DEFAULT false,
  busy_mode_prep_time_minutes int CHECK (busy_mode_prep_time_minutes IS NULL OR busy_mode_prep_time_minutes >= 0),
  first_order_discount_enabled boolean NOT NULL DEFAULT true,
  default_promo_stackable boolean NOT NULL DEFAULT false,
  prepayment_threshold_no_shows int NOT NULL DEFAULT 3 CHECK (prepayment_threshold_no_shows >= 0),
  allowed_postal_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  trusted_ip_ranges jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_gateway_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- v1.1: missing columns from PRD §11.1B, §7.8.5, §19.1
  kds_auto_accept_seconds int NOT NULL DEFAULT 10 CHECK (kds_auto_accept_seconds >= 0),
  delivery_pin_expiry_minutes int NOT NULL DEFAULT 240 CHECK (delivery_pin_expiry_minutes > 0),
  manager_credit_limit_cents int CHECK (manager_credit_limit_cents IS NULL OR manager_credit_limit_cents >= 0),
  -- v1.1: ETA window defaults from PRD §11.1
  default_pickup_min_minutes int NOT NULL DEFAULT 30 CHECK (default_pickup_min_minutes >= 0),
  default_pickup_max_minutes int NOT NULL DEFAULT 40 CHECK (default_pickup_max_minutes >= 0),
  default_delivery_min_minutes int NOT NULL DEFAULT 40 CHECK (default_delivery_min_minutes >= 0),
  default_delivery_max_minutes int NOT NULL DEFAULT 60 CHECK (default_delivery_max_minutes >= 0),
  -- v1.1: overdue grace period from PRD §7.8.8
  overdue_delivery_grace_minutes int NOT NULL DEFAULT 20 CHECK (overdue_delivery_grace_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE location_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  service_type text NOT NULL CHECK (service_type IN ('STORE','PICKUP','DELIVERY')),
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  time_from time NOT NULL,
  time_to time NOT NULL,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(location_id, service_type, day_of_week, time_from, time_to)
);

-- ============================================================================
-- CATALOG & NORMALIZATION
-- ============================================================================

CREATE TABLE menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  name text NOT NULL,
  slug text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(location_id, slug)
);

CREATE TABLE wing_flavours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  name text NOT NULL,
  slug text NOT NULL,
  heat_level text NOT NULL CHECK (heat_level IN ('MILD','MEDIUM','HOT','DRY_RUB','PLAIN')),
  is_plain boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(location_id, slug)
);

CREATE TABLE menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  category_id uuid NOT NULL REFERENCES menu_categories(id),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  base_price_cents int NOT NULL CHECK (base_price_cents >= 0),
  image_url text,
  is_available boolean NOT NULL DEFAULT true,
  is_popular boolean NOT NULL DEFAULT false,
  allowed_fulfillment_type text NOT NULL DEFAULT 'BOTH' CHECK (allowed_fulfillment_type IN ('BOTH','PICKUP_ONLY','DELIVERY_ONLY')),
  builder_type text CHECK (builder_type IS NULL OR builder_type IN ('STANDARD','WINGS','WING_COMBO')),
  requires_special_instructions boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(location_id, slug)
);

CREATE TABLE modifier_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  name text NOT NULL,
  display_label text NOT NULL,
  selection_mode text NOT NULL CHECK (selection_mode IN ('SINGLE','MULTI','TOGGLE')),
  min_select int NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select int CHECK (max_select IS NULL OR max_select >= min_select),
  is_required boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  context_key text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE modifier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_delta_cents int NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  linked_flavour_id uuid REFERENCES wing_flavours(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menu_item_modifier_groups (
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  modifier_group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  context_key text,
  PRIMARY KEY (menu_item_id, modifier_group_id)
);

CREATE TABLE menu_item_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  time_from time NOT NULL,
  time_to time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- ORDERS, SNAPSHOTS, PRICING & LIFECYCLE
-- ============================================================================

CREATE TABLE checkout_idempotency_keys (
  idempotency_key text PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  request_fingerprint text NOT NULL,
  order_id uuid, -- FK → orders(id) added via ALTER TABLE below (deferred; see fk_checkout_idempotency_order)
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  customer_user_id uuid NOT NULL REFERENCES users(id),
  order_number bigint NOT NULL,
  order_source order_source NOT NULL,
  fulfillment_type fulfillment_type NOT NULL,
  status order_status NOT NULL,
  contactless_pref contactless_pref,
  scheduled_for timestamptz NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid REFERENCES users(id),
  cancellation_source text CHECK (cancellation_source IS NULL OR cancellation_source IN ('CUSTOMER_SELF','KDS_CANCEL_REQUEST','KDS_CHAT_REQUEST','ADMIN','SYSTEM')),
  cancellation_reason text,
  assigned_driver_user_id uuid REFERENCES driver_profiles(user_id),
  estimated_travel_minutes int CHECK (estimated_travel_minutes IS NULL OR estimated_travel_minutes >= 0),
  estimated_arrival_at timestamptz,
  delivery_started_at timestamptz,
  delivery_completed_at timestamptz,
  delivery_phone_snapshot text,
  customer_name_snapshot text NOT NULL,
  customer_phone_snapshot text NOT NULL,
  customer_email_snapshot citext,
  address_snapshot_json jsonb,
  pricing_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  revalidation_diff_json jsonb,
  item_subtotal_cents int NOT NULL CHECK (item_subtotal_cents >= 0),
  item_discount_total_cents int NOT NULL DEFAULT 0 CHECK (item_discount_total_cents >= 0),
  order_discount_total_cents int NOT NULL DEFAULT 0 CHECK (order_discount_total_cents >= 0),
  discounted_subtotal_cents int NOT NULL CHECK (discounted_subtotal_cents >= 0),
  taxable_subtotal_cents int NOT NULL CHECK (taxable_subtotal_cents >= 0),
  tax_cents int NOT NULL CHECK (tax_cents >= 0),
  tax_rate_bps int NOT NULL CHECK (tax_rate_bps >= 0), -- snapshot from location_settings at checkout (e.g. 1300 = 13%)
  tax_delivery_fee_applied boolean NOT NULL DEFAULT false, -- snapshot: was delivery fee included in taxable base?
  tax_tip_applied boolean NOT NULL DEFAULT false, -- snapshot: was tip included in taxable base?
  tax_snapshot_label text NOT NULL DEFAULT 'ONTARIO_HST_13', -- human-readable label for receipts and reporting
  delivery_fee_cents int NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  driver_tip_cents int NOT NULL DEFAULT 0 CHECK (driver_tip_cents >= 0),
  wallet_applied_cents int NOT NULL DEFAULT 0 CHECK (wallet_applied_cents >= 0),
  net_paid_amount_cents int NOT NULL DEFAULT 0 CHECK (net_paid_amount_cents >= 0),
  final_payable_cents int NOT NULL CHECK (final_payable_cents >= 0),
  remaining_refundable_cents int NOT NULL DEFAULT 0 CHECK (remaining_refundable_cents >= 0),
  payment_method payment_method, -- SUMMARY FIELD ONLY. Source of truth = order_payments rows. SPLIT means multiple rows.
  payment_status_summary order_payment_status_summary NOT NULL DEFAULT 'UNPAID', -- SUMMARY FIELD ONLY. Derived from order_payments rows.
  customer_order_notes text,

  -- v1.1: ETA fields from PRD §10.5
  estimated_ready_at timestamptz,
  estimated_window_min_minutes int CHECK (estimated_window_min_minutes IS NULL OR estimated_window_min_minutes >= 0),
  estimated_window_max_minutes int CHECK (estimated_window_max_minutes IS NULL OR estimated_window_max_minutes >= 0),
  busy_mode_extra_minutes_applied int NOT NULL DEFAULT 0 CHECK (busy_mode_extra_minutes_applied >= 0),

  -- v1.1: cancel window from PRD §12.1
  cancel_allowed_until timestamptz,

  -- v1.1: KDS offline detection from PRD §11.1B
  requires_manual_review boolean NOT NULL DEFAULT false,

  -- v1.1: student discount from menu + PRD §10.5
  student_discount_requested boolean NOT NULL DEFAULT false,
  student_discount_verified_by uuid REFERENCES users(id),
  student_discount_amount_cents int NOT NULL DEFAULT 0 CHECK (student_discount_amount_cents >= 0),

  -- v1.1: delivery completion tracking from PRD §10.5
  delivery_completed_by_user_id uuid REFERENCES users(id),
  driver_reassigned_at timestamptz,

  -- v1.4: chat-cancel linkage. FK → order_messages(id) added via ALTER TABLE
  -- below (deferred because order_messages is created after orders).
  -- See: fk_orders_cancellation_chat_message
  cancellation_chat_message_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(location_id, order_number),
  CONSTRAINT chk_delivery_fee_pickup CHECK ((fulfillment_type = 'DELIVERY') OR (delivery_fee_cents = 0 AND driver_tip_cents >= 0))
);

-- Deferred FK: checkout_idempotency_keys.order_id → orders(id)
ALTER TABLE checkout_idempotency_keys
  ADD CONSTRAINT fk_checkout_idempotency_order
  FOREIGN KEY (order_id) REFERENCES orders(id);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES menu_items(id),
  line_no int NOT NULL,
  product_name_snapshot text NOT NULL,
  category_name_snapshot text NOT NULL,
  builder_type text CHECK (builder_type IS NULL OR builder_type IN ('STANDARD','WINGS','WING_COMBO')),
  quantity int NOT NULL CHECK (quantity > 0),
  unit_price_cents int NOT NULL CHECK (unit_price_cents >= 0),
  line_discount_cents int NOT NULL DEFAULT 0 CHECK (line_discount_cents >= 0),
  line_total_cents int NOT NULL CHECK (line_total_cents >= 0),
  special_instructions text,
  builder_payload_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, line_no)
);

CREATE TABLE order_item_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_group_id uuid REFERENCES modifier_groups(id),
  modifier_option_id uuid REFERENCES modifier_options(id),
  modifier_group_name_snapshot text NOT NULL,
  modifier_name_snapshot text NOT NULL,
  modifier_kind text NOT NULL CHECK (modifier_kind IN ('ADDED','REMOVED','DEFAULT')),
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price_delta_cents int NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE order_item_wing_configs (
  order_item_id uuid PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
  wing_type text NOT NULL CHECK (wing_type IN ('BONE_IN','BONELESS')),
  preparation text NOT NULL CHECK (preparation IN ('BREADED','NON_BREADED')),
  weight_lb numeric(3,1) NOT NULL CHECK (weight_lb IN (1.0,1.5,2.0,3.0,4.0,5.0)),
  required_flavour_count smallint NOT NULL CHECK (required_flavour_count BETWEEN 1 AND 3),
  saucing_method text CHECK (saucing_method IS NULL OR saucing_method IN ('HALF_AND_HALF','MIXED','SIDE','TWO_MIXED_ONE_SIDE','SPLIT_EVENLY','ALL_MIXED')),
  side_flavour_slot smallint,
  extra_flavour_added boolean NOT NULL DEFAULT false,
  CONSTRAINT chk_boneless_non_breaded CHECK (NOT (wing_type = 'BONELESS' AND preparation <> 'NON_BREADED'))
);

CREATE TABLE order_item_flavours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  slot_no smallint NOT NULL CHECK (slot_no >= 1),
  flavour_role text NOT NULL CHECK (flavour_role IN ('STANDARD','EXTRA')),
  wing_flavour_id uuid REFERENCES wing_flavours(id),
  flavour_name_snapshot text NOT NULL,
  heat_level_snapshot text NOT NULL,
  placement text NOT NULL CHECK (placement IN ('ON_WINGS','ON_SIDE','MIXED')),
  sort_order int NOT NULL DEFAULT 0
);

-- ============================================================================
-- ORDER EVENTS & LIFECYCLE
-- ============================================================================

CREATE TABLE order_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  from_status order_status,
  to_status order_status NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  reason_text text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- v1.1: NEW TABLE — PRD §10.7, §11.3
CREATE TABLE order_eta_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_estimated_ready_at timestamptz,
  new_estimated_ready_at timestamptz,
  changed_by_user_id uuid REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- v1.1: NEW TABLE — PRD §10.8
CREATE TABLE order_finalization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  final_status order_status NOT NULL,
  confirmed boolean NOT NULL,
  confirmed_by_user_id uuid REFERENCES users(id),
  confirmation_prompt_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_final_status CHECK (final_status IN ('PICKED_UP','NO_SHOW_PICKUP','DELIVERED','NO_SHOW_DELIVERY','CANCELLED'))
);

CREATE TABLE cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  request_source text NOT NULL CHECK (request_source IN ('KDS_CANCEL_REQUEST','KDS_CHAT_REQUEST')),
  reason_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reviewed_by_admin_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- v1.1: NEW TABLE — PRD §10.12, §13 (add-items-after-ordering)
CREATE TABLE order_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  type change_request_type NOT NULL,
  status change_request_status NOT NULL DEFAULT 'PENDING',
  requested_items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES users(id),
  rejection_reason text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- DRIVER DISPATCH & DELIVERY
-- ============================================================================

CREATE TABLE order_driver_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  driver_user_id uuid NOT NULL REFERENCES driver_profiles(user_id),
  event_type text NOT NULL CHECK (event_type IN ('ASSIGNED','BUSY_OVERRIDE_APPROVED','STARTED','COMPLETED','REASSIGNED','NO_SHOW','UNASSIGNED')),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  estimated_travel_minutes int CHECK (estimated_travel_minutes IS NULL OR estimated_travel_minutes >= 0),
  note_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_pin_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  locked_at timestamptz,
  verified_at timestamptz,
  verified_by_user_id uuid REFERENCES users(id),
  verification_result pin_verification_result NOT NULL DEFAULT 'PENDING',
  bypass_reason text,
  bypass_by_user_id uuid REFERENCES users(id),
  CONSTRAINT chk_delivery_pin_expiry CHECK (expires_at > generated_at)
);

-- ============================================================================
-- PROMOTIONS, DISCOUNTS & PROMO TARGETING
-- ============================================================================

CREATE TABLE promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  discount_type promo_discount_type NOT NULL,
  scope_type promo_scope_type NOT NULL DEFAULT 'GLOBAL',
  location_id uuid REFERENCES locations(id),
  discount_value numeric(12,2) NOT NULL CHECK (discount_value >= 0),
  eligible_fulfillment_type text NOT NULL DEFAULT 'BOTH' CHECK (eligible_fulfillment_type IN ('BOTH','PICKUP_ONLY','DELIVERY_ONLY')),
  is_stackable boolean NOT NULL DEFAULT false,
  is_first_order_only boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit_total int,
  usage_limit_per_customer int,
  is_active boolean NOT NULL DEFAULT true,
  rule_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz,
  -- v1.1: missing columns from PRD §10.16
  min_subtotal_cents int NOT NULL DEFAULT 0 CHECK (min_subtotal_cents >= 0),
  max_discount_cents int CHECK (max_discount_cents IS NULL OR max_discount_cents >= 0),
  usage_count int NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  valid_time_from time,
  valid_time_to time,
  is_one_time_per_customer boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- v1.1: NEW TABLE — PRD §10.16 (replaces eligible_product_ids UUID[])
CREATE TABLE promo_code_product_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  UNIQUE(promo_code_id, menu_item_id)
);

-- v1.1: NEW TABLE — PRD §10.16 (replaces eligible_category_ids UUID[])
CREATE TABLE promo_code_category_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  menu_category_id uuid NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  UNIQUE(promo_code_id, menu_category_id)
);

-- v1.1: NEW TABLE — PRD §10.16 (replaces valid_days text[])
CREATE TABLE promo_valid_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  UNIQUE(promo_code_id, day_of_week)
);

-- v1.1: NEW TABLE — PRD §10.34 (BXGY promo rules)
CREATE TABLE promo_bxgy_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL UNIQUE REFERENCES promo_codes(id) ON DELETE CASCADE,
  qualifying_category_id uuid REFERENCES menu_categories(id),
  qualifying_product_id uuid REFERENCES menu_items(id),
  required_qty int NOT NULL CHECK (required_qty > 0),
  reward_category_id uuid REFERENCES menu_categories(id),
  reward_product_id uuid REFERENCES menu_items(id),
  reward_qty int NOT NULL CHECK (reward_qty > 0),
  reward_rule text NOT NULL CHECK (reward_rule IN ('CHEAPEST','SPECIFIC')),
  max_uses_per_order int NOT NULL DEFAULT 1 CHECK (max_uses_per_order >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE promo_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  customer_user_id uuid NOT NULL REFERENCES users(id),
  discount_amount_cents int NOT NULL CHECK (discount_amount_cents >= 0),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(promo_code_id, order_id)
);

-- v1.1: NEW TABLE — PRD §10.16 (per-order discount records)
CREATE TABLE order_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  promo_code_id uuid REFERENCES promo_codes(id),
  discount_type text NOT NULL,
  discount_amount_cents int NOT NULL CHECK (discount_amount_cents >= 0),
  description text,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- PAYMENTS, REFUNDS & WALLET
-- ============================================================================

CREATE TABLE order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  payment_method payment_tender_method NOT NULL,
  transaction_type payment_transaction_type NOT NULL DEFAULT 'CAPTURE',
  transaction_status payment_transaction_status NOT NULL DEFAULT 'PENDING',
  signed_amount_cents int NOT NULL CONSTRAINT chk_order_payments_signed_amount CHECK (signed_amount_cents <> 0),
  currency char(3) NOT NULL DEFAULT 'CAD',
  provider text,
  provider_transaction_id text,
  processor_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  initiated_by_user_id uuid REFERENCES users(id),
  failure_reason text,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  order_id uuid REFERENCES orders(id),
  customer_user_id uuid REFERENCES users(id),
  -- v1.1: expanded to match PRD §25 granular issue types
  ticket_type text NOT NULL CHECK (ticket_type IN (
    'WRONG_ITEM','MISSING_ITEM','COLD_FOOD','DELIVERY_ISSUE','DRIVER_ISSUE',
    'QUALITY_ISSUE','PAYMENT_ISSUE','OTHER'
  )),
  status ticket_status NOT NULL,
  resolution_type ticket_resolution_type, -- NULLABLE SUMMARY FIELD. NULL = no resolution yet. Uses same canonical enum as support_ticket_resolutions.
  subject text NOT NULL,
  description text NOT NULL,
  created_source text NOT NULL CHECK (created_source IN ('CUSTOMER','CUSTOMER_APP','STAFF','STAFF_PANEL','ADMIN_PANEL','AUTO_OVERDUE')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  assigned_admin_user_id uuid REFERENCES users(id),
  resolved_by_user_id uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  support_ticket_id uuid REFERENCES support_tickets(id),
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  refund_method refund_method NOT NULL DEFAULT 'STORE_CREDIT',
  status refund_status NOT NULL DEFAULT 'PENDING',
  reason_text text NOT NULL,
  approved_by_user_id uuid REFERENCES users(id),
  approved_at timestamptz,
  issued_by_user_id uuid REFERENCES users(id),
  issued_at timestamptz,
  rejected_by_user_id uuid REFERENCES users(id),
  rejected_at timestamptz,
  processor_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_wallets (
  customer_user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_cents int NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  -- v1.1: missing from PRD §10.15
  lifetime_credit_cents int NOT NULL DEFAULT 0 CHECK (lifetime_credit_cents >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id),
  refund_request_id uuid REFERENCES refund_requests(id),
  entry_type text NOT NULL CHECK (entry_type IN ('ISSUE','USE','REVERSE','EXPIRE','ADJUST')),
  amount_cents int NOT NULL,
  balance_after_cents int NOT NULL CHECK (balance_after_cents >= 0),
  reason_text text NOT NULL,
  created_by_user_id uuid REFERENCES users(id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- CHAT, SUPPORT, REVIEWS
-- ============================================================================

CREATE TABLE order_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE order_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES order_conversations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id),
  sender_surface text NOT NULL CHECK (sender_surface IN ('CUSTOMER','KDS','MANAGER','ADMIN')),
  message_body text NOT NULL,
  is_system_message boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'BOTH' CHECK (visibility IN ('BOTH','STAFF_ONLY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_order_message_conversation_order
    CHECK (order_id IS NOT NULL)
);

-- Deferred FK: orders.cancellation_chat_message_id → order_messages(id)
-- (column declared as bare uuid in orders CREATE TABLE because order_messages
-- does not exist at that point; this ALTER adds the referential constraint)
ALTER TABLE orders
  ADD CONSTRAINT fk_orders_cancellation_chat_message
  FOREIGN KEY (cancellation_chat_message_id) REFERENCES order_messages(id);

-- Canonical side-based unread state. PRD §15: unread is tracked per side (CUSTOMER vs STAFF),
-- not per individual staff member. When any staff member opens the conversation, the service
-- must advance the STAFF-side cursor and clear staff unread for all staff views of that order.
CREATE TABLE chat_side_read_states (
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reader_side text NOT NULL CHECK (reader_side IN ('CUSTOMER','STAFF')),
  last_read_message_id uuid REFERENCES order_messages(id),
  last_read_at timestamptz,
  PRIMARY KEY (order_id, reader_side)
);

-- Per-user audit/helper state. Optional — kept for analytics, audit trail, and future
-- per-user read tracking if needed. NOT the canonical source of unread behavior.
-- Canonical unread = chat_side_read_states above.
CREATE TABLE chat_read_states (
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id uuid REFERENCES order_messages(id),
  last_read_at timestamptz,
  PRIMARY KEY (order_id, user_id)
);

-- Note: support_tickets.order_id FK is declared inline in the CREATE TABLE above.
-- No ALTER TABLE needed since orders is created before support_tickets.

CREATE TABLE support_ticket_messages (

  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id),
  message_body text NOT NULL,
  is_internal_note boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- v1.1: NEW TABLE — PRD §10.21, §25.2B (one row per resolution action on a ticket)
CREATE TABLE support_ticket_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  resolution_type ticket_resolution_type NOT NULL, -- same canonical enum as support_tickets.resolution_type
  refund_request_id uuid REFERENCES refund_requests(id),
  replacement_order_id uuid REFERENCES orders(id),
  credit_amount_cents int CHECK (credit_amount_cents IS NULL OR credit_amount_cents >= 0),
  note text,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Partial unique index: only one FULL_REFUND per ticket (PRD §25.2B financial invariant)
CREATE UNIQUE INDEX uq_one_full_refund_per_ticket
  ON support_ticket_resolutions(ticket_id)
  WHERE resolution_type = 'FULL_REFUND';

-- v1.1: NEW TABLE — PRD §10.21 (ticket lifecycle audit trail)
CREATE TABLE support_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('STATUS_CHANGE','STATUS_CHANGED','PRIORITY_CHANGE','PRIORITY_CHANGED','RESOLUTION_SET','RESOLVED','REOPENED','NOTE_ADDED','CREATED','MESSAGE_ADDED','ASSIGNED')),
  from_value text,
  to_value text,
  performed_by_user_id uuid REFERENCES users(id),
  note text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- v1.3: SPLIT — PRD §10.11 says "do NOT merge with item_reviews"
-- PRD §10.13 puts admin reply inline on item_reviews
-- PRD §10.11 defines driver_delivery_reviews with UNIQUE on order_id

CREATE TABLE item_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id),
  customer_user_id uuid NOT NULL REFERENCES users(id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_body text,
  is_approved_public boolean NOT NULL DEFAULT false,
  -- admin reply inline per PRD §10.13
  admin_reply text,
  admin_replied_at timestamptz,
  admin_replied_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- one review per order_item per customer
  UNIQUE(order_item_id, customer_user_id)
);

CREATE TABLE driver_delivery_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES driver_profiles(user_id),
  customer_user_id uuid NOT NULL REFERENCES users(id),
  rating_stars smallint NOT NULL CHECK (rating_stars BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- one rating per delivery per PRD §10.11
  UNIQUE(order_id)
);

-- v1.1: NEW TABLE — PRD §10.11 (driver rating tags)
-- v1.3: FIX — now FK → driver_delivery_reviews, structurally guaranteeing
-- tags can only exist on actual driver reviews
CREATE TABLE driver_delivery_review_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES driver_delivery_reviews(id) ON DELETE CASCADE,
  tag_code text NOT NULL,
  tag_label_snapshot text NOT NULL,
  sentiment review_tag_sentiment NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- DRIVER PAYOUTS
-- ============================================================================

-- v1.1: NEW TABLE — PRD §10.33
-- v1.2: FIX — driver_user_id now FK → driver_profiles, not users
CREATE TABLE driver_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES driver_profiles(user_id),
  location_id uuid NOT NULL REFERENCES locations(id),
  pay_period_start date NOT NULL,
  pay_period_end date NOT NULL,
  total_deliveries int NOT NULL DEFAULT 0 CHECK (total_deliveries >= 0),
  total_tips_cents int NOT NULL DEFAULT 0 CHECK (total_tips_cents >= 0),
  base_pay_cents int NOT NULL DEFAULT 0 CHECK (base_pay_cents >= 0),
  total_earnings_cents int NOT NULL DEFAULT 0 CHECK (total_earnings_cents >= 0),
  payout_status payout_status NOT NULL DEFAULT 'UNPAID',
  paid_at timestamptz,
  paid_by_user_id uuid REFERENCES users(id),
  payment_note text,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_payout_period CHECK (pay_period_end >= pay_period_start)
);

-- v1.1: NEW TABLE — PRD §10.33
-- v1.2: FIX — driver_user_id now FK → driver_profiles, not users
CREATE TABLE driver_payout_order_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES driver_payouts(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id),
  driver_user_id uuid NOT NULL REFERENCES driver_profiles(user_id),
  tip_cents int NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  base_pay_cents int NOT NULL DEFAULT 0 CHECK (base_pay_cents >= 0),
  UNIQUE(order_id, driver_user_id)
);

-- ============================================================================
-- INVENTORY, DEVICES, POS, TIMECLOCK, REGISTER
-- ============================================================================

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  name text NOT NULL,
  unit_label text NOT NULL,
  current_quantity_numeric numeric(12,2) NOT NULL DEFAULT 0 CHECK (current_quantity_numeric >= 0),
  low_stock_threshold_numeric numeric(12,2),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  adjustment_type inventory_adjustment_type NOT NULL,
  delta_numeric numeric(12,2) NOT NULL,
  quantity_after_numeric numeric(12,2) NOT NULL,
  reason_text text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE restock_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN','ORDERED','COMPLETED','ARCHIVED')),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE restock_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restock_list_id uuid NOT NULL REFERENCES restock_lists(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  requested_quantity_numeric numeric(12,2) NOT NULL CHECK (requested_quantity_numeric > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  device_type text NOT NULL CHECK (device_type IN ('KDS_SCREEN','POS_TERMINAL','RECEIPT_PRINTER','CASH_DRAWER','TIMECLOCK_TERMINAL')),
  name text NOT NULL,
  station_key text,
  ip_address inet,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- v1.1: device auth columns from PRD §24
  api_token_hash text,
  device_registered_at timestamptz,
  token_last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  device_id uuid REFERENCES devices(id),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(location_id, name)
);

CREATE TABLE register_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  register_id uuid NOT NULL REFERENCES registers(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  opened_by_user_id uuid NOT NULL REFERENCES users(id),
  closed_by_user_id uuid REFERENCES users(id),
  opening_float_cents int NOT NULL CHECK (opening_float_cents >= 0),
  expected_close_cents int,
  actual_close_cents int,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  status text NOT NULL CHECK (status IN ('OPEN','CLOSED'))
);

CREATE TABLE cash_drawer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  register_session_id uuid NOT NULL REFERENCES register_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('SALE_CASH_IN','CHANGE_GIVEN','NO_SALE','SAFE_DROP','ADJUSTMENT')),
  amount_cents int NOT NULL DEFAULT 0,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  approved_by_user_id uuid REFERENCES users(id),
  reason_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE employee_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_user_id uuid NOT NULL REFERENCES employee_profiles(user_id),
  location_id uuid NOT NULL REFERENCES locations(id),
  device_id uuid REFERENCES devices(id),
  clock_in_at timestamptz NOT NULL DEFAULT now(),
  clock_out_at timestamptz,
  status text NOT NULL CHECK (status IN ('CLOCKED_IN','ON_BREAK','CLOCKED_OUT')),
  total_break_minutes int NOT NULL DEFAULT 0,
  net_worked_minutes int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_one_active_shift_per_employee
  ON employee_shifts(employee_user_id)
  WHERE status IN ('CLOCKED_IN','ON_BREAK');

CREATE TABLE employee_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_shift_id uuid NOT NULL REFERENCES employee_shifts(id) ON DELETE CASCADE,
  break_type text NOT NULL CHECK (break_type IN ('UNPAID')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_one_open_break_per_shift
  ON employee_breaks(employee_shift_id)
  WHERE ended_at IS NULL;

-- ============================================================================
-- CATERING & AUDIT
-- ============================================================================

CREATE TABLE catering_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid REFERENCES users(id),
  name text NOT NULL,
  email citext NOT NULL,
  phone_number text NOT NULL,
  event_date date,
  message_body text NOT NULL,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','WON','LOST','ARCHIVED')),
  assigned_location_id uuid REFERENCES locations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- v1.1: FIX — actor_user_id is now NULLABLE per PRD §10.23 canonical system-event rule
-- "set performed_by_user_id = NULL for system-generated actions"
CREATE TABLE admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid REFERENCES locations(id),
  actor_user_id uuid REFERENCES users(id),  -- NULLABLE: null for SYSTEM-generated events
  actor_role_snapshot text NOT NULL,
  action_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  reason_text text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Identity & access
CREATE INDEX idx_users_role_active ON users(role, is_active);
CREATE INDEX idx_user_identities_user_primary ON user_identities(user_id, is_primary DESC);
CREATE INDEX idx_auth_otp_identity_purpose ON auth_otp_codes(user_identity_id, purpose, expires_at);
CREATE INDEX idx_auth_sessions_user_active ON auth_sessions(user_id, revoked_at, expires_at);
CREATE INDEX idx_customer_profiles_prepayment ON customer_profiles(prepayment_required);
CREATE INDEX idx_employee_profiles_loc_role ON employee_profiles(location_id, role, is_active_employee);
CREATE INDEX idx_admin_location_assignments_location ON admin_location_assignments(location_id, user_id);
CREATE INDEX idx_driver_profiles_loc_avail ON driver_profiles(location_id, availability_status, is_active);

-- Location config
CREATE INDEX idx_locations_active ON locations(is_active);
CREATE INDEX idx_location_hours_lookup ON location_hours(location_id, service_type, day_of_week);

-- Catalog
CREATE INDEX idx_menu_categories_loc_order ON menu_categories(location_id, sort_order);
CREATE INDEX idx_wing_flavours_loc_heat ON wing_flavours(location_id, heat_level, sort_order);
CREATE INDEX idx_menu_items_loc_category ON menu_items(location_id, category_id, is_available);
CREATE INDEX idx_modifier_groups_loc ON modifier_groups(location_id, sort_order);
CREATE INDEX idx_modifier_options_group ON modifier_options(modifier_group_id, is_active, sort_order);
CREATE INDEX idx_menu_item_modifier_groups_item ON menu_item_modifier_groups(menu_item_id, sort_order);
CREATE INDEX idx_menu_item_schedules_item_day ON menu_item_schedules(menu_item_id, day_of_week, time_from);

-- Orders
CREATE INDEX idx_checkout_idempotency_user ON checkout_idempotency_keys(user_id, created_at DESC);
CREATE INDEX idx_orders_loc_status_sched ON orders(location_id, status, scheduled_for);
CREATE INDEX idx_orders_customer ON orders(customer_user_id, placed_at DESC);
CREATE INDEX idx_orders_manual_review ON orders(requires_manual_review) WHERE requires_manual_review = true;
CREATE INDEX idx_order_items_order ON order_items(order_id, line_no);
CREATE INDEX idx_order_item_modifiers_item ON order_item_modifiers(order_item_id, sort_order);
CREATE INDEX idx_order_item_flavours_item ON order_item_flavours(order_item_id, sort_order);

-- Order events
CREATE INDEX idx_order_status_events_order_created ON order_status_events(order_id, created_at);
CREATE INDEX idx_order_status_events_loc_created ON order_status_events(location_id, created_at DESC);
CREATE INDEX idx_order_eta_events_order ON order_eta_events(order_id, created_at);
CREATE INDEX idx_order_finalization_events_order ON order_finalization_events(order_id, created_at);
CREATE INDEX idx_cancellation_requests_order_status ON cancellation_requests(order_id, status);
CREATE INDEX idx_cancellation_requests_loc_status ON cancellation_requests(location_id, status, created_at DESC);
CREATE INDEX idx_order_change_requests_order_status ON order_change_requests(order_id, status);

-- Driver dispatch
CREATE INDEX idx_order_driver_events_order_created ON order_driver_events(order_id, created_at);
CREATE INDEX idx_order_driver_events_driver_created ON order_driver_events(driver_user_id, created_at DESC);
CREATE INDEX idx_delivery_pin_verifications_result ON delivery_pin_verifications(verification_result, expires_at);

-- Promotions
CREATE INDEX idx_promo_codes_active_window ON promo_codes(is_active, starts_at, ends_at);
CREATE INDEX idx_promo_codes_scope ON promo_codes(scope_type, location_id);
CREATE INDEX idx_promo_redemptions_customer ON promo_redemptions(customer_user_id, created_at DESC);
CREATE INDEX idx_promo_code_product_targets_promo ON promo_code_product_targets(promo_code_id);
CREATE INDEX idx_promo_code_category_targets_promo ON promo_code_category_targets(promo_code_id);
CREATE INDEX idx_promo_valid_days_promo ON promo_valid_days(promo_code_id);
CREATE INDEX idx_order_discounts_order ON order_discounts(order_id);

-- Payments & wallet
CREATE INDEX idx_order_payments_order ON order_payments(order_id, created_at);
CREATE INDEX idx_refund_requests_order_status ON refund_requests(order_id, status);
CREATE INDEX idx_refund_requests_loc_status ON refund_requests(location_id, status, created_at DESC);
CREATE INDEX idx_customer_credit_ledger_customer ON customer_credit_ledger(customer_user_id, created_at DESC);

-- Chat & support
CREATE INDEX idx_order_messages_order_created ON order_messages(order_id, created_at);
CREATE INDEX idx_support_tickets_loc_status ON support_tickets(location_id, status, created_at DESC);
CREATE INDEX idx_support_tickets_order ON support_tickets(order_id);
CREATE INDEX idx_support_ticket_messages_ticket ON support_ticket_messages(support_ticket_id, created_at);
CREATE INDEX idx_support_ticket_resolutions_ticket ON support_ticket_resolutions(ticket_id, created_at);
CREATE INDEX idx_support_ticket_events_ticket ON support_ticket_events(ticket_id, created_at);

-- Reviews
-- Reviews (split)
CREATE INDEX idx_item_reviews_order ON item_reviews(order_id);
CREATE INDEX idx_item_reviews_item ON item_reviews(order_item_id);
CREATE INDEX idx_driver_delivery_reviews_order ON driver_delivery_reviews(order_id);
CREATE INDEX idx_driver_delivery_reviews_driver ON driver_delivery_reviews(driver_user_id, created_at DESC);
CREATE INDEX idx_driver_delivery_review_tags_review ON driver_delivery_review_tags(review_id);

-- Driver payouts
CREATE INDEX idx_driver_payouts_driver ON driver_payouts(driver_user_id, pay_period_start DESC);
CREATE INDEX idx_driver_payouts_loc_status ON driver_payouts(location_id, payout_status);
CREATE INDEX idx_driver_payout_order_links_payout ON driver_payout_order_links(payout_id);

-- Inventory
CREATE INDEX idx_inventory_items_loc_active ON inventory_items(location_id, is_active);
CREATE INDEX idx_inventory_adjustments_item_created ON inventory_adjustments(inventory_item_id, created_at DESC);
CREATE INDEX idx_restock_lists_loc_status ON restock_lists(location_id, status);
CREATE INDEX idx_restock_list_items_list ON restock_list_items(restock_list_id);

-- Store hardware
CREATE INDEX idx_devices_loc_type ON devices(location_id, device_type, is_active);
CREATE INDEX idx_registers_loc_active ON registers(location_id, is_active);
CREATE INDEX idx_register_sessions_register_status ON register_sessions(register_id, status, opened_at DESC);
CREATE INDEX idx_cash_drawer_events_session_created ON cash_drawer_events(register_session_id, created_at);
CREATE INDEX idx_employee_shifts_emp_open ON employee_shifts(employee_user_id, status, clock_in_at DESC);
CREATE INDEX idx_employee_shifts_loc_open ON employee_shifts(location_id, status);
CREATE INDEX idx_employee_breaks_shift ON employee_breaks(employee_shift_id, started_at);

-- Catering & audit
CREATE INDEX idx_catering_inquiries_status ON catering_inquiries(status, created_at DESC);
CREATE INDEX idx_admin_audit_logs_loc_created ON admin_audit_logs(location_id, created_at DESC);
CREATE INDEX idx_admin_audit_logs_actor_created ON admin_audit_logs(actor_user_id, created_at DESC);
CREATE INDEX idx_admin_audit_logs_entity ON admin_audit_logs(entity_type, entity_id);

-- ============================================================================
-- REPORTING
-- ============================================================================

CREATE TABLE daily_tax_summary (
  business_date date NOT NULL,
  location_id uuid NOT NULL REFERENCES locations(id),
  orders_count int NOT NULL DEFAULT 0 CHECK (orders_count >= 0),
  taxable_sales_cents int NOT NULL DEFAULT 0 CHECK (taxable_sales_cents >= 0),
  tax_collected_cents int NOT NULL DEFAULT 0 CHECK (tax_collected_cents >= 0),
  refund_tax_reversed_cents int NOT NULL DEFAULT 0 CHECK (refund_tax_reversed_cents >= 0),
  net_tax_cents int NOT NULL DEFAULT 0, -- tax_collected_cents - refund_tax_reversed_cents
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_date, location_id)
);

CREATE INDEX idx_daily_tax_summary_loc ON daily_tax_summary(location_id, business_date DESC);

-- ============================================================================
-- HARD NOTES — LAUNCH BLOCKERS
-- ============================================================================

-- 1. TAX FORMULA — FROZEN FOR LAUNCH
-- Launch location: London, Ontario, Canada
-- Tax name: HST (Harmonized Sales Tax)
-- Tax rate: 13% (stored as tax_rate_bps = 1300)
-- Currency: CAD
--
-- Canonical formula (one formula, one rounding, no per-line tax):
--   taxable_base = discounted_subtotal_cents
--                  + (delivery_fee_cents IF tax_delivery_fee = true)
--                  + (driver_tip_cents IF tax_tip = true)
--   tax_amount_cents = round_half_up(taxable_base * tax_rate_bps / 10000)
--
-- Launch defaults (location_settings):
--   tax_rate_bps = 1300
--   tax_delivery_fee = true  (delivery fees ARE taxable for prepared food in Ontario)
--   tax_tip = false          (tips are NOT taxable)
--   discounts_reduce_taxable_base = true (discounts reduce taxable base before tax)
--
-- Per-order snapshot (on orders table):
--   tax_rate_bps, tax_delivery_fee_applied, tax_tip_applied, tax_snapshot_label
--   These are frozen at checkout and NEVER recalculated retroactively.
--   Receipts, refunds, and reports use the order-level snapshot, not current config.
--
-- Rounding rule: round half-up, once, on the total taxable base.
--   Do NOT round per line item. Sum in exact cents first, then tax, then round once.
--
-- pricing_snapshot_json stores the full frozen rule inputs for historical reconstruction.
--
-- Daily tax reporting:
--   daily_tax_summary table stores per-location, per-business-date aggregates:
--   orders_count, taxable_sales_cents, tax_collected_cents, refund_tax_reversed_cents, net_tax_cents.
--   Service must update this table when orders are completed or refunds issued.
--   Receipts and refunds still use per-order snapshots; this table is for dashboard/reporting only.
--
-- These defaults are frozen for launch. Tax contract confirmed: Ontario HST 13%.

-- ============================================================================
-- DOCUMENTED DESIGN DIVERGENCES FROM PRD
-- These are intentional. Each one was reviewed and accepted. If you find one
-- that contradicts what you're building, check this list before filing a bug.
-- ============================================================================

-- DIVERGENCE 1: DEVICE TYPE ENUM
-- RESOLVED IN v1.4: DEVICE TYPE ALIGNMENT
-- devices.device_type now uses PRD-first names:
-- KDS_SCREEN, POS_TERMINAL, RECEIPT_PRINTER, CASH_DRAWER, TIMECLOCK_TERMINAL
--
-- TIMECLOCK_TERMINAL is the only deliberate extension beyond the older PRD
-- wording because timeclock is now an explicit operational surface in the
-- blueprint and needs device identity for trust, heartbeat, and audit.

-- RESOLVED IN v1.4: PAYMENT CONTRACT (TWO-LAYER MODEL)
-- payment_method (order-level summary) uses PRD-friendly names:
-- CASH, CARD, STORE_CREDIT, SPLIT, WAIVED
--
-- Two-layer payment model:
-- orders.payment_method (payment_method enum, nullable) = summary for UI/reporting.
-- orders.payment_status_summary (order_payment_status_summary enum) = summary for UI/reporting.
-- order_payments (payment_tender_method + payment_transaction_type +
--   payment_transaction_status) = canonical source of truth for all money movement.
-- SPLIT never appears on order_payments rows — it is order-level summary only.
-- Split payment is not exposed in MVP POS UX, but the backend transaction model
-- supports it via multiple order_payments rows.
--
-- STORE_CREDIT is wallet-backed credit in implementation terms.
-- WAIVED remains intentionally supported for replacement/no-charge flows.
--
-- NOTE: The old payment_status enum has been dropped. It was replaced by
-- order_payment_status_summary (orders) and payment_transaction_status (order_payments).

-- RESOLVED IN v1.4: CHAT MODEL
-- SQL now exposes PRD-aligned order_conversations + order_messages.
-- Two-layer unread model:
-- chat_side_read_states (order_id, reader_side) = canonical unread behavior per PRD §15.
--   reader_side IN ('CUSTOMER','STAFF'). When any staff member opens the conversation,
--   the service must advance the STAFF cursor and clear staff unread for all staff views.
-- chat_read_states (order_id, user_id) = optional per-user audit/helper state.
--   NOT the canonical source of unread. Kept for analytics and future per-user tracking.

-- DIVERGENCE 4 (was 5): PROMO TARGETING TABLE NAMES
-- PRD §10.16 uses: promo_eligible_categories, promo_eligible_products
-- SQL uses: promo_code_category_targets, promo_code_product_targets
--
-- Rationale: "targets" is more precise than "eligible" (the promo targets
-- specific categories/products for discount application, not just eligibility
-- checking). The promo_code_ prefix makes the FK relationship to promo_codes
-- self-documenting.
--
-- Action required: Schema Spec should use the SQL names. PRD can keep the
-- conceptual names in prose but the data-notes section should match SQL.

-- ============================================================================
-- DOCUMENTED DESIGN CHOICES (NOT DIVERGENCES — JUST CLARIFICATIONS)
-- ============================================================================

-- CHOICE: order_change_requests uses requested_items_json
-- This table is intentionally lightweight. The requested items, their prices,
-- and the recalculated totals are stored in requested_items_json rather than
-- a full normalized order_change_request_items table.
-- Rationale: Change requests are short-lived (3-minute window), low volume,
-- and always reviewed by a human. The JSON approach avoids a cascade of
-- snapshot tables for a feature that is operationally simple. If change
-- requests grow in complexity (e.g. partial approvals, line-item negotiation),
-- introduce normalized tables at that point.

-- CHOICE: order_eta_events stores old/new estimated_ready_at only
-- The PRD §11.3 says "Every adjustment logged in order_eta_events (who, when,
-- old + new value)." This table stores exactly that. Broader ETA history
-- (delivery ETA changes, window changes) can be tracked via
-- order_status_events with event_type = 'ETA_ADJUSTED' and payload_json for
-- richer context. order_eta_events is the dedicated audit trail for the
-- kitchen-facing ready-at timestamp specifically.
