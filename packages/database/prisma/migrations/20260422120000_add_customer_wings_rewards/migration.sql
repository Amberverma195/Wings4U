-- Wings-stamps rewards program: customers earn 1 stamp per whole pound of wings
-- on orders that complete successfully (status -> DELIVERED for delivery or
-- PICKED_UP for pickup). 8 stamps unlock "1lb of wings free" at checkout.
-- `available_stamps` is capped at 8 by application logic; extra pounds don't
-- accrue until the user redeems. `customer_wings_stamp_ledger` is a full
-- audit log of earn/redeem events, modeled after `customer_credit_ledger`.

CREATE TABLE "customer_wings_rewards" (
    "customer_user_id"     UUID NOT NULL,
    "available_stamps"     INTEGER NOT NULL DEFAULT 0,
    "lifetime_stamps"      INTEGER NOT NULL DEFAULT 0,
    "lifetime_redemptions" INTEGER NOT NULL DEFAULT 0,
    "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_wings_rewards_pkey" PRIMARY KEY ("customer_user_id")
);

ALTER TABLE "customer_wings_rewards"
    ADD CONSTRAINT "customer_wings_rewards_customer_user_id_fkey"
    FOREIGN KEY ("customer_user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "customer_wings_stamp_ledger" (
    "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_user_id"     UUID NOT NULL,
    "order_id"             UUID,
    "entry_type"           TEXT NOT NULL,
    "delta_stamps"         INTEGER NOT NULL,
    "balance_after_stamps" INTEGER NOT NULL,
    "pounds_awarded"       DECIMAL(5,2),
    "reason_text"          TEXT NOT NULL,
    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_wings_stamp_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_customer_wings_stamps_customer"
    ON "customer_wings_stamp_ledger"("customer_user_id", "created_at" DESC);

ALTER TABLE "customer_wings_stamp_ledger"
    ADD CONSTRAINT "customer_wings_stamp_ledger_customer_user_id_fkey"
    FOREIGN KEY ("customer_user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "customer_wings_stamp_ledger"
    ADD CONSTRAINT "customer_wings_stamp_ledger_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
