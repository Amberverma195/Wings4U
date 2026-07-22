BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "order_payments"
    WHERE "provider" IS NOT NULL
      AND "provider_transaction_id" IS NOT NULL
    GROUP BY "provider", "provider_transaction_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate provider transactions exist in order_payments; reconcile them before deploying this migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "uq_order_payments_provider_transaction"
ON "order_payments" ("provider", "provider_transaction_id");

COMMIT;
