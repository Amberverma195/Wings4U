CREATE UNIQUE INDEX "uq_customer_wings_stamp_ledger_order_entry_type"
    ON "customer_wings_stamp_ledger"("order_id", "entry_type");
