-- Persisted delivery addresses owned by a customer user, so signed-in users
-- see the same saved addresses across devices. Rows are scoped to the user
-- and cascade on user delete. No unique constraint on (user, line1, postal) —
-- we dedupe at the app layer to keep label/formatting flexibility.

CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_customer_addresses_user_updated" ON "customer_addresses"("user_id", "updated_at" DESC);

ALTER TABLE "customer_addresses"
    ADD CONSTRAINT "customer_addresses_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
