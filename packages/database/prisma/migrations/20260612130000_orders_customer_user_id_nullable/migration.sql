-- Guest POS/phone orders no longer create a synthetic customer user.
-- The order keeps name/phone on its snapshot columns; customer_user_id is
-- only set when the order is tied to a real account. Make it nullable.
ALTER TABLE "orders"
  ALTER COLUMN "customer_user_id" DROP NOT NULL;
