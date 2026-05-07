ALTER TABLE "support_tickets"
  DROP CONSTRAINT IF EXISTS "support_tickets_ticket_type_check";

ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_ticket_type_check"
  CHECK ("ticket_type" IN (
    'WRONG_ITEM',
    'MISSING_ITEM',
    'COLD_FOOD',
    'BURNT_FOOD',
    'DELIVERY_ISSUE',
    'DRIVER_ISSUE',
    'QUALITY_ISSUE',
    'PAYMENT_ISSUE',
    'OTHER'
  ));
