-- DB-backed saved carts (one active cart per user|guest per location).
-- Guest carts key on a cookie token and expire via expires_at; user carts
-- persist until checkout (CONVERTED) or explicit clear. The unique indexes
-- rely on Postgres treating NULLs as distinct, so guest rows with NULL
-- user_id (and user rows with NULL guest_token) do not collide.

-- CreateEnum
CREATE TYPE "saved_cart_status" AS ENUM ('ACTIVE', 'CONVERTED', 'ABANDONED');

-- CreateTable
CREATE TABLE "saved_carts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "guest_token" TEXT,
    "location_id" UUID NOT NULL,
    "fulfillment_type" "fulfillment_type" NOT NULL DEFAULT 'PICKUP',
    "location_timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "scheduled_for" TIMESTAMPTZ(6),
    "driver_tip_percent" TEXT NOT NULL DEFAULT 'none',
    "status" "saved_cart_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_cart_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cart_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "menu_item_slug" TEXT,
    "name_snapshot" TEXT NOT NULL,
    "image_url" TEXT,
    "base_price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "special_instructions" TEXT NOT NULL DEFAULT '',
    "modifier_selections_json" JSONB NOT NULL DEFAULT '[]',
    "removed_ingredients_json" JSONB NOT NULL DEFAULT '[]',
    "builder_payload_json" JSONB,
    "line_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_saved_cart_user_loc_status" ON "saved_carts"("user_id", "location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_saved_cart_guest_loc_status" ON "saved_carts"("guest_token", "location_id", "status");

-- CreateIndex
CREATE INDEX "idx_saved_cart_expires_at" ON "saved_carts"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_saved_cart_items_cart_line" ON "saved_cart_items"("cart_id", "line_key");

-- CreateIndex
CREATE INDEX "idx_saved_cart_items_cart" ON "saved_cart_items"("cart_id", "sort_order");

-- AddForeignKey
ALTER TABLE "saved_carts" ADD CONSTRAINT "saved_carts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "saved_carts" ADD CONSTRAINT "saved_carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "saved_cart_items" ADD CONSTRAINT "saved_cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "saved_carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "saved_cart_items" ADD CONSTRAINT "saved_cart_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
