-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('CUSTOMER', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "employee_role" AS ENUM ('MANAGER', 'CASHIER', 'KITCHEN', 'DRIVER');

-- CreateEnum
CREATE TYPE "identity_provider" AS ENUM ('PHONE_OTP', 'EMAIL', 'GOOGLE');

-- CreateEnum
CREATE TYPE "fulfillment_type" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "order_source" AS ENUM ('ONLINE', 'POS', 'PHONE', 'ADMIN');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'PICKED_UP', 'DELIVERED', 'NO_SHOW_PICKUP', 'NO_SHOW_DELIVERY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "contactless_pref" AS ENUM ('HAND_TO_ME', 'LEAVE_AT_DOOR', 'CALL_ON_ARRIVAL', 'TEXT_ON_ARRIVAL');

-- CreateEnum
CREATE TYPE "driver_availability_status" AS ENUM ('AVAILABLE', 'ON_DELIVERY', 'OFF_SHIFT', 'UNAVAILABLE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "promo_discount_type" AS ENUM ('PERCENT', 'FIXED_AMOUNT', 'BXGY', 'FREE_DELIVERY');

-- CreateEnum
CREATE TYPE "promo_scope_type" AS ENUM ('GLOBAL', 'LOCATION_SCOPED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'CARD', 'STORE_CREDIT', 'SPLIT', 'WAIVED');

-- CreateEnum
CREATE TYPE "order_payment_status_summary" AS ENUM ('UNPAID', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'VOIDED');

-- CreateEnum
CREATE TYPE "payment_transaction_type" AS ENUM ('AUTH', 'CAPTURE', 'VOID', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "payment_transaction_status" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_tender_method" AS ENUM ('CASH', 'CARD', 'STORE_CREDIT', 'WAIVED');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ISSUED', 'VOIDED');

-- CreateEnum
CREATE TYPE "refund_method" AS ENUM ('STORE_CREDIT', 'ORIGINAL_PAYMENT', 'CASH');

-- CreateEnum
CREATE TYPE "inventory_adjustment_type" AS ENUM ('MANUAL_SET', 'MANUAL_ADD', 'MANUAL_SUBTRACT', 'WASTE', 'RESTOCK', 'CORRECTION');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('OPEN', 'IN_REVIEW', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ticket_resolution_type" AS ENUM ('NO_ACTION', 'STORE_CREDIT', 'PARTIAL_REFUND', 'FULL_REFUND', 'REPLACEMENT', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "pin_verification_result" AS ENUM ('PENDING', 'VERIFIED', 'BYPASSED', 'EXPIRED', 'LOCKED');

-- CreateEnum
CREATE TYPE "change_request_type" AS ENUM ('ADD_ITEMS');

-- CreateEnum
CREATE TYPE "change_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "review_tag_sentiment" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('UNPAID', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "city" TEXT NOT NULL,
    "province_code" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "timezone_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "role" "user_role" NOT NULL,
    "display_name" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "password_hash" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "identity_provider" NOT NULL,
    "provider_subject" TEXT,
    "email_normalized" CITEXT,
    "phone_e164" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_otp_codes" (
    "id" UUID NOT NULL,
    "user_identity_id" UUID NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "user_id" UUID NOT NULL,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "total_successful_orders" INTEGER NOT NULL DEFAULT 0,
    "total_no_shows" INTEGER NOT NULL DEFAULT 0,
    "prepayment_required" BOOLEAN NOT NULL DEFAULT false,
    "preferred_name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "employee_profiles" (
    "user_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "role" "employee_role" NOT NULL,
    "employee_pin_hash" TEXT,
    "hourly_rate_cents" INTEGER,
    "hire_date" DATE,
    "is_active_employee" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "admin_location_assignments" (
    "user_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_location_assignments_pkey" PRIMARY KEY ("user_id","location_id")
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "user_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "phone_number_mirror" TEXT NOT NULL,
    "email_mirror" CITEXT,
    "vehicle_type" TEXT,
    "vehicle_identifier" TEXT,
    "availability_status" "driver_availability_status" NOT NULL DEFAULT 'OFF_SHIFT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_on_delivery" BOOLEAN NOT NULL DEFAULT false,
    "last_assigned_at" TIMESTAMPTZ,
    "last_delivery_completed_at" TIMESTAMPTZ,
    "total_deliveries_completed" INTEGER NOT NULL DEFAULT 0,
    "average_rating_numeric" DECIMAL(3,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_info" TEXT,
    "ip_address" INET,
    "location_id" UUID,
    "is_pos_session" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by_user_id" UUID,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_settings" (
    "location_id" UUID NOT NULL,
    "tax_rate_bps" INTEGER NOT NULL,
    "tax_delivery_fee" BOOLEAN NOT NULL DEFAULT true,
    "tax_tip" BOOLEAN NOT NULL DEFAULT false,
    "discounts_reduce_taxable_base" BOOLEAN NOT NULL DEFAULT true,
    "delivery_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "free_delivery_threshold_cents" INTEGER,
    "minimum_delivery_subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "default_prep_time_minutes" INTEGER NOT NULL DEFAULT 20,
    "busy_mode_enabled" BOOLEAN NOT NULL DEFAULT false,
    "busy_mode_prep_time_minutes" INTEGER,
    "first_order_discount_enabled" BOOLEAN NOT NULL DEFAULT true,
    "default_promo_stackable" BOOLEAN NOT NULL DEFAULT false,
    "prepayment_threshold_no_shows" INTEGER NOT NULL DEFAULT 3,
    "allowed_postal_codes" JSONB NOT NULL DEFAULT '[]',
    "trusted_ip_ranges" JSONB NOT NULL DEFAULT '[]',
    "payment_gateway_config" JSONB NOT NULL DEFAULT '{}',
    "kds_auto_accept_seconds" INTEGER NOT NULL DEFAULT 10,
    "delivery_pin_expiry_minutes" INTEGER NOT NULL DEFAULT 240,
    "manager_credit_limit_cents" INTEGER,
    "default_pickup_min_minutes" INTEGER NOT NULL DEFAULT 30,
    "default_pickup_max_minutes" INTEGER NOT NULL DEFAULT 40,
    "default_delivery_min_minutes" INTEGER NOT NULL DEFAULT 40,
    "default_delivery_max_minutes" INTEGER NOT NULL DEFAULT 60,
    "overdue_delivery_grace_minutes" INTEGER NOT NULL DEFAULT 20,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_settings_pkey" PRIMARY KEY ("location_id")
);

-- CreateTable
CREATE TABLE "location_hours" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "service_type" TEXT NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "time_from" TIME NOT NULL,
    "time_to" TIME NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wing_flavours" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "heat_level" TEXT NOT NULL,
    "is_plain" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wing_flavours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "base_price_cents" INTEGER NOT NULL,
    "image_url" TEXT,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "is_popular" BOOLEAN NOT NULL DEFAULT false,
    "allowed_fulfillment_type" TEXT NOT NULL DEFAULT 'BOTH',
    "builder_type" TEXT,
    "requires_special_instructions" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "display_label" TEXT NOT NULL,
    "selection_mode" TEXT NOT NULL,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_options" (
    "id" UUID NOT NULL,
    "modifier_group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta_cents" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "linked_flavour_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modifier_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_modifier_groups" (
    "menu_item_id" UUID NOT NULL,
    "modifier_group_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "context_key" TEXT,

    CONSTRAINT "menu_item_modifier_groups_pkey" PRIMARY KEY ("menu_item_id","modifier_group_id")
);

-- CreateTable
CREATE TABLE "menu_item_schedules" (
    "id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "time_from" TIME NOT NULL,
    "time_to" TIME NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_item_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_idempotency_keys" (
    "idempotency_key" TEXT NOT NULL,
    "user_id" UUID,
    "location_id" UUID NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "order_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "checkout_idempotency_keys_pkey" PRIMARY KEY ("idempotency_key")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "customer_user_id" UUID NOT NULL,
    "order_number" BIGINT NOT NULL,
    "order_source" "order_source" NOT NULL,
    "fulfillment_type" "fulfillment_type" NOT NULL,
    "status" "order_status" NOT NULL,
    "contactless_pref" "contactless_pref",
    "scheduled_for" TIMESTAMPTZ NOT NULL,
    "placed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ,
    "ready_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by_user_id" UUID,
    "cancellation_source" TEXT,
    "cancellation_reason" TEXT,
    "assigned_driver_user_id" UUID,
    "estimated_travel_minutes" INTEGER,
    "estimated_arrival_at" TIMESTAMPTZ,
    "delivery_started_at" TIMESTAMPTZ,
    "delivery_completed_at" TIMESTAMPTZ,
    "delivery_phone_snapshot" TEXT,
    "customer_name_snapshot" TEXT NOT NULL,
    "customer_phone_snapshot" TEXT NOT NULL,
    "customer_email_snapshot" CITEXT,
    "address_snapshot_json" JSONB,
    "pricing_snapshot_json" JSONB NOT NULL DEFAULT '{}',
    "revalidation_diff_json" JSONB,
    "item_subtotal_cents" INTEGER NOT NULL,
    "item_discount_total_cents" INTEGER NOT NULL DEFAULT 0,
    "order_discount_total_cents" INTEGER NOT NULL DEFAULT 0,
    "discounted_subtotal_cents" INTEGER NOT NULL,
    "taxable_subtotal_cents" INTEGER NOT NULL,
    "tax_cents" INTEGER NOT NULL,
    "tax_rate_bps" INTEGER NOT NULL,
    "tax_delivery_fee_applied" BOOLEAN NOT NULL DEFAULT false,
    "tax_tip_applied" BOOLEAN NOT NULL DEFAULT false,
    "tax_snapshot_label" TEXT NOT NULL DEFAULT 'ONTARIO_HST_13',
    "delivery_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "driver_tip_cents" INTEGER NOT NULL DEFAULT 0,
    "wallet_applied_cents" INTEGER NOT NULL DEFAULT 0,
    "net_paid_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "final_payable_cents" INTEGER NOT NULL,
    "remaining_refundable_cents" INTEGER NOT NULL DEFAULT 0,
    "payment_method" "payment_method",
    "payment_status_summary" "order_payment_status_summary" NOT NULL DEFAULT 'UNPAID',
    "customer_order_notes" TEXT,
    "estimated_ready_at" TIMESTAMPTZ,
    "estimated_window_min_minutes" INTEGER,
    "estimated_window_max_minutes" INTEGER,
    "busy_mode_extra_minutes_applied" INTEGER NOT NULL DEFAULT 0,
    "cancel_allowed_until" TIMESTAMPTZ,
    "requires_manual_review" BOOLEAN NOT NULL DEFAULT false,
    "student_discount_requested" BOOLEAN NOT NULL DEFAULT false,
    "student_discount_verified_by" UUID,
    "student_discount_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "delivery_completed_by_user_id" UUID,
    "driver_reassigned_at" TIMESTAMPTZ,
    "cancellation_chat_message_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "menu_item_id" UUID,
    "line_no" INTEGER NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "category_name_snapshot" TEXT NOT NULL,
    "builder_type" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "line_discount_cents" INTEGER NOT NULL DEFAULT 0,
    "line_total_cents" INTEGER NOT NULL,
    "special_instructions" TEXT,
    "builder_payload_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_modifiers" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "modifier_group_id" UUID,
    "modifier_option_id" UUID,
    "modifier_group_name_snapshot" TEXT NOT NULL,
    "modifier_name_snapshot" TEXT NOT NULL,
    "modifier_kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price_delta_cents" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_item_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_wing_configs" (
    "order_item_id" UUID NOT NULL,
    "wing_type" TEXT NOT NULL,
    "preparation" TEXT NOT NULL,
    "weight_lb" DECIMAL(3,1) NOT NULL,
    "required_flavour_count" SMALLINT NOT NULL,
    "saucing_method" TEXT,
    "side_flavour_slot" SMALLINT,
    "extra_flavour_added" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "order_item_wing_configs_pkey" PRIMARY KEY ("order_item_id")
);

-- CreateTable
CREATE TABLE "order_item_flavours" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "slot_no" SMALLINT NOT NULL,
    "flavour_role" TEXT NOT NULL,
    "wing_flavour_id" UUID,
    "flavour_name_snapshot" TEXT NOT NULL,
    "heat_level_snapshot" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_item_flavours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "reason_text" TEXT,
    "payload_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_eta_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "old_estimated_ready_at" TIMESTAMPTZ,
    "new_estimated_ready_at" TIMESTAMPTZ,
    "changed_by_user_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_eta_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_finalization_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "final_status" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL,
    "confirmed_by_user_id" UUID,
    "confirmation_prompt_version" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_finalization_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_requests" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "request_source" TEXT NOT NULL,
    "reason_text" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reviewed_by_admin_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_change_requests" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "type" "change_request_type" NOT NULL,
    "status" "change_request_status" NOT NULL DEFAULT 'PENDING',
    "requested_items_json" JSONB NOT NULL DEFAULT '[]',
    "resolved_at" TIMESTAMPTZ,
    "resolved_by_user_id" UUID,
    "rejection_reason" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_driver_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "driver_user_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "estimated_travel_minutes" INTEGER,
    "note_text" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_driver_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_pin_verifications" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMPTZ,
    "verified_at" TIMESTAMPTZ,
    "verified_by_user_id" UUID,
    "verification_result" "pin_verification_result" NOT NULL DEFAULT 'PENDING',
    "bypass_reason" TEXT,
    "bypass_by_user_id" UUID,

    CONSTRAINT "delivery_pin_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "code" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discount_type" "promo_discount_type" NOT NULL,
    "scope_type" "promo_scope_type" NOT NULL DEFAULT 'GLOBAL',
    "location_id" UUID,
    "discount_value" DECIMAL(12,2) NOT NULL,
    "eligible_fulfillment_type" TEXT NOT NULL DEFAULT 'BOTH',
    "is_stackable" BOOLEAN NOT NULL DEFAULT false,
    "is_first_order_only" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "usage_limit_total" INTEGER,
    "usage_limit_per_customer" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "rule_payload_json" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMPTZ,
    "min_subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "max_discount_cents" INTEGER,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "valid_time_from" TIME,
    "valid_time_to" TIME,
    "is_one_time_per_customer" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_product_targets" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,

    CONSTRAINT "promo_code_product_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_category_targets" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "menu_category_id" UUID NOT NULL,

    CONSTRAINT "promo_code_category_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_valid_days" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,

    CONSTRAINT "promo_valid_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_bxgy_rules" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "qualifying_category_id" UUID,
    "qualifying_product_id" UUID,
    "required_qty" INTEGER NOT NULL,
    "reward_category_id" UUID,
    "reward_product_id" UUID,
    "reward_qty" INTEGER NOT NULL,
    "reward_rule" TEXT NOT NULL,
    "max_uses_per_order" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_bxgy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_user_id" UUID NOT NULL,
    "discount_amount_cents" INTEGER NOT NULL,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_discounts" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "promo_code_id" UUID,
    "discount_type" TEXT NOT NULL,
    "discount_amount_cents" INTEGER NOT NULL,
    "description" TEXT,
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "payment_method" "payment_tender_method" NOT NULL,
    "transaction_type" "payment_transaction_type" NOT NULL DEFAULT 'CAPTURE',
    "transaction_status" "payment_transaction_status" NOT NULL DEFAULT 'PENDING',
    "signed_amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
    "provider" TEXT,
    "provider_transaction_id" TEXT,
    "processor_payload_json" JSONB NOT NULL DEFAULT '{}',
    "initiated_by_user_id" UUID,
    "failure_reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "order_id" UUID,
    "customer_user_id" UUID,
    "ticket_type" TEXT NOT NULL,
    "status" "ticket_status" NOT NULL,
    "resolution_type" "ticket_resolution_type",
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_source" TEXT NOT NULL,
    "assigned_admin_user_id" UUID,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_requests" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "support_ticket_id" UUID,
    "requested_by_user_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "refund_method" "refund_method" NOT NULL DEFAULT 'STORE_CREDIT',
    "status" "refund_status" NOT NULL DEFAULT 'PENDING',
    "reason_text" TEXT NOT NULL,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "issued_by_user_id" UUID,
    "issued_at" TIMESTAMPTZ,
    "rejected_by_user_id" UUID,
    "rejected_at" TIMESTAMPTZ,
    "processor_reference" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_wallets" (
    "customer_user_id" UUID NOT NULL,
    "balance_cents" INTEGER NOT NULL DEFAULT 0,
    "lifetime_credit_cents" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_wallets_pkey" PRIMARY KEY ("customer_user_id")
);

-- CreateTable
CREATE TABLE "customer_credit_ledger" (
    "id" UUID NOT NULL,
    "customer_user_id" UUID NOT NULL,
    "order_id" UUID,
    "refund_request_id" UUID,
    "entry_type" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "balance_after_cents" INTEGER NOT NULL,
    "reason_text" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_conversations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "order_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "sender_surface" TEXT NOT NULL,
    "message_body" TEXT NOT NULL,
    "is_system_message" BOOLEAN NOT NULL DEFAULT false,
    "visibility" TEXT NOT NULL DEFAULT 'BOTH',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "order_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_side_read_states" (
    "order_id" UUID NOT NULL,
    "reader_side" TEXT NOT NULL,
    "last_read_message_id" UUID,
    "last_read_at" TIMESTAMPTZ,

    CONSTRAINT "chat_side_read_states_pkey" PRIMARY KEY ("order_id","reader_side")
);

-- CreateTable
CREATE TABLE "chat_read_states" (
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_message_id" UUID,
    "last_read_at" TIMESTAMPTZ,

    CONSTRAINT "chat_read_states_pkey" PRIMARY KEY ("order_id","user_id")
);

-- CreateTable
CREATE TABLE "support_ticket_messages" (
    "id" UUID NOT NULL,
    "support_ticket_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "message_body" TEXT NOT NULL,
    "is_internal_note" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_resolutions" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "resolution_type" "ticket_resolution_type" NOT NULL,
    "refund_request_id" UUID,
    "replacement_order_id" UUID,
    "credit_amount_cents" INTEGER,
    "note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_events" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "performed_by_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_reviews" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "customer_user_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "review_body" TEXT,
    "is_approved_public" BOOLEAN NOT NULL DEFAULT false,
    "admin_reply" TEXT,
    "admin_replied_at" TIMESTAMPTZ,
    "admin_replied_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_delivery_reviews" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "driver_user_id" UUID NOT NULL,
    "customer_user_id" UUID NOT NULL,
    "rating_stars" SMALLINT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_delivery_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_delivery_review_tags" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "tag_code" TEXT NOT NULL,
    "tag_label_snapshot" TEXT NOT NULL,
    "sentiment" "review_tag_sentiment" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_delivery_review_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_payouts" (
    "id" UUID NOT NULL,
    "driver_user_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "pay_period_start" DATE NOT NULL,
    "pay_period_end" DATE NOT NULL,
    "total_deliveries" INTEGER NOT NULL DEFAULT 0,
    "total_tips_cents" INTEGER NOT NULL DEFAULT 0,
    "base_pay_cents" INTEGER NOT NULL DEFAULT 0,
    "total_earnings_cents" INTEGER NOT NULL DEFAULT 0,
    "payout_status" "payout_status" NOT NULL DEFAULT 'UNPAID',
    "paid_at" TIMESTAMPTZ,
    "paid_by_user_id" UUID,
    "payment_note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_payout_order_links" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "driver_user_id" UUID NOT NULL,
    "tip_cents" INTEGER NOT NULL DEFAULT 0,
    "base_pay_cents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "driver_payout_order_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit_label" TEXT NOT NULL,
    "current_quantity_numeric" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "low_stock_threshold_numeric" DECIMAL(12,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_adjustments" (
    "id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "adjustment_type" "inventory_adjustment_type" NOT NULL,
    "delta_numeric" DECIMAL(12,2) NOT NULL,
    "quantity_after_numeric" DECIMAL(12,2) NOT NULL,
    "reason_text" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restock_lists" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restock_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restock_list_items" (
    "id" UUID NOT NULL,
    "restock_list_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "requested_quantity_numeric" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restock_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "device_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "station_key" TEXT,
    "ip_address" INET,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "api_token_hash" TEXT,
    "device_registered_at" TIMESTAMPTZ,
    "token_last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registers" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "device_id" UUID,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "register_sessions" (
    "id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "opened_by_user_id" UUID NOT NULL,
    "closed_by_user_id" UUID,
    "opening_float_cents" INTEGER NOT NULL,
    "expected_close_cents" INTEGER,
    "actual_close_cents" INTEGER,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL,

    CONSTRAINT "register_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_drawer_events" (
    "id" UUID NOT NULL,
    "register_session_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "actor_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "reason_text" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_drawer_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_shifts" (
    "id" UUID NOT NULL,
    "employee_user_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "device_id" UUID,
    "clock_in_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clock_out_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_breaks" (
    "id" UUID NOT NULL,
    "employee_shift_id" UUID NOT NULL,
    "break_type" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catering_inquiries" (
    "id" UUID NOT NULL,
    "customer_user_id" UUID,
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "event_date" DATE,
    "message_body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "assigned_location_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catering_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "location_id" UUID,
    "actor_user_id" UUID,
    "actor_role_snapshot" TEXT NOT NULL,
    "action_key" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "reason_text" TEXT,
    "payload_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_tax_summary" (
    "business_date" DATE NOT NULL,
    "location_id" UUID NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "taxable_sales_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_collected_cents" INTEGER NOT NULL DEFAULT 0,
    "refund_tax_reversed_cents" INTEGER NOT NULL DEFAULT 0,
    "net_tax_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_tax_summary_pkey" PRIMARY KEY ("business_date","location_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

-- CreateIndex
CREATE INDEX "idx_locations_active" ON "locations"("is_active");

-- CreateIndex
CREATE INDEX "idx_users_role_active" ON "users"("role", "is_active");

-- CreateIndex
CREATE INDEX "idx_user_identities_user_primary" ON "user_identities"("user_id", "is_primary" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_provider_subject" ON "user_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "uq_email" ON "user_identities"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "uq_phone" ON "user_identities"("phone_e164");

-- CreateIndex
CREATE INDEX "idx_auth_otp_identity_purpose" ON "auth_otp_codes"("user_identity_id", "purpose", "expires_at");

-- CreateIndex
CREATE INDEX "idx_customer_profiles_prepayment" ON "customer_profiles"("prepayment_required");

-- CreateIndex
CREATE INDEX "idx_employee_profiles_loc_role" ON "employee_profiles"("location_id", "role", "is_active_employee");

-- CreateIndex
CREATE INDEX "idx_admin_location_assignments_location" ON "admin_location_assignments"("location_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_driver_profiles_loc_avail" ON "driver_profiles"("location_id", "availability_status", "is_active");

-- CreateIndex
CREATE INDEX "idx_auth_sessions_user_active" ON "auth_sessions"("user_id", "last_active_at");

-- CreateIndex
CREATE INDEX "idx_location_hours_lookup" ON "location_hours"("location_id", "service_type", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "location_hours_location_id_service_type_day_of_week_time_fr_key" ON "location_hours"("location_id", "service_type", "day_of_week", "time_from", "time_to");

-- CreateIndex
CREATE INDEX "idx_menu_categories_loc_order" ON "menu_categories"("location_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_location_id_slug_key" ON "menu_categories"("location_id", "slug");

-- CreateIndex
CREATE INDEX "idx_wing_flavours_loc_heat" ON "wing_flavours"("location_id", "heat_level", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "wing_flavours_location_id_slug_key" ON "wing_flavours"("location_id", "slug");

-- CreateIndex
CREATE INDEX "idx_menu_items_loc_category" ON "menu_items"("location_id", "category_id", "is_available");

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_location_id_slug_key" ON "menu_items"("location_id", "slug");

-- CreateIndex
CREATE INDEX "idx_modifier_groups_loc" ON "modifier_groups"("location_id", "sort_order");

-- CreateIndex
CREATE INDEX "idx_modifier_options_group" ON "modifier_options"("modifier_group_id", "is_active", "sort_order");

-- CreateIndex
CREATE INDEX "idx_menu_item_modifier_groups_item" ON "menu_item_modifier_groups"("menu_item_id", "sort_order");

-- CreateIndex
CREATE INDEX "idx_menu_item_schedules_item_day" ON "menu_item_schedules"("menu_item_id", "day_of_week", "time_from");

-- CreateIndex
CREATE INDEX "idx_checkout_idempotency_user" ON "checkout_idempotency_keys"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_orders_loc_status_sched" ON "orders"("location_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "idx_orders_customer" ON "orders"("customer_user_id");

-- CreateIndex
CREATE INDEX "idx_orders_manual_review" ON "orders"("requires_manual_review");

-- CreateIndex
CREATE UNIQUE INDEX "orders_location_id_order_number_key" ON "orders"("location_id", "order_number");

-- CreateIndex
CREATE INDEX "idx_order_items_order" ON "order_items"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_line_no_key" ON "order_items"("order_id", "line_no");

-- CreateIndex
CREATE INDEX "idx_order_item_modifiers_item" ON "order_item_modifiers"("order_item_id");

-- CreateIndex
CREATE INDEX "idx_order_item_flavours_item" ON "order_item_flavours"("order_item_id");

-- CreateIndex
CREATE INDEX "idx_order_status_events_order_created" ON "order_status_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_order_status_events_loc_created" ON "order_status_events"("location_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_order_eta_events_order" ON "order_eta_events"("order_id");

-- CreateIndex
CREATE INDEX "idx_order_finalization_events_order" ON "order_finalization_events"("order_id");

-- CreateIndex
CREATE INDEX "idx_cancellation_requests_order_status" ON "cancellation_requests"("order_id", "status");

-- CreateIndex
CREATE INDEX "idx_cancellation_requests_loc_status" ON "cancellation_requests"("location_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_order_change_requests_order_status" ON "order_change_requests"("order_id", "status");

-- CreateIndex
CREATE INDEX "idx_order_driver_events_order_created" ON "order_driver_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_order_driver_events_driver_created" ON "order_driver_events"("driver_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_pin_verifications_order_id_key" ON "delivery_pin_verifications"("order_id");

-- CreateIndex
CREATE INDEX "idx_delivery_pin_verifications_result" ON "delivery_pin_verifications"("verification_result");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "idx_promo_codes_active_window" ON "promo_codes"("is_active", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "idx_promo_codes_scope" ON "promo_codes"("scope_type");

-- CreateIndex
CREATE INDEX "idx_promo_code_product_targets_promo" ON "promo_code_product_targets"("promo_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_product_targets_promo_code_id_menu_item_id_key" ON "promo_code_product_targets"("promo_code_id", "menu_item_id");

-- CreateIndex
CREATE INDEX "idx_promo_code_category_targets_promo" ON "promo_code_category_targets"("promo_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_category_targets_promo_code_id_menu_category_id_key" ON "promo_code_category_targets"("promo_code_id", "menu_category_id");

-- CreateIndex
CREATE INDEX "idx_promo_valid_days_promo" ON "promo_valid_days"("promo_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_valid_days_promo_code_id_day_of_week_key" ON "promo_valid_days"("promo_code_id", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "promo_bxgy_rules_promo_code_id_key" ON "promo_bxgy_rules"("promo_code_id");

-- CreateIndex
CREATE INDEX "idx_promo_redemptions_customer" ON "promo_redemptions"("customer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemptions_promo_code_id_order_id_key" ON "promo_redemptions"("promo_code_id", "order_id");

-- CreateIndex
CREATE INDEX "idx_order_discounts_order" ON "order_discounts"("order_id");

-- CreateIndex
CREATE INDEX "idx_order_payments_order" ON "order_payments"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_support_tickets_loc_status" ON "support_tickets"("location_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_support_tickets_order" ON "support_tickets"("order_id");

-- CreateIndex
CREATE INDEX "idx_refund_requests_order_status" ON "refund_requests"("order_id", "status");

-- CreateIndex
CREATE INDEX "idx_refund_requests_loc_status" ON "refund_requests"("location_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_customer_credit_ledger_customer" ON "customer_credit_ledger"("customer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_conversations_order_id_key" ON "order_conversations"("order_id");

-- CreateIndex
CREATE INDEX "idx_order_messages_order_created" ON "order_messages"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_support_ticket_messages_ticket" ON "support_ticket_messages"("support_ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_support_ticket_resolutions_ticket" ON "support_ticket_resolutions"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_support_ticket_events_ticket" ON "support_ticket_events"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_item_reviews_item" ON "item_reviews"("order_item_id");

-- CreateIndex
CREATE INDEX "idx_item_reviews_order" ON "item_reviews"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_reviews_order_item_id_customer_user_id_key" ON "item_reviews"("order_item_id", "customer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_delivery_reviews_order_id_key" ON "driver_delivery_reviews"("order_id");

-- CreateIndex
CREATE INDEX "idx_driver_delivery_reviews_driver" ON "driver_delivery_reviews"("driver_user_id");

-- CreateIndex
CREATE INDEX "idx_driver_delivery_reviews_order" ON "driver_delivery_reviews"("order_id");

-- CreateIndex
CREATE INDEX "idx_driver_delivery_review_tags_review" ON "driver_delivery_review_tags"("review_id");

-- CreateIndex
CREATE INDEX "idx_driver_payouts_driver" ON "driver_payouts"("driver_user_id");

-- CreateIndex
CREATE INDEX "idx_driver_payouts_loc_status" ON "driver_payouts"("location_id", "payout_status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_driver_payout_order_links_payout" ON "driver_payout_order_links"("payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_payout_order_links_order_id_driver_user_id_key" ON "driver_payout_order_links"("order_id", "driver_user_id");

-- CreateIndex
CREATE INDEX "idx_inventory_items_loc_active" ON "inventory_items"("location_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_inventory_adjustments_item_created" ON "inventory_adjustments"("inventory_item_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_restock_lists_loc_status" ON "restock_lists"("location_id", "status");

-- CreateIndex
CREATE INDEX "idx_restock_list_items_list" ON "restock_list_items"("restock_list_id");

-- CreateIndex
CREATE INDEX "idx_devices_loc_type" ON "devices"("location_id", "device_type");

-- CreateIndex
CREATE INDEX "idx_registers_loc_active" ON "registers"("location_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "registers_location_id_name_key" ON "registers"("location_id", "name");

-- CreateIndex
CREATE INDEX "idx_register_sessions_register_status" ON "register_sessions"("register_id", "status");

-- CreateIndex
CREATE INDEX "idx_cash_drawer_events_session_created" ON "cash_drawer_events"("register_session_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_employee_shifts_emp_open" ON "employee_shifts"("employee_user_id", "status", "clock_in_at" DESC);

-- CreateIndex
CREATE INDEX "idx_employee_shifts_loc_open" ON "employee_shifts"("location_id", "status");

-- CreateIndex
CREATE INDEX "idx_employee_breaks_shift" ON "employee_breaks"("employee_shift_id", "started_at");

-- CreateIndex
CREATE INDEX "idx_catering_inquiries_status" ON "catering_inquiries"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_admin_audit_logs_loc_created" ON "admin_audit_logs"("location_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_admin_audit_logs_actor_created" ON "admin_audit_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_admin_audit_logs_entity" ON "admin_audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_daily_tax_summary_loc" ON "daily_tax_summary"("location_id", "business_date" DESC);

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_otp_codes" ADD CONSTRAINT "auth_otp_codes_user_identity_id_fkey" FOREIGN KEY ("user_identity_id") REFERENCES "user_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_location_assignments" ADD CONSTRAINT "admin_location_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_location_assignments" ADD CONSTRAINT "admin_location_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "employee_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_settings" ADD CONSTRAINT "location_settings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_hours" ADD CONSTRAINT "location_hours_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wing_flavours" ADD CONSTRAINT "wing_flavours_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_modifier_group_id_fkey" FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_linked_flavour_id_fkey" FOREIGN KEY ("linked_flavour_id") REFERENCES "wing_flavours"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_modifier_group_id_fkey" FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_schedules" ADD CONSTRAINT "menu_item_schedules_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_idempotency_keys" ADD CONSTRAINT "checkout_idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_idempotency_keys" ADD CONSTRAINT "checkout_idempotency_keys_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_idempotency_keys" ADD CONSTRAINT "checkout_idempotency_keys_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_driver_user_id_fkey" FOREIGN KEY ("assigned_driver_user_id") REFERENCES "driver_profiles"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_student_discount_verified_by_fkey" FOREIGN KEY ("student_discount_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_completed_by_user_id_fkey" FOREIGN KEY ("delivery_completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancellation_chat_message_id_fkey" FOREIGN KEY ("cancellation_chat_message_id") REFERENCES "order_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_group_id_fkey" FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_option_id_fkey" FOREIGN KEY ("modifier_option_id") REFERENCES "modifier_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_wing_configs" ADD CONSTRAINT "order_item_wing_configs_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_flavours" ADD CONSTRAINT "order_item_flavours_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_flavours" ADD CONSTRAINT "order_item_flavours_wing_flavour_id_fkey" FOREIGN KEY ("wing_flavour_id") REFERENCES "wing_flavours"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_eta_events" ADD CONSTRAINT "order_eta_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_finalization_events" ADD CONSTRAINT "order_finalization_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_finalization_events" ADD CONSTRAINT "order_finalization_events_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_reviewed_by_admin_user_id_fkey" FOREIGN KEY ("reviewed_by_admin_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_change_requests" ADD CONSTRAINT "order_change_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_change_requests" ADD CONSTRAINT "order_change_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_change_requests" ADD CONSTRAINT "order_change_requests_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_driver_events" ADD CONSTRAINT "order_driver_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_driver_events" ADD CONSTRAINT "order_driver_events_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_driver_events" ADD CONSTRAINT "order_driver_events_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "driver_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_driver_events" ADD CONSTRAINT "order_driver_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_pin_verifications" ADD CONSTRAINT "delivery_pin_verifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_pin_verifications" ADD CONSTRAINT "delivery_pin_verifications_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_pin_verifications" ADD CONSTRAINT "delivery_pin_verifications_bypass_by_user_id_fkey" FOREIGN KEY ("bypass_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_product_targets" ADD CONSTRAINT "promo_code_product_targets_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_product_targets" ADD CONSTRAINT "promo_code_product_targets_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_category_targets" ADD CONSTRAINT "promo_code_category_targets_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_category_targets" ADD CONSTRAINT "promo_code_category_targets_menu_category_id_fkey" FOREIGN KEY ("menu_category_id") REFERENCES "menu_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_valid_days" ADD CONSTRAINT "promo_valid_days_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_bxgy_rules" ADD CONSTRAINT "promo_bxgy_rules_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_bxgy_rules" ADD CONSTRAINT "promo_bxgy_rules_qualifying_category_id_fkey" FOREIGN KEY ("qualifying_category_id") REFERENCES "menu_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_bxgy_rules" ADD CONSTRAINT "promo_bxgy_rules_qualifying_product_id_fkey" FOREIGN KEY ("qualifying_product_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_bxgy_rules" ADD CONSTRAINT "promo_bxgy_rules_reward_category_id_fkey" FOREIGN KEY ("reward_category_id") REFERENCES "menu_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_bxgy_rules" ADD CONSTRAINT "promo_bxgy_rules_reward_product_id_fkey" FOREIGN KEY ("reward_product_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_admin_user_id_fkey" FOREIGN KEY ("assigned_admin_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_support_ticket_id_fkey" FOREIGN KEY ("support_ticket_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_rejected_by_user_id_fkey" FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_wallets" ADD CONSTRAINT "customer_wallets_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_ledger" ADD CONSTRAINT "customer_credit_ledger_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_ledger" ADD CONSTRAINT "customer_credit_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_ledger" ADD CONSTRAINT "customer_credit_ledger_refund_request_id_fkey" FOREIGN KEY ("refund_request_id") REFERENCES "refund_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_ledger" ADD CONSTRAINT "customer_credit_ledger_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_conversations" ADD CONSTRAINT "order_conversations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_messages" ADD CONSTRAINT "order_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "order_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_messages" ADD CONSTRAINT "order_messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_messages" ADD CONSTRAINT "order_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_side_read_states" ADD CONSTRAINT "chat_side_read_states_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_side_read_states" ADD CONSTRAINT "chat_side_read_states_last_read_message_id_fkey" FOREIGN KEY ("last_read_message_id") REFERENCES "order_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_last_read_message_id_fkey" FOREIGN KEY ("last_read_message_id") REFERENCES "order_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_support_ticket_id_fkey" FOREIGN KEY ("support_ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_resolutions" ADD CONSTRAINT "support_ticket_resolutions_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_resolutions" ADD CONSTRAINT "support_ticket_resolutions_refund_request_id_fkey" FOREIGN KEY ("refund_request_id") REFERENCES "refund_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_resolutions" ADD CONSTRAINT "support_ticket_resolutions_replacement_order_id_fkey" FOREIGN KEY ("replacement_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_resolutions" ADD CONSTRAINT "support_ticket_resolutions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_events" ADD CONSTRAINT "support_ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_events" ADD CONSTRAINT "support_ticket_events_performed_by_user_id_fkey" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_reviews" ADD CONSTRAINT "item_reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_reviews" ADD CONSTRAINT "item_reviews_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_reviews" ADD CONSTRAINT "item_reviews_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_reviews" ADD CONSTRAINT "item_reviews_admin_replied_by_user_id_fkey" FOREIGN KEY ("admin_replied_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_delivery_reviews" ADD CONSTRAINT "driver_delivery_reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_delivery_reviews" ADD CONSTRAINT "driver_delivery_reviews_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "driver_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_delivery_reviews" ADD CONSTRAINT "driver_delivery_reviews_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_delivery_review_tags" ADD CONSTRAINT "driver_delivery_review_tags_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "driver_delivery_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "driver_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_paid_by_user_id_fkey" FOREIGN KEY ("paid_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payout_order_links" ADD CONSTRAINT "driver_payout_order_links_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "driver_payouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payout_order_links" ADD CONSTRAINT "driver_payout_order_links_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payout_order_links" ADD CONSTRAINT "driver_payout_order_links_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "driver_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_lists" ADD CONSTRAINT "restock_lists_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_lists" ADD CONSTRAINT "restock_lists_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_list_items" ADD CONSTRAINT "restock_list_items_restock_list_id_fkey" FOREIGN KEY ("restock_list_id") REFERENCES "restock_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_list_items" ADD CONSTRAINT "restock_list_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registers" ADD CONSTRAINT "registers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registers" ADD CONSTRAINT "registers_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_sessions" ADD CONSTRAINT "register_sessions_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_sessions" ADD CONSTRAINT "register_sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_sessions" ADD CONSTRAINT "register_sessions_opened_by_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_sessions" ADD CONSTRAINT "register_sessions_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_drawer_events" ADD CONSTRAINT "cash_drawer_events_register_session_id_fkey" FOREIGN KEY ("register_session_id") REFERENCES "register_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_drawer_events" ADD CONSTRAINT "cash_drawer_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_drawer_events" ADD CONSTRAINT "cash_drawer_events_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "employee_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_breaks" ADD CONSTRAINT "employee_breaks_employee_shift_id_fkey" FOREIGN KEY ("employee_shift_id") REFERENCES "employee_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catering_inquiries" ADD CONSTRAINT "catering_inquiries_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catering_inquiries" ADD CONSTRAINT "catering_inquiries_assigned_location_id_fkey" FOREIGN KEY ("assigned_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tax_summary" ADD CONSTRAINT "daily_tax_summary_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
