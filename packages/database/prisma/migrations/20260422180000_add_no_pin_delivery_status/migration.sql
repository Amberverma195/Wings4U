-- Add a new terminal OrderStatus variant for deliveries that the driver had to
-- complete manually because the customer failed the delivery PIN challenge too
-- many times. Added before 'CANCELLED' to keep the existing enum ordering
-- otherwise untouched.
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'NO_PIN_DELIVERY' BEFORE 'CANCELLED';
